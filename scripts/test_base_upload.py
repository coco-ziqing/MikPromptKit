# -*- coding: utf-8 -*-
"""v5.50.5 验证：基底素材四方式上传"""
import sys, io as _io
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

# 造一张测试图
from PIL import Image
import tempfile, os
img_path = os.path.join(tempfile.gettempdir(), "base_test.png")
Image.new("RGB", (200, 200), (80, 140, 220)).save(img_path)

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

    # 进入操作台
    page.click("#navDropdownComposer .nav-dropdown-btn")
    page.wait_for_timeout(300)
    page.click("text=角色设定集")
    page.wait_for_timeout(1500)
    page.click("#suitBtnWorkbench")
    page.wait_for_timeout(1000)

    # 1. 素材 tab 四种方式 tab 存在
    page.evaluate("""() => {
        const tabs = document.querySelectorAll('.suit-wb-res-tab');
        for (const t of tabs) { if (t.textContent.includes('素材')) t.click(); }
    }""")
    page.wait_for_timeout(500)
    base_tabs = page.evaluate("() => Array.from(document.querySelectorAll('.suit-base-tab')).map(e => e.textContent.trim())")
    ok("四种上传方式 tab", len(base_tabs) == 4, f"({base_tabs})")

    # 2. 上传 tab：dropzone + 文件选择
    has_dz = page.evaluate("() => !!document.getElementById('baseDropzone') && !!document.getElementById('baseFileInput')")
    ok("上传面板渲染", has_dz)

    # 3. 本地文件上传真实链路（set_input_files）
    page.set_input_files("#baseFileInput", img_path)
    page.wait_for_timeout(2000)
    uploaded = page.evaluate("() => { const dz = document.getElementById('baseDropzone'); return dz ? dz.textContent.includes('已上传') : false; }")
    ok("文件上传成功", uploaded, f"({page.evaluate('() => (document.getElementById(\'baseDropzone\') || {}).textContent || \'\'')[:60]})")

    # 4. 填描述 → 设为基底 → 基底卡槽填充
    page.fill("#wbBaseDesc2", "测试真人参考-青年男性")
    page.click("#wbBaseUploadBtn")
    page.wait_for_timeout(600)
    slot_filled = page.evaluate("() => (document.querySelector('#slotBaseBody') || {}).textContent || ''")
    ok("基底已设置", '测试真人参考' in slot_filled or '已上传' in slot_filled, f"({slot_filled[:50]})")

    # 5. 粘贴 tab 存在
    page.evaluate("""() => {
        const tabs = document.querySelectorAll('.suit-base-tab');
        for (const t of tabs) { if (t.textContent.includes('粘贴')) t.click(); }
    }""")
    page.wait_for_timeout(400)
    has_paste = page.evaluate("() => !!document.getElementById('basePasteZone') && !!document.getElementById('wbBasePasteBtn')")
    ok("粘贴面板渲染", has_paste)

    # 6. 媒体库 tab
    page.evaluate("""() => {
        const tabs = document.querySelectorAll('.suit-base-tab');
        for (const t of tabs) { if (t.textContent.includes('媒体库')) t.click(); }
    }""")
    page.wait_for_timeout(1500)
    lib_count = page.evaluate("() => document.querySelectorAll('.suit-lib-item').length")
    ok("媒体库加载图片", lib_count > 0, f"({lib_count} 张)")

    # 7. URL tab
    page.evaluate("""() => {
        const tabs = document.querySelectorAll('.suit-base-tab');
        for (const t of tabs) { if (t.textContent.includes('URL')) t.click(); }
    }""")
    page.wait_for_timeout(400)
    has_url = page.evaluate("() => !!document.getElementById('wbBaseUrl') && !!document.getElementById('wbBaseUrlBtn')")
    ok("URL 面板渲染", has_url)

    # 8. JS 错误检查
    real = [e for e in errors if '401' not in e and 'length' not in e]
    ok("无 JS 错误", len(real) == 0, f"({real[:2]})")

    browser.close()

# 清理测试图
try: os.remove(img_path)
except Exception: pass

print(f"\n========== 结果: PASS=*** FAIL={FAIL} ==========")
sys.exit(0 if FAIL == 0 else 1)
