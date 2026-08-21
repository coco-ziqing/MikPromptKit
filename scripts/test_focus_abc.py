# -*- coding: utf-8 -*-
"""聚焦验证：A词卡共存 + C最终提示词 + B编辑按钮"""
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

    # 手动词条
    page.fill("#runeTextInput", "精致刺绣服饰")
    page.keyboard.press("Enter")
    page.wait_for_timeout(400)

    # 切词卡面板（点击词条层）
    page.click("#slotRunes")
    page.wait_for_timeout(1500)
    cards = page.evaluate("() => document.querySelectorAll('.suit-res-card').length")
    ok("词卡列表加载", cards > 0, f"({cards} 张)")
    page.evaluate("""() => {
        const btn = document.querySelector('.suit-res-card .suit-res-add');
        if (btn) btn.click();
    }""")
    page.wait_for_timeout(500)
    chips = page.evaluate("() => document.querySelectorAll('#slotRunesBody .suit-rune-chip').length")
    texts = page.evaluate("() => document.querySelectorAll('#slotRunesBody .suit-rune-text').length")
    ok("词卡+文本共存", chips >= 2 and texts >= 1, f"(chips={chips}, text={texts})")

    # 最终提示词栏
    fp = page.evaluate("() => (document.getElementById('finalPromptBody') || {}).textContent || ''")
    ok("最终提示词含文本词条", '刺绣' in fp, f"({fp[:80]})")

    # 载入模板 → 编辑按钮
    page.click("#slotSuit")
    page.wait_for_timeout(1500)
    page.evaluate("""() => {
        const items = document.querySelectorAll('.suit-res-suit');
        for (const it of items) {
            if ((it.textContent || '').includes('影视写实')) { it.querySelector('.suit-res-add').click(); break; }
        }
    }""")
    page.wait_for_timeout(800)
    has_edit = page.evaluate("() => !!document.querySelector('[data-act=\"editsuit\"]')")
    ok("模板编辑按钮", has_edit)
    # 模板载入后最终提示词含风格词条（轮询等待异步加载）
    fp2 = ''
    for _ in range(10):
        fp2 = page.evaluate("() => (document.getElementById('finalPromptBody') || {}).textContent || ''")
        if '电影级' in fp2 or '摄影' in fp2:
            break
        page.wait_for_timeout(500)
    ok("载入模板后提示词含风格词", '电影级' in fp2 or '摄影' in fp2, f"({fp2[:80]})")

    real = [e for e in errors if '401' not in e and 'length' not in e and '404' not in e]
    ok("无 JS 错误", len(real) == 0, f"({real[:2]})")
    browser.close()

print(f"\n========== 结果: PASS=*** FAIL={FAIL} ==========")
sys.exit(0 if FAIL == 0 else 1)
