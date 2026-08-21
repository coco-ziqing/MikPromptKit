# -*- coding: utf-8 -*-
"""v5.50.9 验证：点击卡槽 → 左侧资源面板自动切换 + 高亮"""
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

    page.click("#navDropdownComposer .nav-dropdown-btn")
    page.wait_for_timeout(300)
    page.click("text=角色设定集")
    page.wait_for_timeout(1500)
    page.click("#suitBtnWorkbench")
    page.wait_for_timeout(1000)

    def active_tab():
        return page.evaluate("""() => {
            const t = document.querySelector('.suit-wb-res-tab.active');
            return t ? t.getAttribute('data-res') : '';
        }""")

    def selected_slot():
        return page.evaluate("""() => {
            const s = document.querySelector('.suit-slot.slot-selected');
            return s ? s.getAttribute('data-slot') : '';
        }""")

    # 1. 初始：素材 tab 激活
    ok("初始素材 tab", active_tab() == 'base', f"({active_tab()})")

    # 2. 点击 ② 风格词条层 → 左侧切词卡
    page.click("#slotRunes")
    page.wait_for_timeout(1200)
    ok("点词条层→词卡tab", active_tab() == 'cards', f"({active_tab()})")
    ok("词条层高亮", selected_slot() == 'cards', f"({selected_slot()})")

    # 3. 点击 ③ 风格模板层 → 左侧切套装
    page.click("#slotSuit")
    page.wait_for_timeout(1500)
    ok("点模板层→套装tab", active_tab() == 'suits', f"({active_tab()})")
    ok("模板层高亮", selected_slot() == 'suits', f"({selected_slot()})")

    # 4. 点击 ① 角色基底层 → 左侧切素材
    page.click("#slotBase")
    page.wait_for_timeout(800)
    ok("点基底层→素材tab", active_tab() == 'base', f"({active_tab()})")
    ok("基底层高亮", selected_slot() == 'base', f"({selected_slot()})")

    # 5. 点击 ④ 视图资产选配 → 高亮但不切换（提示）
    page.click("#slotAccessory")
    page.wait_for_timeout(400)
    ok("视图资产高亮", selected_slot() == 'accessory', f"({selected_slot()})")

    # 6. 无 JS 错误
    real = [e for e in errors if '401' not in e and 'length' not in e and '404' not in e]
    ok("无 JS 错误", len(real) == 0, f"({real[:2]})")

    browser.close()

print(f"\n========== 结果: PASS=*** FAIL={FAIL} ==========")
sys.exit(0 if FAIL == 0 else 1)
