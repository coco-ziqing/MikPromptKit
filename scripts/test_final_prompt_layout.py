# -*- coding: utf-8 -*-
"""v5.50.29 验证：最终提示词在中间栏内、不超出左右边栏、切换层常驻"""
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

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, executable_path=r"C:\Program Files\Google\Chrome\Application\chrome.exe")
    page = browser.new_page(viewport={"width": 1600, "height": 1000})
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
    page.wait_for_timeout(1200)

    # 1. final prompt 存在于中间栏内
    info = page.evaluate("""() => {
        var fp = document.querySelector('.suit-final-prompt');
        var mid = document.querySelector('.suit-wb-mid');
        var left = document.querySelector('.suit-wb-left');
        var right = document.querySelector('.suit-wb-right');
        if (!fp || !mid || !left || !right) return {err: '缺元素'};
        var fr = fp.getBoundingClientRect(), mr = mid.getBoundingClientRect(),
            lr = left.getBoundingClientRect(), rr = right.getBoundingClientRect();
        return {
            inMid: mid.contains(fp),
            fpLeft: fr.left, fpRight: fr.right,
            midLeft: mr.left, midRight: mr.right,
            leftRight: lr.right, rightLeft: rr.left,
            fpW: fr.width
        };
    }""")
    ok("最终提示词在中间栏内", info.get("inMid"), f"(inMid={info.get('inMid')})")
    # 不超出左右边栏：fp 左边界 >= left 右边界（容差 2px），fp 右边界 <= right 左边界
    ok("不超出左边界", info.get("fpLeft", 0) >= info.get("leftRight", 9999) - 3, f"(fpL={info.get('fpLeft'):.0f} leftR={info.get('leftRight'):.0f})")
    ok("不超出右边界", info.get("fpRight", 0) <= info.get("rightLeft", 0) + 3, f"(fpR={info.get('fpRight'):.0f} rightL={info.get('rightLeft'):.0f})")
    ok("宽度=中间栏宽度", abs(info.get("fpW", 0) - (info.get("midRight", 0) - info.get("midLeft", 0))) < 5, f"(fpW={info.get('fpW'):.0f})")

    # 2. 切换层（风格词条层/风格模板层）→ final prompt 常驻
    page.click("#slotRunes")
    page.wait_for_timeout(600)
    still1 = page.evaluate("() => !!document.querySelector('.suit-final-prompt') && !!document.getElementById('finalPromptBody')")
    ok("切词条层后常驻", still1)
    page.click("#slotSuit")
    page.wait_for_timeout(600)
    still2 = page.evaluate("() => !!document.querySelector('.suit-final-prompt')")
    ok("切模板层后常驻", still2)
    page.click("#slotBase")
    page.wait_for_timeout(600)
    still3 = page.evaluate("() => !!document.querySelector('.suit-final-prompt')")
    ok("切基底层后常驻", still3)

    # 3. 无 JS 错误
    real = [e for e in errors if '401' not in e and '404' not in e]
    ok("无 JS 错误", len(real) == 0, f"({real[:2]})")

    browser.close()

print(f"\n========== 结果: PASS=*** FAIL={FAIL} ==========")
sys.exit(0 if FAIL == 0 else 1)
