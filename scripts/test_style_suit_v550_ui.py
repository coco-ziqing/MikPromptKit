# -*- coding: utf-8 -*-
"""v5.50.0 前端回归：右键菜单 + 词卡加载 + 通道切换提示"""
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

    # 打开风格套装库
    page.click("#navDropdownComposer .nav-dropdown-btn")
    page.wait_for_timeout(300)
    page.click("text=风格套装")
    page.wait_for_timeout(1500)

    # 1. 右键菜单
    page.evaluate("""() => {
        const card = document.querySelector('.suit-card');
        if (card) card.dispatchEvent(new MouseEvent('contextmenu', {bubbles: true, clientX: 300, clientY: 300}));
    }""")
    page.wait_for_timeout(400)
    has_ctx = page.evaluate("() => !!document.getElementById('suitCtxMenu')")
    ok("右键菜单弹出", has_ctx)
    ctx_items = page.evaluate("() => Array.from(document.querySelectorAll('#suitCtxMenu .suit-ctx-item')).map(e => e.textContent.trim())")
    ok("右键菜单项", len(ctx_items) >= 6, f"({ctx_items[:3]}...)")
    # 关闭
    page.keyboard.press("Escape")
    page.mouse.click(500, 500)
    page.wait_for_timeout(300)

    # 2. 打开操作台 → 词卡加载（picker 接口）
    page.click("#suitBtnWorkbench")
    page.wait_for_timeout(800)
    page.evaluate("""() => {
        const tabs = document.querySelectorAll('.suit-wb-res-tab');
        for (const t of tabs) { if (t.textContent.includes('词卡')) t.click(); }
    }""")
    page.wait_for_timeout(1500)
    card_items = page.evaluate("() => document.querySelectorAll('.suit-res-card').length")
    ok("词卡加载(picker)", card_items > 0, f"({card_items} 张)")

    # 3. 词卡添加 + 预览
    page.evaluate("""() => {
        const btn = document.querySelector('.suit-res-card .suit-res-add');
        if (btn) btn.click();
    }""")
    page.wait_for_timeout(500)
    rune_chips = page.evaluate("() => document.querySelectorAll('.suit-rune-chip').length")
    ok("词条添加", rune_chips >= 1, f"({rune_chips} 个)")

    # 4. 通道切换 real → 显示映射提示
    page.evaluate("""() => {
        const sel = document.getElementById('wbChannel');
        if (sel) { sel.value = 'real'; sel.dispatchEvent(new Event('change')); }
    }""")
    page.wait_for_timeout(400)
    preview_text = page.evaluate("() => (document.getElementById('wbPreview') || {}).textContent || ''")
    ok("写实通道映射提示", '写实通道参数映射' in preview_text, f"({preview_text[:60]})")

    browser.close()

print(f"\n========== 结果: PASS=*** FAIL={FAIL} ==========")
sys.exit(0 if FAIL == 0 else 1)
