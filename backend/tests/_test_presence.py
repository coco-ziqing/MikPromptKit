# -*- coding: utf-8 -*-
"""Phase34 presence 端到端测试：模拟多账户 WS 在线，验证快照/广播/手动状态/离线。"""
import asyncio, json, sys
sys.path.insert(0, "backend")
from jwt_auth import generate_test_token

try:
    import websockets
except ImportError:
    print("NO_WEBSOCKETS"); sys.exit(2)

BASE = "ws://127.0.0.1:8080/ws/presence"

async def recv_until(ws, pred, timeout=5):
    """接收消息直到满足 pred，返回该消息；超时抛错。"""
    async def _loop():
        while True:
            msg = json.loads(await ws.recv())
            if pred(msg):
                return msg
    return await asyncio.wait_for(_loop(), timeout)

async def main():
    tA = generate_test_token(3, "viewer1", "viewer")
    tB = generate_test_token(2, "editor1", "editor")
    tC = generate_test_token(10, "15754983834", "admin")
    results = []

    # A 连接
    a = await websockets.connect(f"{BASE}?token={tA}")
    snapA = json.loads(await a.recv())
    results.append(("A首屏snapshot", snapA.get("type") == "snapshot" and snapA.get("self_id") == 3))
    # A 应看到自己在线
    a_users = {u["user_id"]: u for u in snapA.get("users", [])}
    results.append(("A快照含自己且online", a_users.get(3, {}).get("status") == "online"))

    # B 连接 → A 应收到 presence_update(uid=2)
    b = await websockets.connect(f"{BASE}?token={tB}")
    _ = json.loads(await b.recv())  # B 的 snapshot
    updB = await recv_until(a, lambda m: m.get("type") == "presence_update" and m.get("user", {}).get("user_id") == 2)
    results.append(("A实时收到B上线", updB["user"]["status"] == "online" and updB["user"]["display_name"] == "编辑员"))

    # B 手动 busy → A 应收到 busy
    await b.send(json.dumps({"type": "status", "status": "busy"}))
    busyB = await recv_until(a, lambda m: m.get("type") == "presence_update" and m.get("user", {}).get("user_id") == 2 and m.get("user", {}).get("status") == "busy")
    results.append(("B手动忙碌广播到A", busyB["user"]["status"] == "busy"))

    # B active → 应回到 online（busy 是手动，active 不清 busy；测 away 清除逻辑改测 status=online）
    await b.send(json.dumps({"type": "status", "status": "online"}))
    onB = await recv_until(a, lambda m: m.get("type") == "presence_update" and m.get("user", {}).get("user_id") == 2 and m.get("user", {}).get("status") == "online")
    results.append(("B恢复在线广播到A", onB["user"]["status"] == "online"))

    # C 连接（第三账户），A 应看到 uid=10
    c = await websockets.connect(f"{BASE}?token={tC}")
    _ = json.loads(await c.recv())
    updC = await recv_until(a, lambda m: m.get("type") == "presence_update" and m.get("user", {}).get("user_id") == 10)
    results.append(("A收到C(张鹏)上线", updC["user"]["display_name"] == "张鹏" and updC["user"]["role"] == "admin"))

    # REST 快照应含 3 人
    import urllib.request
    with urllib.request.urlopen("http://127.0.0.1:8080/api/presence", timeout=4) as r:
        snap = json.loads(r.read().decode())
    ids = set(u["user_id"] for u in snap["users"])
    results.append(("REST快照含2,3,10", {2, 3, 10}.issubset(ids)))
    # 设备解析非空
    devA = next((u for u in snap["users"] if u["user_id"] == 3), {})
    results.append(("含连接设备信息", bool(devA.get("devices"))))

    # B 断开 → A 收到 presence_offline(uid=2)
    await b.close()
    offB = await recv_until(a, lambda m: m.get("type") == "presence_offline" and m.get("user_id") == 2)
    results.append(("B断开→A收到离线", offB.get("user_id") == 2))

    # 多标签：A 再开一个连接，connection_count 应=2
    a2 = await websockets.connect(f"{BASE}?token={tA}")
    _ = json.loads(await a2.recv())
    upd2 = await recv_until(a, lambda m: m.get("type") == "presence_update" and m.get("user", {}).get("user_id") == 3 and m.get("user", {}).get("connection_count") == 2)
    results.append(("A多标签connection_count=2", upd2["user"]["connection_count"] == 2))
    # 关一个标签，A 仍在线（count=1），不应 offline
    await a2.close()
    upd3 = await recv_until(a, lambda m: m.get("type") == "presence_update" and m.get("user", {}).get("user_id") == 3)
    results.append(("A关1标签仍在线", upd3["user"]["status"] == "online" and upd3["user"]["connection_count"] == 1))

    await a.close(); await c.close()

    print("\n==== 测试结果 ====")
    ok = 0
    for name, passed in results:
        print(("  PASS " if passed else "  FAIL ") + name)
        ok += 1 if passed else 0
    print(f"\n{ok}/{len(results)} 通过")
    sys.exit(0 if ok == len(results) else 1)

asyncio.run(main())
