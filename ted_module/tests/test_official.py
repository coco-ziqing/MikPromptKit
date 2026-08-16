# -*- coding: utf-8 -*-
"""官方真实结构单元测试：R1 元信息行 + R2 表头 + 搜索词/作品数 + 多 sheet"""
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services.import_service import detect_table_type, parse_excel


def _make_xlsx(path, sheets):
    """sheets: [(sheet_name, rows), ...]"""
    import openpyxl
    wb = openpyxl.Workbook()
    wb.remove(wb.active)
    for sn, rows in sheets:
        ws = wb.create_sheet(sn)
        for r in rows:
            ws.append(r)
    wb.save(path)
    wb.close()


class TestOfficialRealStructure(unittest.TestCase):
    """官方 2026-08-16 实测结构"""

    def test_opportunity_rank_real(self):
        """机会排行表：R1 元信息行，R2 表头 [排名|搜索词|需求指数|机会指数]，数值带尾随空格"""
        with tempfile.NamedTemporaryFile(suffix=".xlsx", delete=False) as f:
            p = f.name
        try:
            _make_xlsx(p, [("机会排行", [
                ["榜单时间: 2026-08-16", None, "下载时间:  2026-08-16 14:21:06", None, None, None],
                ["排名", "搜索词", "需求指数", "机会指数", None, None],
                ["1", "政务类", "77.7 ", "2878.8 ", None, None],
                ["2", "温暖照片", "684.7 ", "2427.9 ", None, None],
            ])])
            recs, ttype = parse_excel(p, return_meta=True)
            self.assertEqual(ttype, "opportunity_rank")
            self.assertEqual(len(recs), 2)
            self.assertEqual(recs[0]["theme_raw"], "政务类")
            self.assertEqual(recs[0]["demand_index"], 77.7)          # 尾随空格已清理
            self.assertEqual(recs[0]["opportunity_index"], 2878.8)
            self.assertEqual(recs[0]["rank_no"], 1)
            self.assertEqual(recs[0]["sheet_name"], "机会排行")
        finally:
            os.unlink(p)

    def test_hot_keyword_real_multi_sheet(self):
        """热搜排行表：2 个 sheet（热搜榜/上升榜），R2 表头 [排名|搜索词|作品数]"""
        with tempfile.NamedTemporaryFile(suffix=".xlsx", delete=False) as f:
            p = f.name
        try:
            _make_xlsx(p, [
                ("热搜榜", [
                    ["榜单时间: 2026-08-16", "下载时间:  2026-08-16 14:22:01", None],
                    ["排名", "搜索词", "作品数"],
                    ["1", "片头", "617673"],
                    ["2", "科技", "2778068"],
                ]),
                ("上升榜", [
                    ["榜单时间: 2026-08-16", "下载文件时间:  2026-08-16 14:22:01", None],
                    ["排名", "搜索词", "作品数"],
                    ["1", "七夕", "20012"],
                ]),
            ])
            recs, ttype = parse_excel(p, return_meta=True)
            self.assertEqual(ttype, "hot_keyword")
            self.assertEqual(len(recs), 3)   # 两 sheet 合并
            sheets = sorted({r["sheet_name"] for r in recs})
            self.assertEqual(sheets, ["上升榜", "热搜榜"])
            hot = [r for r in recs if r["sheet_name"] == "热搜榜"][0]
            self.assertEqual(hot["theme_raw"], "片头")
            self.assertEqual(hot["works_count"], 617673.0)   # 作品数映射
            self.assertEqual(hot["demand_index"], 0.0)       # 热搜表无需求指数
            self.assertEqual(hot["opportunity_index"], 0.0)  # 无机会指数 → 单维
        finally:
            os.unlink(p)

    def test_detect_real_headers(self):
        self.assertEqual(detect_table_type(["排名", "搜索词", "需求指数", "机会指数"]), "opportunity_rank")
        self.assertEqual(detect_table_type(["排名", "搜索词", "作品数"]), "hot_keyword")


if __name__ == "__main__":
    unittest.main()
