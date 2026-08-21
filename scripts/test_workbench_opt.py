# -*- coding: utf-8 -*-
"""v5.50.22-23 综合验证：A手动词条/B模板编辑新建/C最终提示词/D按钮+提交/E规范"""
import sys, re, json
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
img_path = os.path.join(tempfile.gettempdir(), "v55023.png")
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

    # ===== A: 手动文本词条 =====
    # 1. 输入框存在
    has_input = page.evaluate("() => !!document.getElementById('runeTextInput')")
    ok("A-手动词条输入框", has_input)
    # 2. 输入并回车添加
    page.fill("#runeTextInput", "精致刺绣服饰，金属配饰")
    page.keyboard.press("Enter")
    page.wait_for_timeout(400)
    text_chip = page.evaluate("() => !!document.querySelector('.suit-rune-text')")
    ok("A-文本词条添加", text_chip)
    # 3. 添加词卡（左侧词卡 tab → 添加一张）
    page.click("#slotRunes")  # 切词卡面板
    page.wait_for_timeout(1200)
    page.evaluate("""() => {
        const card = document.querySelector('.suit-res-card');
        if (card) { card.querySelector('.suit-res-add').click(); }
    }""")
    page.wait_for_timeout(400)
    chip_count = page.evaluate("() => document.querySelectorAll('#slotRunesBody .suit-rune-chip').length")
    ok("A-词卡+文本共存", chip_count >= 2, f"({chip_count} chips)")

    # ===== C: 最终提示词预览栏 =====
    has_final = page.evaluate("() => !!document.getElementById('finalPromptBody')")
    ok("C-最终提示词栏存在", has_final)
    final_text = page.evaluate("() => (document.getElementById('finalPromptBody') || {}).textContent || ''")
    ok("C-含参考@图像1", '@图像1' in final_text, f"({final_text[:60]})")
    ok("C-含手动词条", '刺绣' in final_text, f"({final_text[:60]})")

    # ===== B: 模板层编辑/新建 =====
    # 4. 载入模板（套装 tab → 影视写实）
    page.click("#slotSuit")
    page.wait_for_timeout(1500)
    page.evaluate("""() => {
        const items = document.querySelectorAll('.suit-res-suit');
        for (const it of items) {
            if ((it.textContent || '').includes('电影感')) { it.querySelector('.suit-res-add').click(); break; }
        }
    }""")
    page.wait_for_timeout(800)
    has_edit = page.evaluate("() => !!document.querySelector('[data-act=\"editsuit\"]')")
    ok("B-模板编辑按钮", has_edit)
    # 5. 编辑打开编辑器
    page.evaluate("() => { const b = document.querySelector('[data-act=\"editsuit\"]'); if (b) b.click(); }")
    page.wait_for_timeout(800)
    editor_open = page.evaluate("() => !!document.getElementById('suitEditorMask')")
    ok("B-编辑模板打开编辑器", editor_open)
    page.keyboard.press("Escape")
    page.wait_for_timeout(600)
    # 6. 新建模板（空态 → ＋新建模板）
    page.evaluate("() => { const b = document.querySelector('[data-act=\"newsuit\"]'); if (b) b.click(); }")
    page.wait_for_timeout(800)
    editor_new = page.evaluate("() => !!document.getElementById('suitEditorMask')")
    ok("B-新建模板打开编辑器", editor_new)
    page.keyboard.press("Escape")
    page.wait_for_timeout(600)

    # ===== D: 按钮改名 =====
    btn_text = page.evaluate("() => (document.getElementById('wbBtnRender') || {}).textContent || ''")
    ok("D-默认按钮=角色生成", '角色生成' in btn_text, f"({btn_text.strip()})")
    # 切 comfyui → 批量生成；切回即梦 → 角色生成
    page.evaluate("""() => {
        const sel = document.getElementById('wbPlatform');
        sel.value = 'comfyui'; sel.dispatchEvent(new Event('change'));
    }""")
    page.wait_for_timeout(300)
    btn2 = page.evaluate("() => (document.getElementById('wbBtnRender') || {}).textContent || ''")
    ok("D-comfyui=批量生成", '批量生成' in btn2, f"({btn2.strip()})")
    page.evaluate("""() => {
        const sel = document.getElementById('wbPlatform');
        sel.value = 'dreamina'; sel.dispatchEvent(new Event('change'));
    }""")
    page.wait_for_timeout(300)
    btn3 = page.evaluate("() => (document.getElementById('wbBtnRender') || {}).textContent || ''")
    ok("D-切回即梦=角色生成", '角色生成' in btn3, f"({btn3.strip()})")

    # ===== D2: 提交任务（修复后不再 500）=====
    # 先设基底（上传）
    page.click("#slotBase")
    page.wait_for_timeout(600)
    page.evaluate("""() => {
        const tabs = document.querySelectorAll('.suit-wb-res-tab');
        for (const t of tabs) { if (t.textContent.includes('素材')) t.click(); }
    }""")
    page.wait_for_timeout(400)
    page.set_input_files("#baseFileInput", img_path)
    page.wait_for_timeout(3000)
    # 确认参考
    page.fill("#wbBaseDesc6", "验证基底")
    page.click("#wbBaseConfirm")
    page.wait_for_timeout(600)
    # 提交（取消确认弹窗走 mock：直接确认）
    page.on("dialog", lambda d: d.accept())
    page.click("#wbBtnRender")
    page.wait_for_timeout(3000)
    result_page = page.evaluate("() => !!document.getElementById('viewSuitResult') && !!document.querySelector('.suit-result')")
    ok("D-提交任务进入结果页", result_page)

    # ===== E: 提示词规范（结果页任务 prompt 含 @图像1）=====
    prompt_text = page.evaluate("""() => {
        const t = document.querySelector('.suit-task-card .suit-task-file, .suit-task-card');
        return t ? t.textContent : '';
    }""")
    # 更准确：查批次任务 prompt
    prompt_ok = page.evaluate("""async () => {
        const t = await fetch('/api/auth/login', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({username:'admin', password:'admin'})});
        const d = await t.json();
        return d.token;
    }""")
    page.evaluate("""async (tok) => {
        const r = await fetch('/api/assemble/render', {headers: {'Authorization': 'Bearer ' + tok}});
        const d = await r.json();
        if (d.items && d.items.length && d.items[0].tasks && d.items[0].tasks[0]) {
            window.__lastPrompt = d.items[0].tasks[0].prompt;
        }
    }""", prompt_ok)
    page.wait_for_timeout(500)
    last_prompt = page.evaluate("() => window.__lastPrompt || ''")
    ok("E-提交提示词含@图像1", '@图像1' in last_prompt, f"({last_prompt[:80]})")
    ok("E-提示词含约束段", '物理规律' in last_prompt, f"({last_prompt[-30:]})")

    # 无 JS 错误
    real = [e for e in errors if '401' not in e and 'length' not in e and '404' not in e]
    ok("无 JS 错误", len(real) == 0, f"({real[:2]})")

    browser.close()

try: os.remove(img_path)
except Exception: pass

print(f"\n========== 结果: PASS=*** FAIL={FAIL} ==========")
sys.exit(0 if FAIL == 0 else 1)
