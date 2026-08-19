# -*- coding: utf-8 -*-
"""v5.43.2 冒烟测试：POST /urls/batch/preview 多标签预展示（测试数据用后即清）"""
import json
import sqlite3
import sys
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
    print("== 1. preview 预展示（含非法/已在库标记）==")
    st, d = req("POST", "/urls/batch/preview", {"urls": [
        "https://example.com",
        "https://www.liblib.art/model/abc",
        "not-a-url",
        "",
    ]})
    print(st, "count:", d.get("count"))
    for i in d.get("items", []):
        print(" ", i["url"][:40], "| valid:", i["valid"], "| site:", i["site_name"], "| in_lib:", i["in_lib"])
    assert st == 200, "preview 失败"
    assert d["count"] == 3, "空串未过滤"
    assert not d["items"][2]["valid"], "非法地址未标记"
    assert d["items"][1]["site_name"] == "LibLib 哩布哩布", "site_name 匹配失败"

    print("\n== 2. 已在库标记 ==")
    # 先入库一条再 preview 验证 in_lib
    st, d = req("POST", "/urls", {"urls": ["https://example.com/inlib-test"]})
    print("入库:", st, d.get("count"))
    assert st == 200
    st, d = req("POST", "/urls/batch/preview", {"urls": ["https://example.com/inlib-test", "https://example.com/new-test"]})
    it = [i for i in d["items"] if i["url"] == "https://example.com/inlib-test"][0]
    print("in_lib 标记:", it["in_lib"])
    assert it["in_lib"], "已在库未标记"

    print("\n== 3. 上限拦截 ==")
    st, d = req("POST", "/urls/batch/preview", {"urls": ["https://example.com"] * 101})
    print(st, d.get("detail", "")[:40])
    assert st == 400

    print("\n== 4. 清理 ==")
    conn = sqlite3.connect(DB)
    conn.execute("DELETE FROM card_collect_favorites WHERE url LIKE '%inlib-test%' OR url LIKE '%new-test%'")
    conn.commit()
    conn.close()
    print("已清理")
    print("✅ v5.43.2 冒烟测试全部通过")


if __name__ == "__main__":
    main()
