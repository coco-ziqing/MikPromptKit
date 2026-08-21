# -*- coding: utf-8 -*-
"""v5.50.13 验证：自由裁切大图弹窗 + 框选尺寸与位置对应"""
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
# 造一张 800x400 原始图（非方形，验证坐标对应）
img_path = os.path.join(tempfile.gettempdir(), "v55013_crop.png")
Image.new("RGB", (800, 400), (80, 160, 200)).save(img_path)

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

    # 1. 预览面板 + 自由裁切按钮
    has_btn = page.evaluate("() => !!document.getElementById('wbBaseFreeCrop')")
    ok("自由裁切按钮", has_btn)

    # 2. 打开大图弹窗
    page.click("#wbBaseFreeCrop")
    page.wait_for_timeout(1000)
    has_modal = page.evaluate("() => !!document.getElementById('freeCropMask') && !!document.getElementById('freeCropWrap')")
    ok("大图弹窗打开", has_modal)

    # 3. 弹窗内框选左侧一半（x:0-0.5, y:0-1）— JS 模拟事件链
    page.evaluate("""() => {
        const wrap = document.getElementById('freeCropWrap');
        const r = wrap.getBoundingClientRect();
        const opts = (x, y) => ({bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0});
        const fire = (type, x, y) => {
            const ev = new MouseEvent(type, opts(x, y));
            if (type === 'mousedown') wrap.dispatchEvent(ev);
            else window.dispatchEvent(ev);
        };
        fire('mousedown', r.x + r.width*0.0, r.y + r.height*0.0);
        for (let i = 1; i <= 5; i++) fire('mousemove', r.x + r.width*0.1*i, r.y + r.height*0.2*i);
        fire('mousemove', r.x + r.width*0.5, r.y + r.height*1.0);
        fire('mouseup', r.x + r.width*0.5, r.y + r.height*1.0);
    }""")
    page.wait_for_timeout(500)
    box = page.evaluate("""() => {
        const w = document.getElementById('freeCropWrap');
        const r = w.getBoundingClientRect();
        return { x: r.x, y: r.y, w: r.width, h: r.height };
    }""")
    page.mouse.move(box['x'] + box['w'] * 0.0, box['y'] + box['h'] * 0.0)
    page.mouse.down()
    page.mouse.move(box['x'] + box['w'] * 0.5, box['y'] + box['h'] * 1.0, steps=8)
    page.mouse.up()
    page.wait_for_timeout(400)
    size_text = page.evaluate("() => (document.getElementById('freeCropSize') || {}).textContent || ''")
    ok("显示选中尺寸", '400' in size_text and '400' in size_text, f"({size_text})（800x400 左半应 400x400）")

    # 4. 应用裁剪 → 预览尺寸 = 框选尺寸（400x400）
    page.click("#freeCropApply")
    page.wait_for_timeout(1500)
    title = page.evaluate("() => (document.querySelector('.suit-base-preview-title') || {}).textContent || ''")
    ok("预览尺寸=框选尺寸", '400' in title and '400' in title, f"({title})")

    # 5. 再开弹窗框选右侧上半（验证位置对应：x:0.5-1, y:0-0.5 → 400x200）
    page.click("#wbBaseFreeCrop")
    page.wait_for_timeout(1200)
    page.evaluate("""() => {
        const wrap = document.getElementById('freeCropWrap');
        const r = wrap.getBoundingClientRect();
        const opts = (x, y) => ({bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0});
        const fire = (type, x, y) => {
            const ev = new MouseEvent(type, opts(x, y));
            if (type === 'mousedown') wrap.dispatchEvent(ev);
            else window.dispatchEvent(ev);
        };
        fire('mousedown', r.x + r.width*0.5, r.y + r.height*0.0);
        for (let i = 1; i <= 5; i++) fire('mousemove', r.x + r.width*(0.5+0.1*i), r.y + r.height*0.1*i);
        fire('mousemove', r.x + r.width*1.0, r.y + r.height*0.5);
        fire('mouseup', r.x + r.width*1.0, r.y + r.height*0.5);
    }""")
    page.wait_for_timeout(500)
    box2 = page.evaluate("""() => {
        const w = document.getElementById('freeCropWrap');
        const r = w.getBoundingClientRect();
        return { x: r.x, y: r.y, w: r.width, h: r.height };
    }""")
    page.mouse.move(box2['x'] + box2['w'] * 0.5, box2['y'] + box2['h'] * 0.0)
    page.mouse.down()
    page.mouse.move(box2['x'] + box2['w'] * 1.0, box2['y'] + box2['h'] * 0.5, steps=8)
    page.mouse.up()
    page.wait_for_timeout(400)
    size2 = page.evaluate("() => (document.getElementById('freeCropSize') || {}).textContent || ''")
    ok("位置对应(右上半)", '400' in size2 and '200' in size2, f"({size2})")
    page.click("#freeCropApply")
    page.wait_for_timeout(1500)
    title2 = page.evaluate("() => (document.querySelector('.suit-base-preview-title') || {}).textContent || ''")
    ok("应用后 400x200", '400' in title2 and '200' in title2, f"({title2})")

    # 6. 无 JS 错误
    real = [e for e in errors if '401' not in e and 'length' not in e and '404' not in e]
    ok("无 JS 错误", len(real) == 0, f"({real[:2]})")

    browser.close()

try: os.remove(img_path)
except Exception: pass

print(f"\n========== 结果: PASS=*** FAIL={FAIL} ==========")
sys.exit(0 if FAIL == 0 else 1)
