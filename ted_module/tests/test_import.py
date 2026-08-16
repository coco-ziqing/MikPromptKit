# -*- coding: utf-8 -*-
"""导入解析（Excel/CSV）单元测试：用内存生成的临时文件"""
import csv
import io
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services.import_service import detect_table_type, parse_csv, parse_excel


class FakeUpload:
    """模拟 FastAPI UploadFile（仅需 .file 读 bytes）"""
    def __init__(self, data: bytes):
        self.file = io.BytesIO(data)


def _make_xlsx(path, rows):
    import openpyxl
    wb = openpyxl.Workbook()
    ws = wb.active
    for r in rows:
        ws.append(r)
    wb.save(path)
    wb.close()


class TestOfficialTables(unittest.TestCase):
    """官方两张表适配验证：视频机会排行表 / 热搜关键词排行表"""

    def test_detect_opportunity_rank(self):
        t = detect_table_type(["排名", "关键词", "机会指数", "需求指数"])
        self.assertEqual(t, "opportunity_rank")

    def test_detect_hot_keyword(self):
        t = detect_table_type(["排名", "热搜关键词", "热搜指数", "热度"])
        self.assertEqual(t, "hot_keyword")

    def test_detect_generic(self):
        self.assertEqual(detect_table_type(["题材", "销量"]), "generic")

    def test_parse_opportunity_table(self):
        with tempfile.NamedTemporaryFile(suffix=".xlsx", delete=False) as f:
            p = f.name
        try:
            _make_xlsx(p, [
                ["排名", "关键词", "机会指数", "需求指数"],
                [1, "城市夜景", 80, 95],
                [2, "国潮", 30, 88],
            ])
            recs, ttype = parse_excel(p, return_meta=True)
            self.assertEqual(ttype, "opportunity_rank")
            self.assertEqual(len(recs), 2)
            self.assertEqual(recs[0]["theme_raw"], "城市夜景")
            self.assertEqual(recs[0]["demand_index"], 95.0)
            self.assertEqual(recs[0]["opportunity_index"], 80.0)
            self.assertEqual(recs[0]["rank_no"], 1)
        finally:
            os.unlink(p)

    def test_parse_hot_keyword_table(self):
        with tempfile.NamedTemporaryFile(suffix=".xlsx", delete=False) as f:
            p = f.name
        try:
            _make_xlsx(p, [
                ["排名", "热搜关键词", "热搜指数", "热度"],
                [1, "AI动画", 92, 9200],
                [2, "治愈系", 45, 4500],
            ])
            recs, ttype = parse_excel(p, return_meta=True)
            self.assertEqual(ttype, "hot_keyword")
            self.assertEqual(recs[0]["theme_raw"], "AI动画")
            self.assertEqual(recs[0]["demand_index"], 9200.0)  # 热度映射为需求指数（单维）
            self.assertEqual(recs[0]["opportunity_index"], 0.0)
        finally:
            os.unlink(p)


class TestParseExcel(unittest.TestCase):
    def test_standard_headers(self):
        with tempfile.NamedTemporaryFile(suffix=".xlsx", delete=False) as f:
            p = f.name
        try:
            _make_xlsx(p, [
                ["题材", "需求指数", "机会指数"],
                ["城市夜景", 95, 60],
                ["萌宠", 80, 70],
            ])
            recs = parse_excel(p)
            self.assertEqual(len(recs), 2)
            self.assertEqual(recs[0]["theme_raw"], "城市夜景")
            self.assertEqual(recs[0]["demand_index"], 95.0)
            self.assertEqual(recs[0]["opportunity_index"], 60.0)
        finally:
            os.unlink(p)

    def test_english_headers(self):
        with tempfile.NamedTemporaryFile(suffix=".xlsx", delete=False) as f:
            p = f.name
        try:
            _make_xlsx(p, [
                ["theme", "demand", "opportunity", "sales", "revenue", "rank"],
                ["美食", 70, 40, 120, 5000, 3],
            ])
            recs = parse_excel(p)
            self.assertEqual(len(recs), 1)
            self.assertEqual(recs[0]["sales_qty"], 120.0)
            self.assertEqual(recs[0]["revenue"], 5000.0)
            self.assertEqual(recs[0]["rank_no"], 3)
        finally:
            os.unlink(p)

    def test_blank_rows_skipped(self):
        with tempfile.NamedTemporaryFile(suffix=".xlsx", delete=False) as f:
            p = f.name
        try:
            _make_xlsx(p, [
                ["题材", "需求指数"],
                ["国潮", 66],
                [None, None],
                ["", ""],
            ])
            recs = parse_excel(p)
            self.assertEqual(len(recs), 1)
        finally:
            os.unlink(p)


class TestParseCsv(unittest.TestCase):
    def _write(self, rows, encoding="utf-8-sig"):
        f = tempfile.NamedTemporaryFile(suffix=".csv", delete=False, mode="w", encoding=encoding, newline="")
        w = csv.writer(f)
        w.writerows(rows)
        f.close()
        return f.name

    def test_utf8(self):
        p = self._write([["题材", "需求指数", "机会指数"], ["科技感", 88, 45]])
        try:
            recs = parse_csv(p)
            self.assertEqual(recs[0]["theme_raw"], "科技感")
            self.assertEqual(recs[0]["demand_index"], 88.0)
        finally:
            os.unlink(p)

    def test_gbk(self):
        p = self._write([["题材", "需求指数"], ["美食", 77]], encoding="gbk")
        try:
            recs = parse_csv(p)
            self.assertEqual(recs[0]["theme_raw"], "美食")
        finally:
            os.unlink(p)

    def test_number_with_commas(self):
        p = self._write([["题材", "销售额"], ["美食", "12,000"]])
        try:
            recs = parse_csv(p)
            self.assertEqual(recs[0]["revenue"], 12000.0)
        finally:
            os.unlink(p)


if __name__ == "__main__":
    unittest.main()
