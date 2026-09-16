"""导出 /api/vjshi/tasks 的真实响应，供前端渲染回归测试使用（绕过登录：打桩 get_current_user）

用法： C:\\Users\\admin\\AppData\\Local\\Python\\bin\\python.exe backend\\tests\\_vjtasks_dump.py
输出： backend/tests/_vjtasks_dump.json
"""
import sys, io, os, json

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, BASE)
os.environ.setdefault("PORT", "8080")

from api import vjshi_upload as v


class FakeReq:
    pass


v.get_current_user = lambda request: {
    "authenticated": True, "id": 1, "username": "admin", "role": "admin"
}

v._ensure_table()
data = v.vjshi_list(FakeReq(), None, 200)
out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "_vjtasks_dump.json")
with open(out, "w", encoding="utf-8") as f:
    json.dump(data, f, ensure_ascii=False, indent=1)

tasks = data.get("tasks") or []
print(f"ok={data.get('ok')} tasks={len(tasks)}")
print("state:", data.get("state"))
print("stats:", data.get("stats"))
keys = sorted({k for t in tasks for k in t.keys()})
print("任务字段:", ", ".join(keys))
print("落盘:", out)
