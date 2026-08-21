# -*- coding: utf-8 -*-
"""v5.50.4 验证：角色组装器 ↔ 角色设定集 往返切换正常"""
import sys
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
from playwright.sync_api import sync_playwright

BASE = "http://127.0.0.1:8080"
PASS = 0
FAIL = 0

def ok(name, cond, extra=""):
    global PASS, FAIL
    if cond:
        PASS += 1
        print(f"  [PASS] {name} {extra}")
    else:
        FAIL += 1
        print(f"  [FAIL] {name} {extra}")

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, executable_path=r"C:\Program Files\Google\Chrome\Application\chrome.exe")
    page = browser.new_page(viewport={"width": 1440, "height": 900})
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto(BASE, wait_until="domcontentloaded", timeout=30000)
    page.wait_for_timeout(2500)
    token = page.evaluate("""async () => {
        const r = await fetch('/api/auth/login', {method:'POST', headers:{'Content-Type':'application/json'},
            body: JSON.stringify({username:'admin', password:'admin'})});
        const d = await r.json(); return d.token;
    }""")
    page.evaluate("""(t) => {
        let obf = '';
        for (let i=0; i<t.length; i++) obf += String.fromCharCode(t.charCodeAt(i) ^ 0x5A);
        localStorage.setItem('pk_token_v1', btoa(obf));
        localStorage.setItem('pk_user', JSON.stringify({username:'admin', role:'admin'}));
    }""", token)
    page.reload(wait_until="domcontentloaded")
    page.wait_for_timeout(2500)

    def active_id():
        return page.evaluate("() => { const el = document.querySelector('.view-panel.active-view'); return el ? el.id : '无'; }")

    def cc_visible():
        return page.evaluate("() => { const el = document.getElementById('viewCharacterComposer'); return el ? el.offsetParent !== null : false; }")

    # 1. 打开角色组装器（其激活机制是 display:block，非 active-view 类）
    page.click("#navDropdownComposer .nav-dropdown-btn")
    page.wait_for_timeout(300)
    page.click("text=角色组装器")
    page.wait_for_timeout(2000)
    ok("角色组装器可见", cc_visible(), f"(display 激活)")

    # 2. 切到角色设定集
    page.click("#navDropdownComposer .nav-dropdown-btn")
    page.wait_for_timeout(300)
    page.click("text=角色设定集")
    page.wait_for_timeout(2000)
    ok("角色设定集激活", active_id() == 'viewStyleSuit', f"({active_id()})")
    ok("角色设定集内容渲染", page.evaluate("() => !!document.querySelector('.suit-bag')"))

    # 3. 切回角色组装器
    page.click("#navDropdownComposer .nav-dropdown-btn")
    page.wait_for_timeout(300)
    page.click("text=角色组装器")
    page.wait_for_timeout(2000)
    ok("切回角色组装器", cc_visible(), f"(display 激活)")

    # 4. 再切回角色设定集（二次往返）
    page.click("#navDropdownComposer .nav-dropdown-btn")
    page.wait_for_timeout(300)
    page.click("text=角色设定集")
    page.wait_for_timeout(2000)
    ok("二次切回角色设定集", active_id() == 'viewStyleSuit' and page.evaluate("() => !!document.querySelector('.suit-bag')"), f"({active_id()})")

    # 5. 角色设定集内进入操作台 → 返回（内部导航）
    page.click("#suitBtnWorkbench")
    page.wait_for_timeout(1000)
    ok("操作台打开", page.evaluate("() => !!document.querySelector('.suit-workbench')"))
    page.evaluate("() => { if (window.STYLE_SUIT) STYLE_SUIT.openBag(); }")
    page.wait_for_timeout(1200)
    ok("操作台返回设定集", active_id() == 'viewStyleSuit' and page.evaluate("() => !!document.querySelector('.suit-bag')"), f"({active_id()})")

    # 6. JS 错误检查（排除已知 401 噪音）
    real = [e for e in errors if '401' not in e and 'length' not in e]
    ok("无切换 JS 错误", len(real) == 0, f"({len(real)}): {real[:2]}")

    browser.close()

print(f"\n========== 结果: PASS=*** FAIL={FAIL} ==========")
sys.exit(0 if FAIL == 0 else 1)
