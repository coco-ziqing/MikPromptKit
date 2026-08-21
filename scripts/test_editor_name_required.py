# -*- coding: utf-8 -*-
"""v5.50.32 验证：模板名称必填时自动定位到⑤基础信息 tab"""
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
    page.on("dialog", lambda d: (dialogs.append(d.message[:80]), d.accept()))  # _showToast 回退 alert，需自动接受
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

    # 打开套装编辑器（新建）——通过 STYLE_SUIT 对象（window 暴露）
    hasEditor = page.evaluate("() => typeof (window.STYLE_SUIT || {}).openEditor === 'function'")
    ok("编辑器入口存在", hasEditor)
    if not hasEditor:
        print("无 STYLE_SUIT.openEditor，尝试其他入口")
    # 找「＋新建」按钮或直接调 openEditor
    page.evaluate("() => { if (window.STYLE_SUIT && STYLE_SUIT.openEditor) STYLE_SUIT.openEditor(null); }")
    page.wait_for_timeout(800)
    mask = page.evaluate("() => !!document.getElementById('suitEditorMask')")
    ok("编辑器弹窗打开", mask)

    # 默认在①风格词条 tab，名称框不存在
    tab0 = page.evaluate("() => (document.querySelector('.suit-editor-tab.active')||{}).getAttribute('data-tab')")
    ok("默认 tab=words", tab0 == 'words')
    hasName0 = page.evaluate("() => !!document.getElementById('edName')")
    ok("words tab 无名称框", not hasName0)

    # 直接点保存（edBtnSave）→ 应自动切到 base + 聚焦
    page.click("#edBtnSave")
    page.wait_for_timeout(800)
    state = page.evaluate("""() => ({
        activeTab: (document.querySelector('.suit-editor-tab.active')||{}).getAttribute('data-tab'),
        hasName: !!document.getElementById('edName'),
        nameWarn: (document.getElementById('edName')||{}).classList ? document.getElementById('edName').classList.contains('suit-input-warn') : false,
        focused: document.activeElement ? document.activeElement.id : ''
    })""")
    ok("自动切到 base tab", state['activeTab'] == 'base', f"({state['activeTab']})")
    ok("名称框出现", state['hasName'])
    ok("名称框高亮", state['nameWarn'])
    ok("名称框聚焦", state['focused'] == 'edName', f"({state['focused']})")

    # 填名称后保存成功（会创建测试模板，稍后清理）
    page.fill("#edName", "v5.50.32验证模板")
    page.click("#edBtnSave")
    page.wait_for_timeout(1200)
    closed = page.evaluate("() => !document.getElementById('suitEditorMask')")
    ok("填名后保存成功并关闭", closed)
    ok("创建成功提示", any("创建成功" in m for m in dialogs), f"({dialogs})")

    # 清理：删除刚建的测试模板
    page.evaluate("""async () => {
        const r = await fetch('/api/style-packs?tab=all');
        const d = await r.json();
        const items = d.items || [];
        const it = items.find(function(x) { return x.name === 'v5.50.32验证模板'; });
        if (it) await fetch('/api/style-packs/' + it.id, { method: 'DELETE' });
    }""")
    page.wait_for_timeout(800)

    # 无 JS 错误
    real = [e for e in errors if '401' not in e and '404' not in e]
    ok("无 JS 错误", len(real) == 0, f"({real[:2]})")

    browser.close()

print(f"\n========== 结果: PASS=*** FAIL={FAIL} ==========")
sys.exit(0 if FAIL == 0 else 1)
