# -*- coding: utf-8 -*-
"""验证新名称「角色风格包」在 UI 生效"""
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

    # 1. 导航下拉入口
    page.click("#navDropdownComposer .nav-dropdown-btn")
    page.wait_for_timeout(300)
    nav_text = page.evaluate("() => document.body.innerText")
    ok("导航入口含角色风格包", '角色风格包' in nav_text)
    ok("导航无风格套装残留", '风格套装' not in nav_text)

    # 2. 打开背包页
    page.click("text=角色风格包")
    page.wait_for_timeout(1500)
    title = page.evaluate("() => (document.querySelector('.suit-bag-title') || {}).textContent || ''")
    ok("背包页标题", '角色风格包' in title, f"({title.strip()})")

    # 3. 新建按钮 + 编辑器标题
    page.click("#suitBtnNew")
    page.wait_for_timeout(600)
    editor_text = page.evaluate("() => (document.querySelector('.suit-modal-head') || {}).textContent || ''")
    ok("编辑器标题", '角色风格包' in editor_text, f"({editor_text.strip()})")
    page.keyboard.press("Escape")
    page.wait_for_timeout(300)

    # 4. 页面无残留游戏词
    body = page.evaluate("() => document.body.innerText")
    for w in ['风格套装', '装备', '卡槽', '符文', '背包']:
        if w in body:
            ok("无残留词 " + w, False)
            break
    else:
        ok("无残留游戏词", True)

    browser.close()

print(f"\n========== 结果: PASS=*** FAIL={FAIL} ==========")
sys.exit(0 if FAIL == 0 else 1)
