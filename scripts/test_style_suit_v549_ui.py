# -*- coding: utf-8 -*-
"""v5.49.0 前端补充验证：预置模板可见 + 结果页动作按钮"""
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

    # 1. 切到系统预置 tab
    page.evaluate("""() => {
        const tabs = document.querySelectorAll('.suit-tab-btn');
        for (const t of tabs) { if (t.textContent.includes('系统预置')) t.click(); }
    }""")
    page.wait_for_timeout(1200)
    card_names = page.evaluate("""() => Array.from(document.querySelectorAll('.suit-card-name')).map(e => e.textContent)""")
    ok("系统预置模板可见", len(card_names) >= 5, f"({len(card_names)} 套: {card_names[:5]})")

    # 2. 预置模板详情
    ok("预置模板含影视写实", any('影视写实' in n for n in card_names), f"({[n for n in card_names if '影视写实' in n]})")

    # 3. 点开一个预置模板详情 → 载入组装工作台
    page.evaluate("""() => {
        const cards = document.querySelectorAll('.suit-card');
        for (const c of cards) {
            const n = c.getAttribute('data-name') || '';
            if (n.includes('影视写实')) { c.click(); break; }
        }
    }""")
    page.wait_for_timeout(600)
    has_detail = page.evaluate("() => !!document.querySelector('.suit-detail-name')")
    ok("详情面板显示", has_detail)
    # 点「载入组装工作台」
    page.evaluate("""() => {
        const btns = document.querySelectorAll('#suitDetail button');
        for (const b of btns) { if (b.textContent.includes('组装工作台')) b.click(); }
    }""")
    page.wait_for_timeout(1000)
    slot_suit = page.evaluate("() => (document.querySelector('#slotSuitBody') || {}).textContent || ''")
    ok("模板载入第三层", '影视写实' in slot_suit or '电影感' in slot_suit, f"({slot_suit[:40]})")

    # 4. 结果页动作按钮存在性（直接查 DOM 函数定义）
    has_fn = page.evaluate("""() => {
        const src = document.querySelector('script[src*="style_suit_ui"]');
        return !!(window.STYLE_SUIT && typeof window.STYLE_SUIT.openResult === 'function');
    }""")
    ok("结果页模块已加载", has_fn)

    browser.close()

print(f"\n========== 结果: PASS=*** FAIL={FAIL} ==========")
sys.exit(0 if FAIL == 0 else 1)
