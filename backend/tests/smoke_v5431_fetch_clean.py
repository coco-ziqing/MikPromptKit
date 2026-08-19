# -*- coding: utf-8 -*-
"""v5.43.1 冒烟测试：sites 分组/预制拦截 + fetch-meta + URL 清洗（测试数据用后即清）"""
import json
import sqlite3
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

BASE = "http://127.0.0.1:8080/api/card-collect"
DB = r"C:\Users\admin\prompt-tool-dev\MikPromptKit\data\prompts.db"


def req(method, path, body=None):
    data = json.dumps(body).encode("utf-8") if body is not None else None
    r = urllib.request.Request(BASE + path, data=data, method=method,
                               headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(r, timeout=40) as resp:
            return resp.status, json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode("utf-8"))


def main():
    print("== 1. GET /sites 分组验证 ==")
    st, d = req("GET", "/sites")
    print(st, "sites:", len(d.get("items", [])), "| groups:", d.get("groups"))
    assert "提示词站点" in d.get("groups", []), "分组缺失"
    builtin = [s for s in d["items"] if s.get("is_builtin")]
    print("内置站点数:", len(builtin), "| 示例:", builtin[0]["name"], "→", builtin[0]["group_name"])
    assert len(builtin) >= 10, "内置种子标注不足"

    print("\n== 2. 预制站点删除拦截 ==")
    st, d = req("DELETE", "/sites/" + str(builtin[0]["id"]))
    print(st, d.get("detail", ""))
    assert st == 400, "预制站点未被拦截"

    print("\n== 3. 自定义站点带分组 ==")
    import uuid as _uuid
    tname = "测试站点" + _uuid.uuid4().hex[:6]
    st, d = req("POST", "/sites", {"name": tname, "url": "https://example.com", "group_name": "测试分组"})
    print(st, "group:", d.get("item", {}).get("group_name"), "| is_builtin:", d.get("item", {}).get("is_builtin"))
    sid = d["item"]["id"]
    st, d = req("GET", "/sites?group=" + urllib.parse.quote("测试分组"))
    print("分组过滤:", st, len(d.get("items", [])))
    assert len(d.get("items", [])) == 1, "分组过滤失败"
    st, d = req("DELETE", "/sites/" + str(sid))
    print("自定义删除:", st, d.get("ok"))

    print("\n== 4. fetch-meta 自动抓取（example.com）==")
    st, d = req("POST", "/urls", {"urls": ["https://example.com", "https://example.com/aaa?utm_source=t&spm=1"]})
    print(st, "入库:", d.get("count"))
    ids = [i["id"] for i in d.get("items", [])]
    time.sleep(8)
    st, d = req("GET", "/favorites")
    favs = {i["id"]: i for i in d["items"]}
    f = favs.get(ids[0], {})
    print("fetch_status:", f.get("fetch_status"), "| title:", f.get("fetch_title", "")[:40], "| thumb:", f.get("thumb"))
    assert f.get("fetch_status") == "success", f"抓取失败: {f.get('fetch_status')}"
    assert "Example" in f.get("fetch_title", ""), "标题解析失败"
    if f.get("thumb"):
        st2, _ = req("GET", "/urls/thumb/" + f["thumb"])
        print("thumb serve:", st2)
        assert st2 == 200, "缩略图访问失败"

    print("\n== 5. URL 清洗 ==")
    st, d = req("POST", "/urls/clean", {"ids": ids})
    print(st, "processed:", d.get("processed"))
    for r in d.get("results", []):
        print(" ", r["id"], "changed:", r["changed"], "| dead:", r["dead"], "| dup:", r["duplicate"],
              "| clean:", (r.get("clean_url") or "")[:60])
    c1 = [r for r in d["results"] if r["id"] == ids[1]][0]
    assert c1["changed"], "带参 URL 未清洗"
    assert "utm_source" not in c1["clean_url"], "追踪参数未清除"
    dup_ids = [r["id"] for r in d["results"] if r["duplicate"]]
    print("重复标记条数:", len(dup_ids))

    print("\n== 6. 清理测试数据 ==")
    st, d = req("POST", "/urls/delete", {"ids": ids})
    print("删除:", st, d.get("deleted"))
    conn = sqlite3.connect(DB)
    conn.execute("DELETE FROM card_collect_favorites WHERE id IN (%s)" % ",".join("?" * len(ids)), ids)
    conn.commit()
    conn.close()
    print("✅ v5.43.1 冒烟测试全部通过，测试数据已清理")


if __name__ == "__main__":
    main()
