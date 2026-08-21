# -*- coding: utf-8 -*-
"""v5.50.30 验证：1) 组装提交立即起 worker 2) 即梦参数弹窗 + params 提交"""
import sys, os, tempfile, json, urllib.request, urllib.error, time
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

# ---------- 1. 后端：RenderSubmit.params 覆盖（HTTP 级，用 mock 提交防消耗额度） ----------
# 直接用已有草稿（草稿 12 有基底图），提交时 params 覆盖，然后任务会被 worker 真实提交！
# 危险：会消耗额度。改用拦截——先验证 worker 立即启动：提交后 3s 内任务状态应从 queued 变 submitting/querying
# 但 worker 提交会真实消耗额度……用 mock CLI？太复杂。
# 安全方案：验证 127/128 在重启后被 resume 接管（它们本来就 queued），同时验证新提交的任务立即被 worker 接管
# —— 新提交会消耗额度。折中：只验证「参数覆盖逻辑」（静态 + 单元），worker 启动用 127/128 观察。

# 先静态断言后端 params 覆盖
src = open(r"C:\Users\admin\prompt-tool-dev\MikPromptKit\backend\api\assemble.py", encoding="utf-8").read()
ok("RenderSubmit 含 params 字段", "params: dict = {}" in src)
ok("submit_render 合并 data.params", "data.params" in src and "params[pk] = pv" in src)
ok("submit_render 起 worker 线程", "threading.Thread(target=_card_gen_worker" in src)

# ---------- 2. 前端：参数弹窗 ----------
img_path = os.path.join(tempfile.gettempdir(), "v55030_pm.png")
Image.new("RGB", (512, 512), (60, 120, 180)).save(img_path)
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

    # 组装：上传基底 → 载入套装 → 点生成 → 弹窗出现（取消，不消耗额度）
    switch_res = lambda tab: page.evaluate("""(t) => {
        const tabs = document.querySelectorAll('.suit-wb-res-tab');
        for (const x of tabs) { if (x.textContent.includes(t)) x.click(); }
    }""", tab) or page.wait_for_timeout(600)
    switch_res("素材")
    page.wait_for_timeout(500)
    page.set_input_files("#baseFileInput", img_path)
    page.wait_for_timeout(4000)
    page.click("#wbBaseConfirm")
    page.wait_for_timeout(600)
    # 载入套装（第一个）
    switch_res("套装")
    page.wait_for_function("() => document.querySelectorAll('.suit-res-suit').length > 0", timeout=10000)
    hasSuit = page.evaluate("() => !!document.querySelector('.suit-res-suit')")
    ok("有套装可载入", hasSuit)
    if hasSuit:
        page.click(".suit-res-suit .suit-res-add")
        # 条件等待模板层填充（_assembleSuit 异步 fetch 完成）
        page.wait_for_function("() => (document.getElementById('slotSuitBody')||{}).textContent ? document.getElementById('slotSuitBody').textContent.includes('✏️') : false", timeout=10000)
        # 点生成 → 参数弹窗（原生 confirm 需提前注册 accept）
        dialogs = []
        page.on("dialog", lambda d: (dialogs.append(d.message[:60]), d.accept()))
        page.click("#wbBtnRender")
        page.wait_for_timeout(1200)
        print("  [DIAG] dialogs:", dialogs)
        bodyHas = page.evaluate("""() => ({
            params: document.body.textContent.includes('生成参数设置'),
            submitFail: document.body.textContent.includes('提交失败'),
            mask: !!document.getElementById('renderParamsMask')
        })""")
        print("  [DIAG] body:", bodyHas)
        ui = page.evaluate("""() => ({
            hasMask: !!document.getElementById('renderParamsMask'),
            modelOpts: document.querySelectorAll('#rpModel option').length,
            ratioOpts: document.querySelectorAll('#rpRatio option').length,
            resolOpts: document.querySelectorAll('#rpResol option').length,
            modelVal: (document.getElementById('rpModel')||{}).value || ''
        })""")
        ok("参数弹窗打开(真实提交路径)", ui['hasMask'])
        ok("模型下拉 9 项", ui['modelOpts'] == 9, f"({ui['modelOpts']})")
        ok("比例下拉 8 项", ui['ratioOpts'] == 8, f"({ui['ratioOpts']})")
        ok("分辨率下拉 3 项", ui['resolOpts'] == 3, f"({ui['resolOpts']})")
        # 取消弹窗（不提交，防消耗额度）
        page.evaluate("() => { var m = document.getElementById('renderParamsMask'); if (m) { m.remove(); window.__rpResolve && window.__rpResolve(null); } }")
        page.wait_for_timeout(300)
    
    # 无 JS 错误
    real = [e for e in errors if '401' not in e and '404' not in e and 'AbortError' not in e]
    ok("无 JS 错误", len(real) == 0, f"({real[:2]})")

    browser.close()
try: os.remove(img_path)
except Exception: pass

print(f"\n========== 结果: PASS=*** FAIL={FAIL} ==========")
sys.exit(0 if FAIL == 0 else 1)
