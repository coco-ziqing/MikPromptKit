# -*- coding: utf-8 -*-
"""v5.50.30 回归：基底预览面板全场景（上传/切tab/确认/取消重传/比例/自由裁切）"""
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

img_path = os.path.join(tempfile.gettempdir(), "v55030_scene.png")
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

    def switch_res(tab):
        page.evaluate("""(t) => {
            const tabs = document.querySelectorAll('.suit-wb-res-tab');
            for (const x of tabs) { if (x.textContent.includes(t)) x.click(); }
        }""", tab)
        page.wait_for_timeout(600)

    def panel():
        return page.evaluate("""() => ({
            prev: !!document.getElementById('basePrevImg'),
            free: !!document.getElementById('wbBaseFreeCrop'),
            ratios: document.querySelectorAll('.suit-ratio-btn').length,
            confirm: !!document.getElementById('wbBaseConfirm'),
            cancel: !!document.getElementById('wbBaseCancel')
        })""")

    # 场景 1：上传 → 面板完整
    switch_res("素材")
    page.set_input_files("#baseFileInput", img_path)
    page.wait_for_timeout(4000)
    s1 = panel()
    ok("上传后完整面板", s1['prev'] and s1['free'] and s1['ratios'] == 6 and s1['confirm'], f"({s1})")

    # 场景 2：切词卡再切回 → 恢复
    switch_res("词卡")
    switch_res("素材")
    s2 = panel()
    ok("切tab回恢复", s2['free'] and s2['ratios'] == 6 and s2['confirm'], f"({s2})")

    # 场景 3：确认参考 → 面板保留
    page.click("#wbBaseConfirm")
    page.wait_for_timeout(800)
    s3 = panel()
    ok("确认后面板保留", s3['free'] and s3['ratios'] == 6, f"({s3})")
    filled = page.evaluate("() => (document.getElementById('slotBaseBody')||{}).textContent ? document.getElementById('slotBaseBody').textContent.includes('🖼') : false")
    ok("基底槽填充", filled)

    # 场景 4：取消 → 重置上传 → 重传 → 面板出现
    page.click("#wbBaseCancel")
    page.wait_for_timeout(600)
    s4 = panel()
    ok("取消后回上传UI", not s4['prev'] and not s4['free'], f"({s4})")
    page.set_input_files("#baseFileInput", img_path)
    page.wait_for_timeout(4000)
    s5 = panel()
    ok("重传后面板出现", s5['free'] and s5['ratios'] == 6, f"({s5})")

    # 场景 5：比例选择 → 面板保持
    page.click(".suit-ratio-btn[data-ratio='1:1']")
    page.wait_for_timeout(1200)
    s6 = panel()
    ok("选比例后面板保持", s6['free'] and s6['ratios'] == 6, f"({s6})")
    active = page.evaluate("() => { var b = document.querySelector('.suit-ratio-btn[data-active]'); return b ? b.getAttribute('data-ratio') : 'none'; }")
    ok("比例高亮 1:1", active == "1:1", f"({active})")

    # 场景 6：自由裁切弹窗
    page.click("#wbBaseFreeCrop")
    page.wait_for_timeout(800)
    modal = page.evaluate("() => !!document.getElementById('freeCropMask') || !!document.querySelector('.suit-freecrop-wrap')")
    ok("自由裁切弹窗打开", modal)
    page.evaluate("() => { var m = document.getElementById('freeCropMask'); if (m) m.click(); }")
    page.wait_for_timeout(300)

    # 无 JS 错误
    real = [e for e in errors if '401' not in e and '404' not in e]
    ok("无 JS 错误", len(real) == 0, f"({real[:2]})")

    browser.close()
try: os.remove(img_path)
except Exception: pass

print(f"\n========== 结果: PASS=*** FAIL={FAIL} ==========")
sys.exit(0 if FAIL == 0 else 1)
