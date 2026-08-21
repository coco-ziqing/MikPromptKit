# -*- coding: utf-8 -*-
"""v5.50.14 验证：自由裁切固定比例规范化"""
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
img_path = os.path.join(tempfile.gettempdir(), "v55014.png")
Image.new("RGB", (1000, 600), (80, 160, 200)).save(img_path)

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
        page.wait_for_timeout(400)

    # 1. 打开弹窗，框选一个近似方形区域（0.1-0.4, 0.1-0.7 → 300x360 近似）
    page.click("#wbBaseFreeCrop")
    page.wait_for_timeout(1500)
    sim_crop(0.1, 0.1, 0.4, 0.7)
    ratios_visible = page.evaluate("() => document.getElementById('freeCropRatios').style.display === 'flex'")
    ok("框选后比例行显示", ratios_visible)
    size_before = page.evaluate("() => (document.getElementById('freeCropSize') || {}).textContent || ''")
    ok("原始框选尺寸显示", '299' in size_before and '360' in size_before, f"({size_before})")

    # 2. 点 1:1 → 选框规范化为正方形
    page.evaluate("""() => {
        const btns = document.querySelectorAll('#freeCropRatios [data-fr]');
        for (const b of btns) { if (b.textContent.trim() === '1:1') b.click(); }
    }""")
    page.wait_for_timeout(400)
    size_11 = page.evaluate("() => (document.getElementById('freeCropSize') || {}).textContent || ''")
    ok("1:1 规范化(宽=高)", size_11.split('×')[0].split('：')[-1].strip() == size_11.split('×')[1].replace('px','').strip(), f"({size_11})")

    # 3. 点 16:9 → 宽高比 16:9
    page.evaluate("""() => {
        const btns = document.querySelectorAll('#freeCropRatios [data-fr]');
        for (const b of btns) { if (b.textContent.trim() === '16:9') b.click(); }
    }""")
    page.wait_for_timeout(400)
    size_169 = page.evaluate("() => (document.getElementById('freeCropSize') || {}).textContent || ''")
    # 解析 宽×高
    import re
    m = re.search(r'(\d+)×(\d+)', size_169)
    if m:
        w, h = int(m.group(1)), int(m.group(2))
        ok("16:9 规范化", abs(w/h - 16/9) < 0.05, f"({w}x{h} ratio={w/h:.3f})")
    else:
        ok("16:9 规范化", False, f"(解析失败: {size_169})")

    # 4. 应用裁剪 → 预览尺寸 = 16:9
    page.click("#freeCropApply")
    page.wait_for_timeout(1500)
    title = page.evaluate("() => (document.querySelector('.suit-base-preview-title') || {}).textContent || ''")
    m2 = re.search(r'（(\d+)×(\d+)）', title)
    if m2:
        w2, h2 = int(m2.group(1)), int(m2.group(2))
        ok("应用后 16:9 预览", abs(w2/h2 - 16/9) < 0.05, f"({w2}x{h2})")
    else:
        ok("应用后 16:9 预览", False, f"({title})")

    # 5. 无 JS 错误
    real = [e for e in errors if '401' not in e and 'length' not in e and '404' not in e]
    ok("无 JS 错误", len(real) == 0, f"({real[:2]})")

    browser.close()

try: os.remove(img_path)
except Exception: pass

print(f"\n========== 结果: PASS=*** FAIL={FAIL} ==========")
sys.exit(0 if FAIL == 0 else 1)
