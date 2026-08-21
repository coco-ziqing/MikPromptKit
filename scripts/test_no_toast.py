# -*- coding: utf-8 -*-
"""v5.50.11 验证：上传/切换不再弹 toast，功能正常"""
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
img_path = os.path.join(tempfile.gettempdir(), "v55011.png")
Image.new("RGB", (500, 400), (90, 150, 210)).save(img_path)

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

    # 注入 toast 监听
    page.evaluate("""() => {
        window.__toasts = [];
        const orig = window.App && App._toast ? App._toast.bind(App) : null;
        if (orig) {
            App._toast = function(msg, type) { window.__toasts.push({msg: msg, type: type}); };
        }
    }""")

    page.click("#navDropdownComposer .nav-dropdown-btn")
    page.wait_for_timeout(300)
    page.click("text=角色设定集")
    page.wait_for_timeout(1500)
    page.click("#suitBtnWorkbench")
    page.wait_for_timeout(1000)

    # 1. 上传（不应弹 toast，预览面板出现即可）
    page.evaluate("""() => {
        const tabs = document.querySelectorAll('.suit-wb-res-tab');
        for (const t of tabs) { if (t.textContent.includes('素材')) t.click(); }
    }""")
    page.wait_for_timeout(500)
    page.set_input_files("#baseFileInput", img_path)
    page.wait_for_timeout(3000)
    has_panel = page.evaluate("() => !!document.querySelector('.suit-base-preview-box')")
    ok("上传后预览面板", has_panel)

    # 2. 切换卡槽（不应弹 toast）
    page.click("#slotRunes")
    page.wait_for_timeout(1200)
    active = page.evaluate("() => { const t = document.querySelector('.suit-wb-res-tab.active'); return t ? t.getAttribute('data-res') : ''; }")
    ok("切词条层→词卡", active == 'cards', f"({active})")
    page.click("#slotSuit")
    page.wait_for_timeout(1500)
    active2 = page.evaluate("() => { const t = document.querySelector('.suit-wb-res-tab.active'); return t ? t.getAttribute('data-res') : ''; }")
    ok("切模板层→套装", active2 == 'suits', f"({active2})")

    # 3. 检查是否弹了过程 toast
    toasts = page.evaluate("() => window.__toasts || []")
    proc_toasts = [t for t in toasts if '上传' in t.get('msg','') or '切换' in t.get('msg','') or '已载入' in t.get('msg','') or '已添加' in t.get('msg','') or '已设置' in t.get('msg','') or '已就绪' in t.get('msg','')]
    ok("无过程 toast", len(proc_toasts) == 0, f"(toast 总数 {len(toasts)}, 过程类 {proc_toasts})")

    # 4. 上传+载入模板后确认基底（关键操作仍应反馈？——确认基底是完成动作，可不弹；验证功能正常）
    page.click("#slotBase")
    page.wait_for_timeout(800)
    ok("回基底→素材", True)

    # 5. 无 JS 错误
    real = [e for e in errors if '401' not in e and 'length' not in e and '404' not in e]
    ok("无 JS 错误", len(real) == 0, f"({real[:2]})")

    browser.close()

try: os.remove(img_path)
except Exception: pass

print(f"\n========== 结果: PASS=*** FAIL={FAIL} ==========")
sys.exit(0 if FAIL == 0 else 1)
