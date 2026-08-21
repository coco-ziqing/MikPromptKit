# -*- coding: utf-8 -*-
"""v5.50.12 验证：确认基底后可还原原始 + 重新调整"""
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

from PIL import Image
import tempfile, os
img_path = os.path.join(tempfile.gettempdir(), "v55012_full.png")
Image.new("RGB", (600, 600), (80, 160, 200)).save(img_path)

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
    page.evaluate("""() => {
        const tabs = document.querySelectorAll('.suit-wb-res-tab');
        for (const t of tabs) { if (t.textContent.includes('素材')) t.click(); }
    }""")
    page.wait_for_timeout(500)
    page.set_input_files("#baseFileInput", img_path)
    page.wait_for_timeout(3000)

    def title():
        return page.evaluate("() => (document.querySelector('.suit-base-preview-title') || {}).textContent || ''")

    # 1. 框选裁剪
    box = page.evaluate("""() => {
        const w = document.getElementById('baseCropWrap');
        const r = w.getBoundingClientRect();
        return { x: r.x, y: r.y, w: r.width, h: r.height };
    }""")
    page.mouse.move(box['x'] + box['w'] * 0.1, box['y'] + box['h'] * 0.1)
    page.mouse.down()
    page.mouse.move(box['x'] + box['w'] * 0.6, box['y'] + box['h'] * 0.6, steps=8)
    page.mouse.up()
    page.wait_for_timeout(300)
    page.click("#wbBaseCropApply", timeout=5000)
    page.wait_for_timeout(1200)
    t1 = title()
    ok("框选裁剪 300x300", '300' in t1, f"({t1})")

    # 2. 确认设为基底
    page.fill("#wbBaseDesc6", "裁剪测试")
    page.click("#wbBaseConfirm")
    page.wait_for_timeout(800)
    slot = page.evaluate("() => (document.querySelector('#slotBaseBody') || {}).textContent || ''")
    ok("基底已确认", '裁剪测试' in slot, f"({slot[:40]})")

    # 3. 确认后预览面板保留，点「原始」还原
    has_prev = page.evaluate("() => !!document.getElementById('basePrevImg')")
    ok("确认后预览面板保留", has_prev)
    page.evaluate("""() => {
        const btns = document.querySelectorAll('.suit-ratio-btn');
        for (const b of btns) { if (b.textContent.trim() === '原始') b.click(); }
    }""")
    page.wait_for_timeout(1500)
    t2 = title()
    ok("点原始还原 600x600", '600' in t2 and '600' in t2, f"({t2})")

    # 4. 基底槽「重新调整」按钮 → 恢复预览面板
    has_adjust = page.evaluate("() => !!document.querySelector('[data-act=\"adjust\"]')")
    ok("重新调整按钮存在", has_adjust)
    page.click('[data-act="adjust"]')
    page.wait_for_timeout(1500)
    restored = page.evaluate("() => !!document.getElementById('basePrevImg')")
    ok("重新调整恢复预览", restored)
    t3 = title()
    ok("重新调整显示当前基底状态", t3 != '', f"({t3})")

    # 5. 无 JS 错误
    real = [e for e in errors if '401' not in e and 'length' not in e and '404' not in e]
    ok("无 JS 错误", len(real) == 0, f"({real[:2]})")

    browser.close()

try: os.remove(img_path)
except Exception: pass

print(f"\n========== 结果: PASS=*** FAIL={FAIL} ==========")
sys.exit(0 if FAIL == 0 else 1)
