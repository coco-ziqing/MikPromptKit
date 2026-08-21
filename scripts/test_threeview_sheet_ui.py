# -*- coding: utf-8 -*-
"""v5.50.26 前端三视图 sheet 模式验证：弹窗渲染/布局切换/风格前缀联动/mock 提交"""
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

    # mock 提交接口：拦截 three-view/generate，验证请求体，返回假成功
    captured = {}
    def route_handler(route):
        if "three-view/generate" in route.request.url:
            captured["body"] = route.request.post_data
            route.fulfill(status=200, content_type="application/json",
                          body='{"ok": true, "tasks": [{"view": "sheet", "task_id": 99999, "status": "queued"}], "engine": "dreamina"}')
        elif "three-view/tasks" in route.request.url:
            # 轮询接口返回 mock 任务，避免真实列表清空任务卡
            route.fulfill(status=200, content_type="application/json",
                          body='{"ok": true, "tasks": [{"id": 99999, "view": "sheet", "status": "queued", "progress": 0}]}')
        else:
            route.continue_()
    page.route("**/api/roles/*/three-view/generate", route_handler)
    page.route("**/api/roles/*/three-view/tasks", route_handler)

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

    # 打开角色库 → 找任意角色 → 打开三视图生成器
    page.click("#navDropdownComposer .nav-dropdown-btn")
    page.wait_for_timeout(300)
    page.click("text=角色设定集")
    page.wait_for_timeout(2000)

    # 直接调 openThreeViewGen（需要真实 rid：先取总项目再取角色）
    rid = page.evaluate("""async () => {
        const r1 = await fetch('/api/master-projects');
        const d1 = await r1.json();
        const mid = (d1.projects && d1.projects[0]) ? d1.projects[0].id : (d1.items && d1.items[0] ? d1.items[0].id : null);
        if (!mid) return null;
        const r2 = await fetch('/api/master/' + mid + '/roles?role_type=character&limit=5');
        const d2 = await r2.json();
        const roles = d2.roles || d2.items || [];
        return roles.length ? roles[0].id : null;
    }""")
    ok("找到角色", rid is not None, f"(rid={rid})")
    if not rid:
        print("无角色数据，跳过")
        sys.exit(1)

    page.evaluate("""(rid) => {
        PK_ROLES.openThreeViewGen(rid);
    }""", rid)
    page.wait_for_timeout(1200)

    # 1. 默认 single：三个 textarea（条件等待首次加载）
    page.wait_for_function("() => document.querySelectorAll('.rl-tv-prompt').length > 0", timeout=8000)
    n = page.evaluate("() => document.querySelectorAll('.rl-tv-prompt').length")
    ok("默认 single 三框", n == 3, f"({n})")

    # 2. 切 sheet：单框 + 四要素（条件等待异步重载）
    page.select_option("#rlTVLayout", "sheet")
    page.wait_for_function("() => document.querySelectorAll('.rl-tv-prompt').length === 1", timeout=8000)
    txt = page.evaluate("() => (document.querySelector('.rl-tv-prompt') || {}).value || ''")
    ok("sheet 单框", True, "(1)")
    ok("sheet 含四格布局", all(x in txt for x in ["正面全身站立像", "90度侧面全身像", "背面全身像", "脸部特写"]))
    ok("sheet 含正交+无阴影+一致", all(x in txt for x in ["标准正交视图", "无阴影", "完全一致", "纯白背景"]))

    # 3. 风格前缀联动（条件等待前缀注入）
    page.fill("#rlTVStylePrefix", "3D写实国漫风格，UE5渲染，细节超高清")
    page.dispatch_event("#rlTVStylePrefix", "change")
    page.wait_for_function("() => ((document.querySelector('.rl-tv-prompt')||{}).value||'').startsWith('3D写实国漫风格，UE5渲染，细节超高清')", timeout=8000)
    ok("风格前缀注入预览", True, "(3D写实国漫风格...)")

    # 4. 提交前：切回 single 恢复三框（未提交，重载正常）→ 再切回 sheet
    page.select_option("#rlTVLayout", "single")
    page.wait_for_function("() => document.querySelectorAll('.rl-tv-prompt').length === 3", timeout=8000)
    n3 = page.evaluate("() => document.querySelectorAll('.rl-tv-prompt').length")
    ok("切回 single 三框", n3 == 3, f"({n3})")
    page.select_option("#rlTVLayout", "sheet")
    page.wait_for_function("() => document.querySelectorAll('.rl-tv-prompt').length === 1", timeout=8000)

    # 5. 提交：mock 拦截验证请求体带 layout/style_prefix（JSON.stringify 无空格）
    page.click("#rlTVGo")
    page.wait_for_timeout(1200)
    body = captured.get("body") or ""
    ok("请求体含 layout=sheet", '"layout":"sheet"' in body, f"({body[:90]}...)")
    ok("请求体含 style_prefix", "style_prefix" in body and "UE5" in body)

    # 6. sheet 任务卡视图名（条件等待渲染）
    try:
        page.wait_for_function("() => (document.getElementById('rlTVTaskList')||{}).textContent ? document.getElementById('rlTVTaskList').textContent.includes('设定表') : false", timeout=6000)
        card = page.evaluate("() => document.getElementById('rlTVTaskList') ? document.getElementById('rlTVTaskList').textContent : ''")
        ok("任务卡显示设定表", True, f"({card[:40]})")
    except Exception:
        diag = page.evaluate("""() => {
            var box = document.getElementById('rlTVPrompts');
            var list = document.getElementById('rlTVTaskList');
            return {
                boxHtml: box ? box.innerHTML.slice(0, 200) : 'none',
                listHtml: list ? list.innerHTML.slice(0, 200) : 'none',
                goText: (document.getElementById('rlTVGo')||{}).textContent || 'none'
            };
        }""")
        print("  [DIAG] box:", diag['boxHtml'])
        print("  [DIAG] list:", diag['listHtml'])
        print("  [DIAG] go:", diag['goText'])
        ok("任务卡显示设定表", False, "(超时)")

    # 7. 无 JS 错误
    real = [e for e in errors if '401' not in e and '404' not in e]
    ok("无 JS 错误", len(real) == 0, f"({real[:2]})")

    browser.close()

print(f"\n========== 结果: PASS={PASS} FAIL={FAIL} ==========")
sys.exit(0 if FAIL == 0 else 1)
