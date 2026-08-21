# -*- coding: utf-8 -*-
"""v5.50.18 验证：裁切框手柄调整（等比/单边）"""
import sys, re
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
img_path = os.path.join(tempfile.gettempdir(), "v55018.png")
Image.new("RGB", (1024, 1024), (80, 160, 200)).save(img_path)

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

    def sim_crop(x1, y1, x2, y2):
        page.evaluate("""(p) => {
            const wrap = document.getElementById('freeCropWrap');
            const r = wrap.getBoundingClientRect();
            const opts = (x, y) => ({bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0});
            const fire = (type, x, y) => {
                const ev = new MouseEvent(type, opts(x, y));
                if (type === 'mousedown') wrap.dispatchEvent(ev);
                else window.dispatchEvent(ev);
            };
            fire('mousedown', r.x + r.width*p.x1, r.y + r.height*p.y1);
            for (let i = 1; i <= 5; i++) fire('mousemove', r.x + r.width*(p.x1+(p.x2-p.x1)*i/6), r.y + r.height*(p.y1+(p.y2-p.y1)*i/6));
            fire('mousemove', r.x + r.width*p.x2, r.y + r.height*p.y2);
            fire('mouseup', r.x + r.width*p.x2, r.y + r.height*p.y2);
        }""", {"x1": x1, "y1": y1, "x2": x2, "y2": y2})
        page.wait_for_timeout(300)

    def drag_handle(handle, dx_ratio, dy_ratio):
        """从指定手柄位置按下（角=框角，边=边中点），拖到 dx/dy（相对图的比例偏移）"""
        page.evaluate("""(p) => {
            const wrap = document.getElementById('freeCropWrap');
            const b = document.getElementById('freeCropBox');
            const h = b.querySelector('[data-handle="' + p.h + '"]');
            const r = wrap.getBoundingClientRect();
            const br = b.getBoundingClientRect();
            // 按手柄类型计算按下位置（框角或边中点）
            let hx, hy;
            if (p.h.indexOf('w') >= 0) hx = br.x;
            else if (p.h.indexOf('e') >= 0) hx = br.x + br.width;
            else hx = br.x + br.width/2;
            if (p.h.indexOf('n') >= 0) hy = br.y;
            else if (p.h.indexOf('s') >= 0) hy = br.y + br.height;
            else hy = br.y + br.height/2;
            const opts = (x, y) => ({bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0});
            const fire = (type, x, y) => {
                const ev = new MouseEvent(type, opts(x, y));
                if (type === 'mousedown') h.dispatchEvent(ev);
                else window.dispatchEvent(ev);
            };
            fire('mousedown', hx, hy);
            for (let i = 1; i <= 4; i++) fire('mousemove', hx + r.width*p.dx*i/4, hy + r.height*p.dy*i/4);
            fire('mousemove', hx + r.width*p.dx, hy + r.height*p.dy);
            fire('mouseup', hx + r.width*p.dx, hy + r.height*p.dy);
        }""", {"h": handle, "dx": dx_ratio, "dy": dy_ratio})
        page.wait_for_timeout(300)

    def crop_state():
        return page.evaluate("""() => {
            const b = document.getElementById('freeCropBox');
            return { x: parseFloat(b.style.left), y: parseFloat(b.style.top),
                     w: parseFloat(b.style.width), h: parseFloat(b.style.height) };
        }""")

    # 打开弹窗，框选
    page.click("#wbBaseFreeCrop")
    page.wait_for_timeout(1500)
    sim_crop(0.1, 0.1, 0.4, 0.4)

    # 1. 手柄存在（8 个）
    n_handles = page.evaluate("() => document.querySelectorAll('#freeCropBox .suit-crop-handle').length")
    ok("8 个调整手柄", n_handles == 8, f"({n_handles})")

    # 2. 等比缩放：拖 SE 角向右下（保持比例）
    c0 = crop_state()
    drag_handle('se', 0.15, 0.15)
    c1 = crop_state()
    ratio0 = c0['w'] / c0['h']
    ratio1 = c1['w'] / c1['h']
    ok("SE角等比缩放", abs(ratio1 - ratio0) < 0.01, f"(ratio {ratio0:.3f}->{ratio1:.3f})")
    ok("SE角放大", c1['w'] > c0['w'], f"(w {c0['w']:.1f}%->{c1['w']:.1f}%)")

    # 3. 单边拉伸：拖 E 边向右（只变宽，比例改变）
    c2 = crop_state()
    drag_handle('e', 0.2, 0)
    c3 = crop_state()
    ok("E边单边拉宽", c3['w'] > c2['w'] and abs(c3['h'] - c2['h']) < 0.001, f"(w {c2['w']:.1f}->{c3['w']:.1f}, h {c2['h']:.1f}->{c3['h']:.1f})")

    # 4. 单边拉伸：拖 S 边向下（只变高）
    c4 = crop_state()
    drag_handle('s', 0, 0.15)
    c5 = crop_state()
    ok("S边单边拉高", c5['h'] > c4['h'] and abs(c5['w'] - c4['w']) < 0.001, f"(h {c4['h']:.1f}->{c5['h']:.1f})")

    # 5. 移动仍正常（框内拖动）
    c6 = crop_state()
    page.evaluate("""() => {
        const wrap = document.getElementById('freeCropWrap');
        const b = document.getElementById('freeCropBox');
        const r = wrap.getBoundingClientRect();
        const cl = parseFloat(b.style.left) + parseFloat(b.style.width)/2;
        const ct = parseFloat(b.style.top) + parseFloat(b.style.height)/2;
        const opts = (x, y) => ({bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0});
        const fire = (type, x, y) => {
            const ev = new MouseEvent(type, opts(x, y));
            if (type === 'mousedown') wrap.dispatchEvent(ev);
            else window.dispatchEvent(ev);
        };
        fire('mousedown', r.x + r.width*(cl/100), r.y + r.height*(ct/100));
        fire('mousemove', r.x + r.width*(cl/100 + 0.1), r.y + r.height*(ct/100 + 0.1));
        fire('mouseup', r.x + r.width*(cl/100 + 0.1), r.y + r.height*(ct/100 + 0.1));
    }""")
    page.wait_for_timeout(300)
    c7 = crop_state()
    ok("移动仍正常", c7['x'] > c6['x'] and abs(c7['w'] - c6['w']) < 0.001, f"(x {c6['x']:.1f}->{c7['x']:.1f})")

    # 6. 规范化后仍可手柄调整（1:1 后拖 E 边变宽）
    page.evaluate("""() => {
        const btns = document.querySelectorAll('#freeCropRatios [data-fr]');
        for (const b of btns) { if (b.textContent.trim() === '1:1') b.click(); }
    }""")
    page.wait_for_timeout(300)
    c8 = crop_state()
    ok("规范化后方形", abs(c8['w']/c8['h'] - 1) < 0.001, f"({c8['w']:.1f}x{c8['h']:.1f})")
    drag_handle('e', 0.15, 0)
    c9 = crop_state()
    ok("规范化后单边可调", c9['w'] > c8['w'], f"(w {c8['w']:.1f}->{c9['w']:.1f})")

    # 7. 无 JS 错误
    real = [e for e in errors if '401' not in e and 'length' not in e and '404' not in e]
    ok("无 JS 错误", len(real) == 0, f"({real[:2]})")

    browser.close()

try: os.remove(img_path)
except Exception: pass

print(f"\n========== 结果: PASS=*** FAIL={FAIL} ==========")
sys.exit(0 if FAIL == 0 else 1)
