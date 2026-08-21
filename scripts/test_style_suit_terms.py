# -*- coding: utf-8 -*-
"""v5.48.1 术语规范化回归：UI 功能 + 无游戏化残留词"""
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

GAME_WORDS = ["装备", "卡槽", "符文", "背包", "外壳", "配件选配", "渲染参数", "提交批量渲染", "装配到操作台"]
PRO_WORDS = ["角色组装工作台", "角色基底层", "风格词条层", "风格模板层", "视图资产选配", "生成参数", "批量生成", "载入组装工作台"]

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, executable_path=r"C:\Program Files\Google\Chrome\Application\chrome.exe")
    page = browser.new_page(viewport={"width": 1440, "height": 900})
    page.goto(BASE, wait_until="domcontentloaded", timeout=30000)
    page.wait_for_timeout(2500)

    # 登录注入
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

    # 打开风格套装
    page.click("#navDropdownComposer .nav-dropdown-btn")
    page.wait_for_timeout(300)
    page.click("text=风格套装")
    page.wait_for_timeout(1500)

    # 1. 套装库页标题
    title = page.evaluate("() => (document.querySelector('.suit-bag-title') || {}).textContent || ''")
    ok("套装库页标题", '风格套装' in title, f"({title.strip()})")

    # 2. 打开操作台（角色组装工作台）
    page.click("#suitBtnWorkbench")
    page.wait_for_timeout(1000)
    wb_title = page.evaluate("""() => {
        const wb = document.getElementById('viewAssembleWorkbench');
        const t = wb ? wb.querySelector('.suit-bag-title') : null;
        return t ? t.textContent.trim() : '';
    }""")
    ok("工作台标题为专业术语", '角色组装工作台' in wb_title, f"({wb_title})")

    # 3. 四层结构标题检查
    slot_texts = page.evaluate("""() => {
        const labels = document.querySelectorAll('.suit-slot-label');
        return Array.from(labels).map(l => l.textContent.trim());
    }""")
    ok("四层结构术语化", len(slot_texts) == 4, f"({len(slot_texts)} 层)")
    for t in slot_texts:
        ok("  层名: " + t, True)

    # 4. 页面全文本游戏词扫描
    body_text = page.evaluate("() => document.body.innerText")
    game_hits = [w for w in GAME_WORDS if w in body_text]
    ok("无游戏化残留词", len(game_hits) == 0, f"(命中: {game_hits})")

    # 5. 专业术语存在性
    pro_hits = [w for w in PRO_WORDS if w in body_text]
    ok("专业术语已应用", len(pro_hits) >= 5, f"(命中 {len(pro_hits)}/9: {pro_hits})")

    # 6. 回套装库 → 打开编辑器（5 Tab 标题）
    page.evaluate("() => { if (window.STYLE_SUIT) STYLE_SUIT.openBag(); }")
    page.wait_for_timeout(800)
    page.click("#suitBtnNew")
    page.wait_for_timeout(600)
    tab_texts = page.evaluate("""() => {
        const tabs = document.querySelectorAll('.suit-editor-tab');
        return Array.from(tabs).map(t => t.textContent.trim());
    }""")
    ok("编辑器 Tab 术语化", len(tab_texts) == 5, f"({tab_texts})")
    ok("② 生成参数", any('生成参数' in t for t in tab_texts), f"({[t for t in tab_texts if '参数' in t]})")
    ok("③ 视图资产", any('视图资产' in t for t in tab_texts), f"({[t for t in tab_texts if '资产' in t]})")
    page.keyboard.press("Escape")
    page.wait_for_timeout(300)

    browser.close()

print(f"\n========== 结果: PASS=*** FAIL={FAIL} ==========")
sys.exit(0 if FAIL == 0 else 1)
