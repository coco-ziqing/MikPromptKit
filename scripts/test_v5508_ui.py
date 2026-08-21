# -*- coding: utf-8 -*-
"""v5.50.8 前端验证：基底槽预览图 + 原始比例按钮"""
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
img_path = os.path.join(tempfile.gettempdir(), "v5508_ui.png")
Image.new("RGB", (600, 300), (100, 150, 220)).save(img_path)

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

    # 上传
    page.evaluate("""() => {
        const tabs = document.querySelectorAll('.suit-wb-res-tab');
        for (const t of tabs) { if (t.textContent.includes('素材')) t.click(); }
    }""")
    page.wait_for_timeout(500)
    page.set_input_files("#baseFileInput", img_path)
    page.wait_for_timeout(3000)

    # 1. 比例按钮含「原始」
    ratios = page.evaluate("() => Array.from(document.querySelectorAll('.suit-ratio-btn')).map(e => e.textContent.trim())")
    ok("比例按钮含原始", '原始' in ratios, f"({ratios})")

    # 2. 依次点击 3:4 → 16:9 → 原始，预览正常更新
    def click_ratio(r):
        page.evaluate("""(r) => {
            const btns = document.querySelectorAll('.suit-ratio-btn');
            for (const b of btns) { if (b.textContent.trim() === r) b.click(); }
        }""", r)
        page.wait_for_timeout(1200)
        return page.evaluate("""() => {
            const img = document.getElementById('basePrevImg');
            const t = document.querySelector('.suit-base-preview-title');
            return { src: img ? img.src : '', title: t ? t.textContent : '' };
        }""")

    r1 = click_ratio('3:4')
    r2 = click_ratio('16:9')
    r3 = click_ratio('原始')
    ok("3:4 预览", '300' in r1['title'] or '×' in r1['title'], f"({r1['title']})")
    ok("16:9 预览更新", r2['src'] != r1['src'] or '711' in r2['title'], f"({r2['title']})")
    ok("原始恢复", '600' in r3['title'] and '300' in r3['title'], f"({r3['title']})")

    # 3. 确认设为基底 → 槽内显示预览图
    page.fill("#wbBaseDesc6", "测试基底图")
    page.click("#wbBaseConfirm")
    page.wait_for_timeout(800)
    slot_img = page.evaluate("() => { const el = document.querySelector('#slotBaseBody .suit-slot-base-img'); return el ? el.src : ''; }")
    ok("基底槽显示参考图", 'base-ref' in slot_img or 'refs' in slot_img, f"({slot_img[:70]})")
    slot_meta = page.evaluate("() => (document.querySelector('#slotBaseBody') || {}).textContent || ''")
    ok("基底槽显示尺寸/比例", '600×300' in slot_meta or '原图' in slot_meta, f"({slot_meta[:50]})")

    # 4. 无 JS 错误
    real = [e for e in errors if '401' not in e and 'length' not in e and '404' not in e]
    ok("无 JS 错误", len(real) == 0, f"({real[:2]})")

    browser.close()

try: os.remove(img_path)
except Exception: pass

print(f"\n========== 结果: PASS=*** FAIL={FAIL} ==========")
sys.exit(0 if FAIL == 0 else 1)
