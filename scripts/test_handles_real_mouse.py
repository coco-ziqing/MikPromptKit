# -*- coding: utf-8 -*-
"""v5.50.20 验证：真实鼠标操作手柄（等比/单边/移动）"""
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
img_path = os.path.join(tempfile.gettempdir(), "v55020_real.png")
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
    page.click("#wbBaseFreeCrop")
    page.wait_for_timeout(1500)

    # JS 画框（画框本身用 JS 模拟，手柄用真实鼠标）
    page.evaluate("""() => {
        const wrap = document.getElementById('freeCropWrap');
        const r = wrap.getBoundingClientRect();
        const opts = (x, y) => ({bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0});
        const fire = (type, x, y) => {
            const ev = new MouseEvent(type, opts(x, y));
            if (type === 'mousedown') wrap.dispatchEvent(ev);
            else window.dispatchEvent(ev);
        };
        fire('mousedown', r.x + r.width*0.1, r.y + r.height*0.1);
        for (let i = 1; i <= 5; i++) fire('mousemove', r.x + r.width*(0.1+0.3*i/6), r.y + r.height*(0.1+0.3*i/6));
        fire('mousemove', r.x + r.width*0.4, r.y + r.height*0.4);
        fire('mouseup', r.x + r.width*0.4, r.y + r.height*0.4);
    }""")
    page.wait_for_timeout(300)

    def handle_pos(hp):
        return page.evaluate("""(hp) => {
            const h = document.querySelector('#freeCropBox .suit-crop-handle.' + hp);
            const r = h.getBoundingClientRect();
            return { x: Math.round(r.x + r.width/2), y: Math.round(r.y + r.height/2) };
        }""", hp)

    def drag_mouse(hp, dx, dy):
        pos = handle_pos(hp)
        page.mouse.move(pos['x'], pos['y'])
        page.mouse.down()
        page.mouse.move(pos['x'] + dx, pos['y'] + dy, steps=6)
        page.mouse.up()
        page.wait_for_timeout(400)

    def box_state():
        return page.evaluate("""() => {
            const b = document.getElementById('freeCropBox');
            return { w: parseFloat(b.style.width), h: parseFloat(b.style.height),
                     l: parseFloat(b.style.left), t: parseFloat(b.style.top) };
        }""")

    # 1. SE 角等比放大
    c0 = box_state()
    drag_mouse('se', 100, 100)
    c1 = box_state()
    ok("SE角等比放大", c1['w'] > c0['w'] + 5, f"(w {c0['w']:.1f}->{c1['w']:.1f})")
    ok("SE角保持比例", abs(c1['w']/c1['h'] - c0['w']/c0['h']) < 0.01, f"(ratio {c0['w']/c0['h']:.3f}->{c1['w']/c1['h']:.3f})")

    # 2. E 边单边拉宽
    c2 = box_state()
    drag_mouse('e', 80, 0)
    c3 = box_state()
    ok("E边单边拉宽", c3['w'] > c2['w'] + 3, f"(w {c2['w']:.1f}->{c3['w']:.1f})")
    ok("E边高度不变", abs(c3['h'] - c2['h']) < 0.1, f"(h {c2['h']:.1f}->{c3['h']:.1f})")

    # 3. S 边单边拉高
    c4 = box_state()
    drag_mouse('s', 0, 80)
    c5 = box_state()
    ok("S边单边拉高", c5['h'] > c4['h'] + 3, f"(h {c4['h']:.1f}->{c5['h']:.1f})")
    ok("S边宽度不变", abs(c5['w'] - c4['w']) < 0.1, f"(w {c4['w']:.1f}->{c5['w']:.1f})")

    # 4. 框内移动（真实鼠标）
    c6 = box_state()
    center = page.evaluate("""() => {
        const b = document.getElementById('freeCropBox');
        const r = b.getBoundingClientRect();
        return { x: Math.round(r.x + r.width/2), y: Math.round(r.y + r.height/2) };
    }""")
    page.mouse.move(center['x'], center['y'])
    page.mouse.down()
    page.mouse.move(center['x'] + 60, center['y'] + 40, steps=5)
    page.mouse.up()
    page.wait_for_timeout(400)
    c7 = box_state()
    ok("框内移动", c7['l'] > c6['l'] + 2 and c7['t'] > c6['t'] + 1, f"(l {c6['l']:.1f}->{c7['l']:.1f}, t {c6['t']:.1f}->{c7['t']:.1f})")
    ok("移动尺寸不变", abs(c7['w'] - c6['w']) < 0.1, f"(w {c6['w']:.1f}->{c7['w']:.1f})")

    # 5. 无 JS 错误
    real = [e for e in errors if '401' not in e and 'length' not in e and '404' not in e]
    ok("无 JS 错误", len(real) == 0, f"({real[:2]})")

    browser.close()

try: os.remove(img_path)
except Exception: pass

print(f"\n========== 结果: PASS=*** FAIL={FAIL} ==========")
sys.exit(0 if FAIL == 0 else 1)
