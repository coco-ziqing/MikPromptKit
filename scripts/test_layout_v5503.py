# -*- coding: utf-8 -*-
"""v5.50.3 专项验证：侧边栏自动折叠 + 布局尺寸优化"""
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

    # 1. 进入背包页 → 侧边栏折叠
    page.click("#navDropdownComposer .nav-dropdown-btn")
    page.wait_for_timeout(300)
    page.click("text=角色设定集")
    page.wait_for_timeout(1500)
    collapsed = page.evaluate("() => (document.getElementById('sidebar') || {classList: {contains: () => false}}).classList.contains('collapsed')")
    ok("背包页侧边栏自动折叠", collapsed)

    # 2. 背包页容器撑满视口
    bag_h = page.evaluate("() => { const el = document.querySelector('.suit-bag'); return el ? el.getBoundingClientRect().height : 0; }")
    ok("背包页容器高度 > 600", bag_h > 600, f"({round(bag_h)}px)")

    # 3. 操作台 → 侧边栏折叠 + 中栏加宽
    page.click("#suitBtnWorkbench")
    page.wait_for_timeout(1000)
    collapsed2 = page.evaluate("() => (document.getElementById('sidebar') || {classList: {contains: () => false}}).classList.contains('collapsed')")
    ok("工作台侧边栏折叠", collapsed2)
    mid_w = page.evaluate("() => { const el = document.querySelector('.suit-wb-mid'); return el ? Math.round(el.getBoundingClientRect().width) : 0; }")
    main_w = page.evaluate("() => { const el = document.querySelector('.main-content'); return el ? Math.round(el.getBoundingClientRect().width) : 0; }")
    ok("操作台中栏 ≥ 380px", mid_w >= 380, f"({mid_w}px / 总宽 {main_w}px)")
    ok("内容区总宽 ≥ 1000px", main_w >= 1000, f"({main_w}px)")

    # 4. 三栏纵向撑满（左栏高 ≥ 400）
    left_h = page.evaluate("() => { const el = document.querySelector('.suit-wb-left'); return el ? Math.round(el.getBoundingClientRect().height) : 0; }")
    ok("左栏纵向撑满 ≥ 400", left_h >= 400, f"({left_h}px)")

    browser.close()

print(f"\n========== 结果: PASS=*** FAIL={FAIL} ==========")
sys.exit(0 if FAIL == 0 else 1)
