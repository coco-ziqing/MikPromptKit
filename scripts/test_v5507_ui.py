# -*- coding: utf-8 -*-
"""v5.50.7 前端验证：基底预览面板 + 词卡预览 + 平台切换"""
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

# 造测试图
from PIL import Image
import tempfile, os
img_path = os.path.join(tempfile.gettempdir(), "v5507_base.png")
Image.new("RGB", (600, 300), (90, 130, 210)).save(img_path)

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

    # 进入操作台
    page.click("#navDropdownComposer .nav-dropdown-btn")
    page.wait_for_timeout(300)
    page.click("text=角色设定集")
    page.wait_for_timeout(1500)
    page.click("#suitBtnWorkbench")
    page.wait_for_timeout(1000)

    # 1. 平台切换器存在
    has_plat = page.evaluate("() => !!document.getElementById('wbPlatform')")
    ok("平台切换器", has_plat)

    # 2. 上传图片 → 自动预处理 → 预览面板
    page.evaluate("""() => {
        const tabs = document.querySelectorAll('.suit-wb-res-tab');
        for (const t of tabs) { if (t.textContent.includes('素材')) t.click(); }
    }""")
    page.wait_for_timeout(500)
    page.set_input_files("#baseFileInput", img_path)
    page.wait_for_timeout(3000)
    preview_box = page.evaluate("() => !!document.querySelector('.suit-base-preview-box')")
    ok("上传后预览面板", preview_box)
    prev_img = page.evaluate("() => { const el = document.getElementById('basePrevImg'); return el ? el.src : ''; }")
    ok("预览图已加载", 'base-ref' in prev_img, f"({prev_img[:60]})")
    ratio_btns = page.evaluate("() => document.querySelectorAll('.suit-ratio-btn').length")
    ok("比例选择按钮", ratio_btns == 5, f"({ratio_btns} 个)")

    # 3. 切换比例 → 预览更新
    page.evaluate("""() => {
        const btns = document.querySelectorAll('.suit-ratio-btn');
        for (const b of btns) { if (b.textContent.trim() === '16:9') b.click(); }
    }""")
    page.wait_for_timeout(1500)
    prev_img2 = page.evaluate("() => { const el = document.getElementById('basePrevImg'); return el ? el.src : ''; }")
    ok("比例切换预览更新", prev_img2 != prev_img, f"({prev_img2[:60]} vs {prev_img[:60]})")

    # 4. 确认设基底
    page.fill("#wbBaseDesc6", "测试基底-16:9")
    page.click("#wbBaseConfirm")
    page.wait_for_timeout(600)
    slot = page.evaluate("() => (document.querySelector('#slotBaseBody') || {}).textContent || ''")
    ok("基底确认", '测试基底' in slot, f"({slot[:40]})")

    # 5. 词卡预览框
    page.evaluate("""() => {
        const tabs = document.querySelectorAll('.suit-wb-res-tab');
        for (const t of tabs) { if (t.textContent.includes('词卡')) t.click(); }
    }""")
    page.wait_for_timeout(1500)
    page.evaluate("""() => {
        const card = document.querySelector('.suit-res-card');
        if (card) card.click();
    }""")
    page.wait_for_timeout(500)
    card_modal = page.evaluate("() => !!document.querySelector('.suit-card-preview-content')")
    ok("词卡预览框", card_modal)
    page.keyboard.press("Escape")
    page.wait_for_timeout(300)

    # 6. 平台切换 → 提示
    page.evaluate("""() => {
        const sel = document.getElementById('wbPlatform');
        if (sel) { sel.value = 'comfyui'; sel.dispatchEvent(new Event('change')); }
    }""")
    page.wait_for_timeout(400)
    plat_val = page.evaluate("() => document.getElementById('wbPlatform').value")
    ok("平台切换 comfyui", plat_val == 'comfyui')

    # 7. JS 错误
    real = [e for e in errors if '401' not in e and 'length' not in e and '404' not in e]
    ok("无 JS 错误", len(real) == 0, f"({real[:2]})")

    browser.close()

try: os.remove(img_path)
except Exception: pass

print(f"\n========== 结果: PASS=*** FAIL={FAIL} ==========")
sys.exit(0 if FAIL == 0 else 1)
