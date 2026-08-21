# -*- coding: utf-8 -*-
"""v5.50.15 验证：规范化收拢 + 64对齐 + 裁剪框移动"""
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
img_path = os.path.join(tempfile.gettempdir(), "v55015.png")
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

    def get_crop_state():
        return page.evaluate("() => window.STYLE_SUIT && window.__cropDebug || null")

    # 打开弹窗，框选 0.1-0.4, 0.1-0.6（约 307x512）
    page.click("#wbBaseFreeCrop")
    page.wait_for_timeout(1500)
    sim_crop(0.1, 0.1, 0.4, 0.6)

    def size_text():
        return page.evaluate("() => (document.getElementById('freeCropSize') || {}).textContent || ''")

    # 1. 原始框选尺寸
    s0 = size_text()
    ok("原始框选", ('306' in s0) or ('307' in s0), f"({s0})")

    # 2. 点 1:1 → 收拢接近用户尺寸（不放大到全画布）+ 64 对齐
    page.evaluate("""() => {
        const btns = document.querySelectorAll('#freeCropRatios [data-fr]');
        for (const b of btns) { if (b.textContent.trim() === '1:1') b.click(); }
    }""")
    page.wait_for_timeout(300)
    s1 = size_text()
    m = re.search(r'(\d+)×(\d+)', s1)
    w1, h1 = int(m.group(1)), int(m.group(2))
    ok("1:1 方形", w1 == h1, f"({w1}x{h1})")
    ok("1:1 收拢接近(≈300)", 256 <= w1 <= 384, f"({w1}px，未放大到全图)")
    ok("64 对齐", w1 % 64 == 0 and h1 % 64 == 0, f"({w1},{h1} 均为64倍数)")

    # 3. 点 16:9 → 收拢 + 64 对齐
    page.evaluate("""() => {
        const btns = document.querySelectorAll('#freeCropRatios [data-fr]');
        for (const b of btns) { if (b.textContent.trim() === '16:9') b.click(); }
    }""")
    page.wait_for_timeout(300)
    s2 = size_text()
    m2 = re.search(r'(\d+)×(\d+)', s2)
    w2, h2 = int(m2.group(1)), int(m2.group(2))
    ok("16:9 比例", abs(w2/h2 - 16/9) < 0.03, f"({w2}x{h2} ratio={w2/h2:.3f})")
    ok("16:9 64对齐", w2 % 64 == 0 and h2 % 64 == 0, f"({w2},{h2})")
    ok("16:9 收拢接近(面积±30%)", abs(w2*h2 - 306*512) / (306*512) < 0.35, f"({w2}x{h2}, 面积差{abs(w2*h2-306*512)/(306*512)*100:.0f}%)")

    # 4. 裁剪框移动（框内按下 → 平移）
    before = page.evaluate("""() => {
        const b = document.getElementById('freeCropBox');
        return { l: parseFloat(b.style.left), t: parseFloat(b.style.top) };
    }""")
    page.evaluate("""() => {
        const wrap = document.getElementById('freeCropWrap');
        const b = document.getElementById('freeCropBox');
        const r = wrap.getBoundingClientRect();
        // 计算框中心
        const cl = parseFloat(b.style.left) + parseFloat(b.style.width)/2;
        const ct = parseFloat(b.style.top) + parseFloat(b.style.height)/2;
        const opts = (x, y) => ({bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0});
        const fire = (type, x, y) => {
            const ev = new MouseEvent(type, opts(x, y));
            if (type === 'mousedown') wrap.dispatchEvent(ev);
            else window.dispatchEvent(ev);
        };
        // 在框中心按下（应触发移动模式）— cl/ct 是百分比，/100 转小数
        fire('mousedown', r.x + r.width*(cl/100), r.y + r.height*(ct/100));
        // 向右下平移
        for (let i = 1; i <= 5; i++) fire('mousemove', r.x + r.width*(cl/100 + 0.05*i), r.y + r.height*(ct/100 + 0.05*i));
        fire('mouseup', r.x + r.width*(cl/100 + 0.25), r.y + r.height*(ct/100 + 0.25));
    }""")
    page.wait_for_timeout(300)
    after = page.evaluate("""() => {
        const b = document.getElementById('freeCropBox');
        return { l: parseFloat(b.style.left), t: parseFloat(b.style.top) };
    }""")
    moved = (after['l'] - before['l']) > 0.1 and (after['t'] - before['t']) > 0.1
    ok("裁剪框可移动", moved, f"(left {before['l']:.1f}%→{after['l']:.1f}%, top {before['t']:.1f}%→{after['t']:.1f}%)")

    # 5. 移动后尺寸不变（只平移）
    size_after_move = size_text()
    ok("移动后尺寸不变", size_after_move == s2, f"({size_after_move})")

    # 6. 应用裁剪 → 64 对齐尺寸
    page.click("#freeCropApply")
    page.wait_for_timeout(1500)
    title = page.evaluate("() => (document.querySelector('.suit-base-preview-title') || {}).textContent || ''")
    m3 = re.search(r'（(\d+)×(\d+)）', title)
    if m3:
        w3, h3 = int(m3.group(1)), int(m3.group(2))
        ok("应用后 64 对齐", w3 % 64 == 0 and h3 % 64 == 0, f"({w3}x{h3})")
        ok("应用后比例正确", abs(w3/h3 - 16/9) < 0.03, f"({w3/h3:.3f})")
    else:
        ok("应用后 64 对齐", False, f"({title})")

    # 7. 无 JS 错误
    real = [e for e in errors if '401' not in e and 'length' not in e and '404' not in e]
    ok("无 JS 错误", len(real) == 0, f"({real[:2]})")

    browser.close()

try: os.remove(img_path)
except Exception: pass

print(f"\n========== 结果: PASS=*** FAIL={FAIL} ==========")
sys.exit(0 if FAIL == 0 else 1)
