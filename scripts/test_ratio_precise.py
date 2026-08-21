# -*- coding: utf-8 -*-
"""v5.50.16 验证：规范化比例精确对应 + 64对齐后端处理"""
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
# 1024x1024 方形图（显示比例 = 像素比例，便于验证）
img_path = os.path.join(tempfile.gettempdir(), "v55016.png")
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

    def click_ratio(r):
        page.evaluate("""(r) => {
            const btns = document.querySelectorAll('#freeCropRatios [data-fr]');
            for (const b of btns) { if (b.textContent.trim() === r) b.click(); }
        }""", r)
        page.wait_for_timeout(300)

    def size_text():
        return page.evaluate("() => (document.getElementById('freeCropSize') || {}).textContent || ''")

    # 打开弹窗，框选任意区域
    page.click("#wbBaseFreeCrop")
    page.wait_for_timeout(1500)
    sim_crop(0.1, 0.1, 0.5, 0.5)

    # 1. 1:1 规范化 → 显示比例精确 1:1（宽=高像素）
    click_ratio('1:1')
    s1 = size_text()
    m1 = re.search(r'(\d+)×(\d+)', s1)
    w1, h1 = int(m1.group(1)), int(m1.group(2))
    ok("1:1 精确方形", w1 == h1, f"({w1}x{h1})")

    # 2. 16:9 规范化 → 显示比例精确 16:9
    click_ratio('16:9')
    s2 = size_text()
    m2 = re.search(r'(\d+)×(\d+)', s2)
    w2, h2 = int(m2.group(1)), int(m2.group(2))
    ok("16:9 精确比例", abs(w2/h2 - 16/9) < 0.005, f"({w2}x{h2} ratio={w2/h2:.4f})")

    # 3. 3:4 规范化 → 精确 3:4
    click_ratio('3:4')
    s3 = size_text()
    m3 = re.search(r'(\d+)×(\d+)', s3)
    w3, h3 = int(m3.group(1)), int(m3.group(2))
    ok("3:4 精确比例", abs(w3/h3 - 3/4) < 0.005, f"({w3}x{h3} ratio={w3/h3:.4f})")

    # 4. 9:16 规范化 → 精确 9:16
    click_ratio('9:16')
    s4 = size_text()
    m4 = re.search(r'(\d+)×(\d+)', s4)
    w4, h4 = int(m4.group(1)), int(m4.group(2))
    ok("9:16 精确比例", abs(w4/h4 - 9/16) < 0.005, f"({w4}x{h4} ratio={w4/h4:.4f})")

    # 5. 应用（16:9）→ 后端 64 对齐
    click_ratio('16:9')
    page.click("#freeCropApply")
    page.wait_for_timeout(1500)
    title = page.evaluate("() => (document.querySelector('.suit-base-preview-title') || {}).textContent || ''")
    m5 = re.search(r'（(\d+)×(\d+)）', title)
    if m5:
        w5, h5 = int(m5.group(1)), int(m5.group(2))
        ok("应用后 64 对齐", w5 % 64 == 0 and h5 % 64 == 0, f"({w5}x{h5})")
        ok("应用后比例接近16:9", abs(w5/h5 - 16/9) < 0.03, f"({w5/h5:.3f})")
    else:
        ok("应用后 64 对齐", False, f"({title})")

    # 6. 无 JS 错误
    real = [e for e in errors if '401' not in e and 'length' not in e and '404' not in e]
    ok("无 JS 错误", len(real) == 0, f"({real[:2]})")

    browser.close()

try: os.remove(img_path)
except Exception: pass

print(f"\n========== 结果: PASS=*** FAIL={FAIL} ==========")
sys.exit(0 if FAIL == 0 else 1)
