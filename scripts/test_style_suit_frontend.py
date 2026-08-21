# -*- coding: utf-8 -*-
"""v5.48.0 前端浏览器验证：导航入口 → 背包页 → 新建套装编辑器 → 保存"""
import sys, time
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
    page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)

    # 1. 加载首页
    page.goto(BASE, wait_until="domcontentloaded", timeout=30000)
    page.wait_for_timeout(2500)
    ok("首页加载", page.title() != "")

    # 2. 登录：API 获取 token → 注入 localStorage（pk_token_v1 混淆格式）→ 刷新
    try:
        token = page.evaluate("""async () => {
            const r = await fetch('/api/auth/login', {method:'POST', headers:{'Content-Type':'application/json'},
                body: JSON.stringify({username:'admin', password:'admin'})});
            const d = await r.json();
            return d.token;
        }""")
        ok("登录获取 token", bool(token))
        if token:
            page.evaluate("""(t) => {
                let obf = '';
                for (let i=0; i<t.length; i++) obf += String.fromCharCode(t.charCodeAt(i) ^ 0x5A);
                localStorage.setItem('pk_token_v1', btoa(obf));
                localStorage.setItem('pk_user', JSON.stringify({username:'admin', role:'admin'}));
            }""", token)
            page.reload(wait_until="domcontentloaded")
            page.wait_for_timeout(2500)
            ok("注入 token 后页面重载", True)
    except Exception as e:
        ok("登录准备", False, str(e)[:100])

    # 3. 检查 STYLE_SUIT 模块加载
    has_module = page.evaluate("() => !!(window.STYLE_SUIT && window.STYLE_SUIT.openBag)")
    ok("STYLE_SUIT 模块加载", has_module)

    # 4. 点击导航「组装」下拉 → 「风格套装」
    try:
        page.click("#navDropdownComposer .nav-dropdown-btn")
        page.wait_for_timeout(300)
        page.click("text=风格套装")
        page.wait_for_timeout(1500)
        ok("导航入口可点击", True)
    except Exception as e:
        ok("导航入口可点击", False, str(e)[:100])

    # 5. 背包页渲染
    has_bag = page.evaluate("() => !!document.getElementById('viewStyleSuit') && !!document.querySelector('.suit-bag')")
    ok("背包页渲染", has_bag)
    tab_count = page.evaluate("() => document.querySelectorAll('.suit-tab-btn').length")
    ok("Tab 分类 5 个", tab_count == 5, f"(实际 {tab_count})")
    has_new_btn = page.evaluate("() => !!document.getElementById('suitBtnNew')")
    ok("新建套装按钮存在", has_new_btn)

    # 6. 点击新建套装 → 编辑器弹窗
    try:
        page.click("#suitBtnNew")
        page.wait_for_timeout(800)
        has_editor = page.evaluate("() => !!document.getElementById('suitEditorMask')")
        ok("编辑器弹窗打开", has_editor)
        tab_editor = page.evaluate("() => document.querySelectorAll('.suit-editor-tab').length")
        ok("编辑器 5 Tab", tab_editor == 5, f"(实际 {tab_editor})")
    except Exception as e:
        ok("编辑器弹窗打开", False, str(e)[:100])

    # 7. 切到 Tab5 基础信息 → 填写名称 → 保存
    try:
        # 点击第 5 个 tab（基础信息）
        page.evaluate("""() => {
            const tabs = document.querySelectorAll('.suit-editor-tab');
            if (tabs.length >= 5) tabs[4].click();
        }""")
        page.wait_for_timeout(400)
        page.evaluate("""() => {
            const el = document.getElementById('edName');
            if (el) { el.value = '浏览器验证套装'; el.dispatchEvent(new Event('input')); }
        }""")
        page.wait_for_timeout(300)
        page.click("#edBtnSave")
        page.wait_for_timeout(2000)
        saved = page.evaluate("() => !document.getElementById('suitEditorMask')")
        ok("编辑器保存关闭", saved)
    except Exception as e:
        ok("编辑器保存关闭", False, str(e)[:100])

    # 8. 检查套装列表出现新建项（可能需要刷新加载）
    page.wait_for_timeout(800)
    card_count = page.evaluate("() => document.querySelectorAll('.suit-card').length")
    ok("背包列表渲染卡片", card_count > 0, f"(卡片 {card_count})")
    found = page.evaluate("""() => {
        const cards = document.querySelectorAll('.suit-card');
        for (const c of cards) {
            if (c.getAttribute('data-name') && c.getAttribute('data-name').includes('浏览器验证')) return true;
        }
        return false;
    }""")
    ok("新建套装出现在列表", found)

    # 9. 打开操作台
    try:
        page.click("#suitBtnWorkbench")
        page.wait_for_timeout(1000)
        has_wb = page.evaluate("() => !!document.getElementById('viewAssembleWorkbench') && !!document.querySelector('.suit-workbench')")
        ok("操作台打开", has_wb)
        slot_count = page.evaluate("() => document.querySelectorAll('.suit-slot').length")
        ok("四层卡槽渲染", slot_count == 4, f"(实际 {slot_count})")
    except Exception as e:
        ok("操作台打开", False, str(e)[:100])

    # JS 错误检查（过滤已知噪音）
    real_errors = [e for e in errors if 'favicon' not in e and 'WebSocket' not in e]
    ok("无 JS 错误", len(real_errors) == 0, f"(错误 {len(real_errors)}): " + "; ".join(real_errors[:3]))

    browser.close()

print(f"\n========== 结果: PASS={PASS} FAIL={FAIL} ==========")
sys.exit(0 if FAIL == 0 else 1)
