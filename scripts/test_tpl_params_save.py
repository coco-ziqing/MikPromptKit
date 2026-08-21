# -*- coding: utf-8 -*-
"""v5.50.34 验证：风格模板改参数保存（非激活 tab 原值兜底）"""
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

    # 取第一个模板原配置（含 words）
    tpl = page.evaluate("""async () => {
        const r = await fetch('/api/style-packs?tab=all');
        const d = await r.json();
        const it = (d.items || []).find(function(x) { return !x.is_deleted; });
        return it ? {id: it.id, name: it.name, words: (it.config||{}).style_words || {}, rp: (it.config||{}).render_params || {}} : null;
    }""")
    ok("找到模板", tpl is not None)
    if not tpl:
        sys.exit(1)

    page.evaluate("(id) => { if (window.STYLE_SUIT && STYLE_SUIT.openEditor) STYLE_SUIT.openEditor(id); }", tpl["id"])
    page.wait_for_timeout(1000)
    # 切到②生成参数 tab（模拟用户停留在此）
    page.click('.suit-editor-tab[data-tab="render"]')
    page.wait_for_timeout(400)
    # 改参数
    page.select_option("#edRpRatio", "16:9")
    page.select_option("#edRpRes", "4k")
    page.fill("#edRpModel", "5.0Pro")
    page.click("#edBtnSave")
    page.wait_for_timeout(1500)

    closed = page.evaluate("() => !document.getElementById('suitEditorMask')")
    ok("保存成功并关闭（无名称必填拦截）", closed, f"({dialogs})")
    ok("保存提示快照", any("已保存" in m for m in dialogs))

    # 重新打开验证参数保留 + words 未被清空
    page.evaluate("(id) => { if (window.STYLE_SUIT && STYLE_SUIT.openEditor) STYLE_SUIT.openEditor(id); }", tpl["id"])
    page.wait_for_timeout(1000)
    page.click('.suit-editor-tab[data-tab="render"]')
    page.wait_for_timeout(400)
    reloaded = page.evaluate("""() => ({
        model: document.getElementById('edRpModel').value,
        ratio: document.getElementById('edRpRatio').value,
        res: document.getElementById('edRpRes').value
    })""")
    ok("参数已保存（5.0Pro/16:9/4k）", reloaded["model"] == "5.0Pro" and reloaded["ratio"] == "16:9" and reloaded["res"] == "4k", f"({reloaded})")
    # 切到①验证 words 保留
    page.click('.suit-editor-tab[data-tab="words"]')
    page.wait_for_timeout(400)
    words = page.evaluate("() => document.getElementById('edWordsPos') ? document.getElementById('edWordsPos').value : ''")
    ok("words 未被清空", words == (tpl["words"].get("positive") or ""), f"(len={len(words)})")

    # 恢复原参数（不污染模板）
    page.click('.suit-editor-tab[data-tab="render"]')
    page.wait_for_timeout(400)
    page.select_option("#edRpRatio", tpl["rp"]["ratio"] or "1:1")
    page.select_option("#edRpRes", tpl["rp"]["resolution_type"] or "2k")
    page.fill("#edRpModel", tpl["rp"]["model_version"] or "5.0")
    page.click("#edBtnSave")
    page.wait_for_timeout(1200)

    real = [e for e in errors if '401' not in e and '404' not in e]
    ok("无 JS 错误", len(real) == 0, f"({real[:2]})")
    browser.close()

print(f"\n========== 结果: PASS=*** FAIL={FAIL} ==========")
sys.exit(0 if FAIL == 0 else 1)
