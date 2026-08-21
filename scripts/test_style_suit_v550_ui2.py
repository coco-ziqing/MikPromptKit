# -*- coding: utf-8 -*-
"""v5.50.0 前端补充：完整装配后验证写实通道映射提示"""
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

    # 打开风格套装 → 操作台
    page.click("#navDropdownComposer .nav-dropdown-btn")
    page.wait_for_timeout(300)
    page.click("text=风格套装")
    page.wait_for_timeout(1500)
    page.click("#suitBtnWorkbench")
    page.wait_for_timeout(1000)

    # 1. 设基底（资源库 → 素材 tab → 填 desc）
    page.evaluate("""() => {
        const tabs = document.querySelectorAll('.suit-wb-res-tab');
        for (const t of tabs) { if (t.textContent.includes('素材')) t.click(); }
    }""")
    page.wait_for_timeout(500)
    page.evaluate("""() => {
        const d = document.getElementById('wbBaseDesc');
        if (d) { d.value = '青年男性，正脸'; d.dispatchEvent(new Event('input')); }
        const b = document.getElementById('wbBaseAdd');
        if (b) b.click();
    }""")
    page.wait_for_timeout(400)
    base_ok = page.evaluate("() => (document.querySelector('#slotBaseBody') || {}).textContent.includes('青年男性')")
    ok("基底已设", base_ok)

    # 2. 载入套装（套装 tab → 影视写实）
    page.evaluate("""() => {
        const tabs = document.querySelectorAll('.suit-wb-res-tab');
        for (const t of tabs) { if (t.textContent.includes('套装')) t.click(); }
    }""")
    page.wait_for_timeout(1000)
    page.evaluate("""() => {
        const items = document.querySelectorAll('.suit-res-suit');
        for (const it of items) {
            if ((it.textContent || '').includes('影视写实')) { it.querySelector('.suit-res-add').click(); break; }
        }
    }""")
    page.wait_for_timeout(600)
    suit_ok = page.evaluate("() => (document.querySelector('#slotSuitBody') || {}).textContent.includes('影视写实')")
    ok("模板已载入", suit_ok)

    # 3. 切写实通道 → 预览映射提示
    page.evaluate("""() => {
        const sel = document.getElementById('wbChannel');
        if (sel) { sel.value = 'real'; sel.dispatchEvent(new Event('change')); }
    }""")
    page.wait_for_timeout(400)
    preview_text = page.evaluate("() => (document.getElementById('wbPreview') || {}).textContent || ''")
    ok("写实通道映射提示", '写实通道参数映射' in preview_text, f"({preview_text[40:120]})")

    browser.close()

print(f"\n========== 结果: PASS=*** FAIL={FAIL} ==========")
sys.exit(0 if FAIL == 0 else 1)
