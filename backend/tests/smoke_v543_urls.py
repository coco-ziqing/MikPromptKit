# -*- coding: utf-8 -*-
"""v5.43.0 URL收藏库冒烟测试（测试数据用后即清）"""
import json
import sqlite3
import sys
import time
import urllib.request

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

BASE = "http://127.0.0.1:8080/api/card-collect"


def req(method, path, body=None):
    url = BASE + path
    data = json.dumps(body).encode("utf-8") if body is not None else None
    r = urllib.request.Request(url, data=data, method=method,
                               headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(r, timeout=30) as resp:
            return resp.status, json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode("utf-8"))


def main():
    print("== 1. POST /urls 批量入库 ==")
    st, d = req("POST", "/urls", {"urls": [
        "https://example.com",
        "https://www.liblib.art/model/123?utm_source=test&spm=abc",
        "https://www.midjourney.com/explore",
        "not-a-url",
    ]})
    print(st, d.get("count"), "invalid 校验:", "含非法地址" in str(d.get("detail", "")))
    if st != 400:
        print("!! 非法地址未被拦截"); sys.exit(1)

    st, d = req("POST", "/urls", {"urls": [
        "https://example.com",
        "https://www.liblib.art/model/123?utm_source=test&spm=abc",
        "https://www.midjourney.com/explore",
    ]})
    print(st, "count:", d.get("count"))
    ids = [i["id"] for i in d.get("items", [])]
    print("items:", [(i["id"], i["domain"], i["site_name"], i["fetch_status"], i["status"]) for i in d.get("items", [])])
    assert d.get("count") == 3, "入库数量不对"

    print("\n== 2. GET /favorites 验证新列 ==")
    st, d = req("GET", "/favorites")
    print(st, "items:", len(d.get("items", [])))
    liblib = [i for i in d["items"] if i["id"] == ids[1]][0]
    print("liblib site_name:", liblib["site_name"], "| domain:", liblib["domain"])
    assert liblib["site_name"] == "LibLib 哩布哩布", "site_name 匹配失败"
    assert liblib["domain"] == "www.liblib.art", "domain 提取失败"

    print("\n== 3. POST /urls/status 批量状态变更 ==")
    st, d = req("POST", "/urls/status", {"ids": ids[:2], "status": "ready"})
    print(st, "updated:", d.get("updated"))
    assert d.get("updated") == 2, "状态更新数量不对"
    st, d = req("POST", "/urls/status", {"ids": [ids[2]], "status": "hold"})
    print(st, "updated:", d.get("updated"))
    st, d = req("POST", "/urls/status", {"ids": [ids[0]], "status": "bad_status"})
    print("非法状态拦截:", st, d.get("detail", "")[:40])
    assert st == 400

    print("\n== 4. POST /urls/collect 批量生成采集任务（example.com 无害站点）==")
    st, d = req("POST", "/urls/collect", {"ids": [ids[0]]})
    print(st, d)
    assert st == 200 and d.get("count") == 1, "批量采集入队失败"
    tid = d["task_ids"][0]
    time.sleep(3)
    st, d = req("GET", "/tasks?limit=5")
    task = [t for t in d.get("items", []) if t["id"] == tid][0]
    print("任务状态:", task["status"], "| message:", task["message"][:60])

    print("\n== 5. POST /urls/delete 批量删除 ==")
    st, d = req("POST", "/urls/delete", {"ids": ids})
    print(st, "deleted:", d.get("deleted"))
    assert d.get("deleted") == 3, "删除数量不对"

    # 清理任务记录（example.com 测试任务）
    conn = sqlite3.connect(r"C:\Users\admin\prompt-tool-dev\MikPromptKit\data\prompts.db")
    conn.execute("DELETE FROM card_collect_tasks WHERE id=?", [tid])
    conn.commit()
    conn.close()
    print("\n✅ 冒烟测试全部通过，测试数据已清理")


if __name__ == "__main__":
    main()
