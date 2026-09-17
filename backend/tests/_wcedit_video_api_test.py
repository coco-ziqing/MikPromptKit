"""词卡「视频提示词」端到端落库验证（v5.50.68）

链路：前端 _normalize 保留字段 → PUT /api/v4/word-cards/{id} → 后端 update_card 落库
做法：直接调用真实路由函数（get_current_user 打桩成已登录 admin，绕开 401），
      建一张临时词卡 → 写入视频提示词 → 读回 → 改值 → 读回 → 硬删除清理。
用法： C:\\Users\\admin\\AppData\\Local\\Python\\bin\\python.exe backend\\tests\\_wcedit_video_api_test.py
"""
import io, os, sys

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, BASE)
os.environ.setdefault("PORT", "8080")

from api import word_cards as wc


class FakeReq:
    pass


wc.get_current_user = lambda request: {
    "authenticated": True, "id": 1, "username": "admin", "role": "admin"
}

fails = []


def ok(name, cond, extra=""):
    print(("  PASS  " if cond else "  FAIL  ") + name + (("  " + str(extra)) if extra else ""))
    if not cond:
        fails.append(name)


db = wc.get_db()
MARK = "__tmp_video_save_test__"
cid = None
try:
    print("[1] 创建临时词卡（含视频提示词三档）")
    r = wc.create_card({
        "content": MARK, "name": "临时测试卡",
        "content_video": "V1", "content_video_simple": "VS1", "content_video_detailed": "VD1",
    })
    cid = r["id"]
    row = db.execute("SELECT content_video,content_video_simple,content_video_detailed FROM word_card WHERE id=?", [cid]).fetchone()
    ok("建卡即带 content_video", row["content_video"] == "V1", row["content_video"])
    ok("建卡即带 _simple", row["content_video_simple"] == "VS1")
    ok("建卡即带 _detailed", row["content_video_detailed"] == "VD1")

    print("[2] 模拟编辑弹窗保存（PUT 三档新值）")
    wc.update_card(cid, {
        "name": "临时测试卡", "content": MARK,
        "content_video": "V2-视频提示词", "content_video_simple": "VS2", "content_video_detailed": "VD2",
    })
    row = db.execute("SELECT content_video,content_video_simple,content_video_detailed FROM word_card WHERE id=?", [cid]).fetchone()
    ok("修改后 content_video 落库", row["content_video"] == "V2-视频提示词", row["content_video"])
    ok("修改后 _simple 落库", row["content_video_simple"] == "VS2")
    ok("修改后 _detailed 落库", row["content_video_detailed"] == "VD2")

    print("[3] 清空视频提示词（用户删除内容）")
    wc.update_card(cid, {"content": MARK, "content_video": "", "content_video_simple": "", "content_video_detailed": ""})
    row = db.execute("SELECT content_video FROM word_card WHERE id=?", [cid]).fetchone()
    ok("可以清空", row["content_video"] == "", repr(row["content_video"]))

    print("[4] 只传 content（不带视频字段）→ 不应把已有值冲掉")
    wc.update_card(cid, {"content": MARK, "content_video": "V3-保留我"})
    wc.update_card(cid, {"content": MARK + "x"})   # 不带视频字段
    row = db.execute("SELECT content_video FROM word_card WHERE id=?", [cid]).fetchone()
    ok("未传视频字段时保留原值", row["content_video"] == "V3-保留我", row["content_video"])

finally:
    # 清理：硬删除临时卡 + 其版本快照
    if cid:
        try:
            db.execute("DELETE FROM word_card_versions WHERE card_id=?", [cid])
            db.execute("DELETE FROM word_card WHERE id=?", [cid])
            wc.safe_commit()
            left = db.execute("SELECT COUNT(1) FROM word_card WHERE id=?", [cid]).fetchone()[0]
            print(f"\n清理: 临时词卡 #{cid} 已硬删除（剩余行数={left}）")
        except Exception as e:
            print("\n清理失败:", e)

print()
if fails:
    print("RESULT: FAIL ->", fails)
    sys.exit(1)
print("RESULT: PASS")
sys.exit(0)
