# -*- coding: utf-8 -*-
"""v5.50.10 验证：手动框选裁剪"""
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
img_path = os.path.join(tempfile.gettempdir(), "v55010_crop.png")
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

    # 上传
    page.evaluate("""() => {
        const tabs = document.querySelectorAll('.suit-wb-res-tab');
        for (const t of tabs) { if (t.textContent.includes('素材')) t.click(); }
    }""")
    page.wait_for_timeout(500)
    page.set_input_files("#baseFileInput", img_path)
    page.wait_for_timeout(3000)

    # 1. 框选容器存在
    has_wrap = page.evaluate("() => !!document.getElementById('baseCropWrap') && !!document.getElementById('baseCropBox')")
    ok("框选容器渲染", has_wrap)

    # 2. 拖拽框选（在图上从 10%,10% 拖到 60%,60%）
    box = page.evaluate("""() => {
        const w = document.getElementById('baseCropWrap');
        const r = w.getBoundingClientRect();
        return { x: r.x, y: r.y, w: r.width, h: r.height };
    }""")
    page.mouse.move(box['x'] + box['w'] * 0.1, box['y'] + box['h'] * 0.1)
    page.mouse.down()
    page.mouse.move(box['x'] + box['w'] * 0.6, box['y'] + box['h'] * 0.6, steps=8)
    page.mouse.up()
    page.wait_for_timeout(400)
    crop_visible = page.evaluate("() => document.getElementById('baseCropBox').style.display === 'block'")
    ok("拖拽出选框", crop_visible)
    acts_visible = page.evaluate("() => document.getElementById('baseCropActions').style.display === 'flex'")
    ok("应用按钮出现", acts_visible)

    # 3. 应用框选裁剪 → 预览尺寸变化（600x600 框选一半 → 约 300x300）
    title_before = page.evaluate("() => document.querySelector('.suit-base-preview-title').textContent")
    page.click("#wbBaseCropApply")
    page.wait_for_timeout(1500)
    title_after = page.evaluate("() => document.querySelector('.suit-base-preview-title').textContent")
    ok("框选后预览更新", title_after != title_before, f"({title_before} -> {title_after})")
    ok("框选裁剪生效(更小)", '300' in title_after or '301' in title_after, f"({title_after})")

    # 4. 再次框选（重新获取容器坐标，apply 后页面已重渲染）
    box2 = page.evaluate("""() => {
        const w = document.getElementById('baseCropWrap');
        const r = w.getBoundingClientRect();
        return { x: r.x, y: r.y, w: r.width, h: r.height };
    }""")
    page.mouse.move(box2['x'] + box2['w'] * 0.05, box2['y'] + box2['h'] * 0.05)
    page.mouse.down()
    page.mouse.move(box2['x'] + box2['w'] * 0.3, box2['y'] + box2['h'] * 0.3, steps=5)
    page.mouse.up()
    page.wait_for_timeout(300)
    crop2 = page.evaluate("() => document.getElementById('baseCropBox').style.display === 'block'")
    ok("二次框选可用", crop2)
    page.click("#wbBaseCropApply", timeout=5000)
    page.wait_for_timeout(1200)
    title3 = page.evaluate("() => document.querySelector('.suit-base-preview-title').textContent")
    ok("连续框选生效", '15' in title3 and '0' in title3, f"({title3})")

    # 5. 确认设为基底
    page.fill("#wbBaseDesc6", "框选裁剪测试")
    page.click("#wbBaseConfirm")
    page.wait_for_timeout(600)
    slot = page.evaluate("() => (document.querySelector('#slotBaseBody') || {}).textContent || ''")
    ok("基底确认成功", '框选裁剪测试' in slot, f"({slot[:40]})")

    # 6. 无 JS 错误
    real = [e for e in errors if '401' not in e and 'length' not in e and '404' not in e]
    ok("无 JS 错误", len(real) == 0, f"({real[:2]})")

    browser.close()

try: os.remove(img_path)
except Exception: pass

print(f"\n========== 结果: PASS=*** FAIL={FAIL} ==========")
sys.exit(0 if FAIL == 0 else 1)
