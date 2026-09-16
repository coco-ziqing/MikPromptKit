# -*- coding: utf-8 -*-
"""光厂「审核/作品管理」页只读勘察（v5.50.68）

用途：确认「审核通过后能否自动捕获信息」——先摸清页面的 URL、DOM 与背后接口。
本脚本**只读**：不点击任何按钮、不提交任何表单、不上传文件。

用法：
  C:\\Users\\admin\\AppData\\Local\\Python\\bin\\python.exe backend\\tests\\_vjshi_review_inspect.py "<作品管理页URL>"
  （URL 就是你登录光厂后，能看到「审核中 / 已上架 / 已驳回」那些作品的那个页面地址）

输出：
  data/vjshi/review_inspect.json   —— 结构化结果（含页面发起的 XHR 接口，最关键）
  data/vjshi/review_inspect.html   —— 页面完整 HTML（离线分析兜底）
"""
import json, os, sys, io, time

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

from playwright.sync_api import sync_playwright

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ROOT = os.path.dirname(BASE)
PROFILE = os.path.join(ROOT, "data", "vjshi_profile")
OUT_JSON = os.path.join(ROOT, "data", "vjshi", "review_inspect.json")
OUT_HTML = os.path.join(ROOT, "data", "vjshi", "review_inspect.html")
os.makedirs(PROFILE, exist_ok=True)
os.makedirs(os.path.dirname(OUT_JSON), exist_ok=True)

URL = (sys.argv[1] if len(sys.argv) > 1 else "").strip()
if not URL:
    print("用法: python backend/tests/_vjshi_review_inspect.py \"<作品管理页URL>\"")
    sys.exit(2)

out = {"url": URL}
xhr = []


def collect(page):
    info = {"final_url": page.url, "title": page.title()}
    # 1) 所有可见链接（作品链接通常在这里）
    info["links"] = page.eval_on_selector_all(
        "a[href]",
        """els => els.slice(0, 200).map(el => {
            const r = el.getBoundingClientRect();
            return {text: (el.textContent||'').trim().slice(0,40), href: el.getAttribute('href')||'',
                    visible: r.width > 0 && r.height > 0};
        }).filter(x => x.visible)""")
    # 2) 按钮/可点标签文案（状态筛选、审核状态文案）
    info["buttons"] = page.eval_on_selector_all(
        "button,[role=button],.dioa-btn,.dioa-tag,.tag,[class*=status],[class*=state]",
        """els => els.slice(0, 200).map(el => {
            const r = el.getBoundingClientRect();
            return {tag: el.tagName, cls: (el.className||'').toString().slice(0,60),
                    text: (el.textContent||'').trim().slice(0,40), visible: r.width > 0 && r.height > 0};
        }).filter(x => x.visible && x.text)""")
    # 3) 表格（若为表格布局：每行单元格文本）
    rows = []
    for tb in page.query_selector_all("table"):
        try:
            rws = tb.eval_on_selector_all(
                "tr",
                "els => els.slice(0,30).map(tr => Array.from(tr.querySelectorAll('th,td')).map(td => (td.textContent||'').trim().slice(0,50)))")
            if rws:
                rows.append(rws)
        except Exception:
            pass
    info["tables"] = rows
    # 4) 列表/卡片式布局：抓前若干条目的整段文本 + data-* 属性（可能含作品 id）
    info["cards"] = page.eval_on_selector_all(
        "[class*=item],[class*=card],[class*=list-row],[class*=listItem]",
        """els => els.slice(0, 25).map(el => ({
            cls: (el.className||'').toString().slice(0,60),
            text: (el.innerText||'').trim().slice(0,300),
            data: Object.fromEntries(Object.entries(el.dataset||{}).slice(0,10))
        })).filter(x => x.text)""")
    # 5) 页面正文（判断状态文案、驳回原因）
    try:
        info["body_text"] = page.inner_text("body")[:4000]
    except Exception:
        info["body_text"] = ""
    return info


def main():
    with sync_playwright() as p:
        ctx = p.chromium.launch_persistent_context(
            PROFILE, channel="chrome", headless=False,
            viewport={"width": 1440, "height": 900}, locale="zh-CN")
        page = ctx.pages[0] if ctx.pages else ctx.new_page()

        def on_req(req):
            if req.resource_type in ("xhr", "fetch"):
                xhr.append({"method": req.method, "url": req.url,
                            "post": (req.post_data or "")[:300]})

        page.on("request", on_req)

        print(f"[1/3] 打开（只读，不点击）：{URL}")
        try:
            page.goto(URL, wait_until="commit", timeout=90000)
        except Exception as e:
            print("  goto 未完成（继续尝试读取当前页面）:", str(e)[:140])

        # v5.50.68: 光厂有反爬校验页（Page Verification），需人工在窗口里过一下
        print("  等待页面就绪（最多 180s；若弹出人机校验/登录，请在窗口里处理）...")
        deadline = time.time() + 180
        last = ""
        while time.time() < deadline:
            time.sleep(3)
            try:
                t = page.title()
                rs = page.evaluate("() => document.readyState")
            except Exception:
                t, rs = "", ""
            if t != last:
                print(f"    当前 title={t!r} readyState={rs}")
                last = t
            if "Verification" in (t or "") or "验证" in (t or "") or "校验" in (t or ""):
                print("    ⚠️ 命中人机校验页——请在浏览器窗口里完成校验，脚本会继续等")
                time.sleep(10)
                continue
            if rs == "complete" and t:
                break
        try:
            print(f"  落定 URL: {page.url[:140]}")
            print(f"  落定标题: {page.title()}")
        except Exception:
            pass

        print("[2/3] 采集页面结构 ...")
        out["page"] = collect(page)
        out["xhr"] = xhr

        try:
            with open(OUT_HTML, "w", encoding="utf-8") as f:
                f.write(page.content())
            print("  HTML 已保存:", OUT_HTML)
        except Exception as e:
            print("  HTML 保存失败:", e)

        # 简要打印，便于当场判断
        print(f"\n  最终 URL : {out['page'].get('final_url')}")
        print(f"  页面标题 : {out['page'].get('title')}")
        print(f"  可见链接 : {len(out['page'].get('links') or [])}")
        print(f"  可见按钮/状态标签 : {len(out['page'].get('buttons') or [])}")
        print(f"  表格数 : {len(out['page'].get('tables') or [])}")
        print(f"  卡片条目 : {len(out['page'].get('cards') or [])}")
        print(f"  XHR/fetch 接口 : {len(xhr)}")
        for r in xhr[:12]:
            print(f"    {r['method']:<5} {r['url'][:120]}")
        txt = (out["page"].get("body_text") or "")
        for kw in ("审核中", "已上架", "已通过", "驳回", "未通过", "已下架", "在售"):
            if kw in txt:
                print(f"  正文命中状态词: {kw}")

        print("\n[3/3] 保存 JSON ...")
        with open(OUT_JSON, "w", encoding="utf-8") as f:
            json.dump(out, f, ensure_ascii=False, indent=1)
        print("  已保存:", OUT_JSON)
        print("\n[完成] 全程只读：未点击、未提交、未上传。把这两个文件路径告诉 Mik 即可。")
        ctx.close()


if __name__ == "__main__":
    main()
