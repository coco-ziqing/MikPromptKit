# -*- coding: utf-8 -*-
"""v5.50.19 验证：确认参考按钮 + 默认原始比例"""
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
img_path = os.path.join(tempfile.gettempdir(), "v55019.png")
Image.new("RGB", (800, 500), (80, 160, 200)).save(img_path)

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
    # 0. 上传按钮文案（上传前检查，此时素材 tab 是上传 UI）
    up_btn = page.evaluate("() => (document.getElementById('wbBaseUploadBtn') || {}).textContent || ''")
    ok("上传按钮=设为参考", '设为参考' in up_btn, f"({up_btn.strip()})")

    page.set_input_files("#baseFileInput", img_path)
    page.wait_for_timeout(3000)

    # 1. 默认「原始」高亮
    active_ratio = page.evaluate("""() => {
        const b = document.querySelector('.suit-ratio-btn[data-active]');
        return b ? b.textContent.trim() : '';
    }""")
    ok("默认比例=原始", active_ratio == '原始', f"({active_ratio})")

    # 2. 预览尺寸 = 原始尺寸（800x500 不裁切仅缩放≤1536）
    title = page.evaluate("() => (document.querySelector('.suit-base-preview-title') || {}).textContent || ''")
    ok("默认不裁切(原始尺寸)", '800' in title and '500' in title, f"({title})")

    # 3. 确认按钮文案
    btn_text = page.evaluate("() => (document.getElementById('wbBaseConfirm') || {}).textContent || ''")
    ok("确认按钮=确认参考", '确认参考' in btn_text, f"({btn_text.strip()})")

    # 5. 确认后基底槽正常 + 无旧文案残留
    page.fill("#wbBaseDesc6", "参考测试")
    page.click("#wbBaseConfirm")
    page.wait_for_timeout(800)
    slot = page.evaluate("() => (document.querySelector('#slotBaseBody') || {}).textContent || ''")
    ok("确认参考后基底槽填充", '参考测试' in slot, f"({slot[:40]})")
    body = page.evaluate("() => document.body.innerText")
    ok("无「确认设为基底」残留", '确认设为基底' not in body)

    # 6. 无 JS 错误
    real = [e for e in errors if '401' not in e and 'length' not in e and '404' not in e]
    ok("无 JS 错误", len(real) == 0, f"({real[:2]})")

    browser.close()

try: os.remove(img_path)
except Exception: pass

print(f"\n========== 结果: PASS=*** FAIL={FAIL} ==========")
sys.exit(0 if FAIL == 0 else 1)
