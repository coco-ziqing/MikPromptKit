"""文生图「5.0 平台只先出 1 张导致队列卡住」回归测试（v5.50.70）

背景：即梦 5.0 批量出图时，平台常常先生成 1 张，剩余张数要在即梦侧手动确认才继续；
      gen_status 长时间停在 querying，而 card_gen worker 是全局串行锁 → 整条队列被拖住。
本测试用桩件模拟三种 query_result 返回，验证 _poll_dreamina_image 的行为：
  ① querying 但已带可下载图片  → 立刻收下首张并返回（新行为，就是本次修复点）
  ② querying 且没有任何图片    → 继续轮询直到超时（不能误判成成功）
  ③ success 且带图片           → 正常返回（回归，不能被改坏）
用法： C:\\Users\\admin\\AppData\\Local\\Python\\bin\\python.exe backend\\tests\\_cg_partial_image_test.py
"""
import io, json, os, sys, time, types

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, BASE)
os.environ.setdefault("PORT", "8080")

from api import card_gen as cg
from api import dreamina as dm

fails = []


def ok(name, cond, extra=""):
    print(("  PASS  " if cond else "  FAIL  ") + name + (("  " + str(extra)) if extra else ""))
    if not cond:
        fails.append(name)


# ---- 桩：httpx.Client ----
class _Resp:
    status_code = 200
    content = b"FAKE_PNG_BYTES"


class _Client:
    def __init__(self, **kw):
        pass

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False

    def get(self, url, **kw):
        return _Resp()


_fake_httpx = types.ModuleType("httpx")
_fake_httpx.Client = _Client
sys.modules["httpx"] = _fake_httpx


def set_payload(payload):
    dm._dreamina_run = lambda args, timeout=60: (json.dumps(payload), "", 0)


IMG = {"image_url": "https://example.invalid/a.png", "width": 10, "height": 10}

print("[1] querying 但平台已出图 → 应立刻收下首张（本次修复点）")
set_payload({"submit_id": "t1", "gen_status": "querying",
             "result_json": {"images": [dict(IMG)]}, "queue_info": {"queue_status": "Generating"}})
t0 = time.time()
data, err = cg._poll_dreamina_image("t1", timeout_sec=60)
el = time.time() - t0
ok("返回图片字节而非超时", data == b"FAKE_PNG_BYTES" and err is None, f"err={err}")
ok("几乎立即返回（未空转轮询）", el < 5, f"{el:.2f}s")

print("[2] querying 且没有任何图片 → 必须继续轮询直到超时（不能误判成功）")
set_payload({"submit_id": "t2", "gen_status": "querying",
             "result_json": {"images": []}, "queue_info": {"queue_status": "Queuing"}})
t0 = time.time()
data2, err2 = cg._poll_dreamina_image("t2", timeout_sec=2)
ok("未误判为成功（data 为空）", data2 is None)
ok("报超时", err2 and "超时" in err2, err2)

print("[3] success + 图片 → 正常返回（回归）")
set_payload({"submit_id": "t3", "gen_status": "success", "result_json": {"images": [dict(IMG)]}})
data3, err3 = cg._poll_dreamina_image("t3", timeout_sec=60)
ok("success 路径未被改坏", data3 == b"FAKE_PNG_BYTES" and err3 is None, f"err={err3}")

print("[4] fail → 原样返回失败原因（回归）")
set_payload({"submit_id": "t4", "gen_status": "fail", "fail_reason": "compliance"})
data4, err4 = cg._poll_dreamina_image("t4", timeout_sec=60)
ok("fail 路径未被改坏", data4 is None and err4 == "compliance", f"err={err4}")

print()
if fails:
    print("RESULT: FAIL ->", fails)
    sys.exit(1)
print("RESULT: PASS")
sys.exit(0)
