# -*- coding: utf-8 -*-
"""v5.50.33 验证：点确认参考后无任何弹窗，直接完成"""
import sys, os, tempfile
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
from playwright.sync_api import sync_playwright
from PIL import Image

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

img_path = os.path.join(tempfile.gettempdir(), "v55033.png")
Image.new("RGB", (800, 500), (100, 140, 200)).save(img_path)

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, executable_path=r"C:\Program Files\Google\Chrome\Application\chrome.exe")
    page = browser.new_page(viewport={"width": 1440, "height": 900})
    errors = []
    dialogs = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.on("dialog", lambda d: (dialogs.append(d.message[:60]), d.accept()))
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
    page.wait_for_timeout(4000)
    page.click("#wbBaseConfirm")
    page.wait_for_timeout(1000)

    state = page.evaluate("""() => ({
        slotFilled: (document.getElementById('slotBaseBody')||{}).textContent ? document.getElementById('slotBaseBody').textContent.includes('🖼') : false,
        previewKept: !!document.getElementById('basePrevImg'),
        modalCount: document.querySelectorAll('.suit-modal-mask, .pk-modal-overlay').length,
        visibleModals: Array.from(document.querySelectorAll('.suit-modal-mask, .pk-modal-overlay')).filter(function(m){return m.offsetParent !== null;}).length
    })""")
    ok("基底槽填充", state['slotFilled'])
    ok("预览面板保留", state['previewKept'])
    ok("无弹窗残留", state['visibleModals'] == 0, f"(visible={state['visibleModals']})")
    ok("无 dialog 弹窗", len(dialogs) == 0, f"({dialogs})")
    real = [e for e in errors if '401' not in e and '404' not in e]
    ok("无 JS 错误", len(real) == 0, f"({real[:2]})")

    browser.close()
try: os.remove(img_path)
except Exception: pass

print(f"\n========== 结果: PASS=*** FAIL={FAIL} ==========")
sys.exit(0 if FAIL == 0 else 1)
