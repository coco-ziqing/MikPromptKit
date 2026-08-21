# -*- coding: utf-8 -*-
"""v5.50.17 验证：竖图(725x1288)框选与规范化显示比例正确"""
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
img_path = os.path.join(tempfile.gettempdir(), "v55017_portrait.png")
Image.new("RGB", (725, 1288), (80, 160, 200)).save(img_path)

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

    # 打开弹窗，检查 wrap/img 比例是否贴合（无横向留白）
    page.click("#wbBaseFreeCrop")
    page.wait_for_timeout(1500)
    dims = page.evaluate("""() => {
        const wrap = document.getElementById('freeCropWrap');
        const img = document.getElementById('freeCropImg');
        const wr = wrap.getBoundingClientRect();
        const ir = img.getBoundingClientRect();
        return { wrap: {w: Math.round(wr.width), h: Math.round(wr.height)},
                 img: {w: Math.round(ir.width), h: Math.round(ir.height)},
                 natural: {w: img.naturalWidth, h: img.naturalHeight} };
    }""")
    print("容器/图尺寸:", dims)
    # wrap 应贴合 img（宽高比接近 725:1288）
    wr_ratio = dims['wrap']['w'] / dims['wrap']['h']
    img_ratio = dims['img']['w'] / dims['img']['h']
    nat_ratio = dims['natural']['w'] / dims['natural']['h']
    ok("容器贴合图(竖)", abs(wr_ratio - nat_ratio) < 0.02, f"(wrap={wr_ratio:.3f} img={img_ratio:.3f} nat={nat_ratio:.3f})")

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

    def click_ratio(r):
        page.evaluate("""(r) => {
            const btns = document.querySelectorAll('#freeCropRatios [data-fr]');
            for (const b of btns) { if (b.textContent.trim() === r) b.click(); }
        }""", r)
        page.wait_for_timeout(300)

    def box_rect_px():
        # 返回框的显示像素宽高（相对 wrap 百分比 × wrap 尺寸）
        return page.evaluate("""() => {
            const b = document.getElementById('freeCropBox');
            const wrap = document.getElementById('freeCropWrap');
            const wr = wrap.getBoundingClientRect();
            const w = parseFloat(b.style.width) / 100 * wr.width;
            const h = parseFloat(b.style.height) / 100 * wr.height;
            return { w: w, h: h, ratio: w / h };
        }""")

    # 框选一块区域
    sim_crop(0.1, 0.1, 0.4, 0.4)

    # 1:1 规范化 → 显示框应为正方形（视觉 + 像素）
    click_ratio('1:1')
    b1 = box_rect_px()
    ok("1:1 显示正方形", abs(b1['ratio'] - 1.0) < 0.02, f"(显示 {b1['w']:.0f}x{b1['h']:.0f} ratio={b1['ratio']:.3f})")
    s1 = page.evaluate("() => (document.getElementById('freeCropSize') || {}).textContent || ''")
    m1 = re.search(r'(\d+)×(\d+)', s1)
    w1, h1 = int(m1.group(1)), int(m1.group(2))
    ok("1:1 像素正方形", w1 == h1, f"({w1}x{h1})")

    # 3:4 规范化 → 显示竖长方形（3:4）
    click_ratio('3:4')
    b2 = box_rect_px()
    ok("3:4 显示竖比例", abs(b2['ratio'] - 0.75) < 0.02, f"(显示 ratio={b2['ratio']:.3f})")

    # 16:9 → 显示横长方形
    click_ratio('16:9')
    b3 = box_rect_px()
    ok("16:9 显示横比例", abs(b3['ratio'] - 16/9) < 0.02, f"(显示 ratio={b3['ratio']:.3f})")

    # 应用 → 后端 64 对齐，像素比例应接近选择比例
    click_ratio('1:1')
    page.click("#freeCropApply")
    page.wait_for_timeout(1500)
    title = page.evaluate("() => (document.querySelector('.suit-base-preview-title') || {}).textContent || ''")
    m5 = re.search(r'（(\d+)×(\d+)）', title)
    if m5:
        w5, h5 = int(m5.group(1)), int(m5.group(2))
        ok("应用后 64 对齐", w5 % 64 == 0 and h5 % 64 == 0, f"({w5}x{h5})")
        ok("应用后 1:1 接近", abs(w5/h5 - 1.0) < 0.03, f"({w5/h5:.3f})")
    else:
        ok("应用后 64 对齐", False, f"({title})")

    # 无 JS 错误
    real = [e for e in errors if '401' not in e and 'length' not in e and '404' not in e]
    ok("无 JS 错误", len(real) == 0, f"({real[:2]})")

    browser.close()

try: os.remove(img_path)
except Exception: pass

print(f"\n========== 结果: PASS=*** FAIL={FAIL} ==========")
sys.exit(0 if FAIL == 0 else 1)
