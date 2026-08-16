# -*- coding: utf-8 -*-
"""端到端流程测试：上传 → 分析 → 分池 → 台账 → 规划书（独立临时库）"""
import os
import shutil
import sys
import tempfile
import unittest

MODULE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, MODULE_DIR)

# 用独立临时数据目录，避免污染真实数据
_TMP = tempfile.mkdtemp(prefix="ted_test_")
import config
config.DATA_DIR = _TMP
config.UPLOAD_DIR = os.path.join(_TMP, "uploads")
config.DB_PATH = os.path.join(_TMP, "ted_test.db")
os.makedirs(config.UPLOAD_DIR, exist_ok=True)

from db import get_conn, init_db
from services.import_service import add_announcement, import_snapshot
from services.score_service import analyze_version
from services.plan_service import generate_plan


class FakeUpload:
    def __init__(self, data: bytes):
        import io
        self.file = io.BytesIO(data)


def _make_xlsx_bytes(rows):
    import io
    import openpyxl
    wb = openpyxl.Workbook()
    ws = wb.active
    for r in rows:
        ws.append(r)
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


class TestE2EFlow(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        init_db()

    def test_full_flow(self):
        # 1. 上传快照（Excel：双高/红海/蓝海/双低 四类样本）
        xlsx = _make_xlsx_bytes([
            ["题材", "需求指数", "机会指数", "销量", "销售额"],
            ["城市夜景", 95, 80, 500, 30000],
            ["都市夜景", 92, 78, 480, 28000],   # 同义词 → 并入城市夜景
            ["古风人物", 88, 25, 300, 15000],    # 高需求低机会 → 内卷慎入
            ["海上日出", 30, 75, 20, 800],       # 低需求高机会 → 蓝海观察
            ["小众冷门", 10, 10, 0, 0],          # 双低 → 滞销淘汰
        ])
        r = import_snapshot(FakeUpload(xlsx), "test_snapshot.xlsx", "excel",
                            "测试快照-2026W33", "tester", "单元测试")
        vid = r["version_id"]
        self.assertGreater(vid, 0)
        self.assertEqual(r["rows"], 5)

        # 2. 公告录入
        aid = add_announcement("测试公告", "人工录入内容", "2026-08-16", "人工整理")
        self.assertGreater(aid, 0)

        # 3. 分析
        res = analyze_version(vid)
        self.assertEqual(res["theme_count"], 4)  # 同义词聚类 5→4
        self.assertTrue(res["has_sales"])

        # 4. 分池校验
        conn = get_conn()
        try:
            pools = conn.execute(
                "SELECT p.pool_type, t.display_name FROM theme_pools p JOIN themes t ON t.id=p.theme_id "
                "WHERE p.version_id=?", [vid]).fetchall()
            pmap = {r["display_name"]: r["pool_type"] for r in pools}
            self.assertEqual(pmap["城市夜景"], "main_pool")
            self.assertEqual(pmap["古风人物"], "red_ocean")
            self.assertEqual(pmap["海上日出"], "blue_ocean")
            self.assertEqual(pmap["小众冷门"], "sunset")
            ver = conn.execute("SELECT status FROM snapshot_versions WHERE id=?", [vid]).fetchone()
            self.assertEqual(ver["status"], "analyzed")
        finally:
            conn.close()

        # 5. 规划书生成（含合规章节）
        pid = generate_plan(vid, "tester")
        conn = get_conn()
        try:
            plan = conn.execute("SELECT content_md FROM plan_documents WHERE id=?", [pid]).fetchone()
            md = plan["content_md"]
            self.assertIn("合规风控章节", md)
            self.assertIn("不访问光厂官网", md)
            self.assertIn("主力投产池", md)
            self.assertIn("滞销淘汰池", md)
        finally:
            conn.close()

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(_TMP, ignore_errors=True)


if __name__ == "__main__":
    unittest.main()
