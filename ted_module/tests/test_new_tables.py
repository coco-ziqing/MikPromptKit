# -*- coding: utf-8 -*-
"""新表型测试：关键词分析周报 + 视频销售记录（真实结构 2026-08-16 样本）"""
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services.import_service import detect_table_type, parse_excel


def _make_xlsx(path, sheets):
    import openpyxl
    wb = openpyxl.Workbook()
    wb.remove(wb.active)
    for sn, rows in sheets:
        ws = wb.create_sheet(sn)
        for r in rows:
            ws.append(r)
    wb.save(path)
    wb.close()


class TestKeywordAnalysis(unittest.TestCase):
    """视频关键词分析周报：关键词 | 展示次数 | 点击次数 | 销售次数 | 销售收入 | 点击率 | 转化率"""

    def test_detect(self):
        self.assertEqual(
            detect_table_type(["关键词", "展示次数", "点击次数", "销售次数", "销售收入", "点击率", "转化率"]),
            "keyword_analysis")

    def test_parse(self):
        with tempfile.NamedTemporaryFile(suffix=".xlsx", delete=False) as f:
            p = f.name
        try:
            _make_xlsx(p, [("数据分析", [
                ["关键词", "展示次数", "点击次数", "销售次数", "销售收入", "点击率", "转化率"],
                ["", 158.0, 16.0, 0.0, 0.0, 0.101, 0.0],          # 空关键词行 → 跳过
                ["动态太极图", 33.0, 0.0, 0.0, 0.0, 0.0, 0.0],
                ["蓝色背景", 30.0, 0.0, 0.0, 0.0, 0.0, 0.0],
                ["佛手拈花", 14.0, 6.0, 1.0, 10.0, 0.429, 0.02],
            ])])
            recs, ttype = parse_excel(p, return_meta=True)
            self.assertEqual(ttype, "keyword_analysis")
            self.assertEqual(len(recs), 3)   # 空关键词行跳过
            self.assertEqual(recs[0]["theme_raw"], "动态太极图")
            self.assertEqual(recs[0]["demand_index"], 33.0)     # 展示次数 → 需求
            self.assertEqual(recs[0]["opportunity_index"], 0.0) # 转化率缺失行
            self.assertEqual(recs[2]["demand_index"], 14.0)
            self.assertEqual(recs[2]["opportunity_index"], 0.02)  # 转化率 → 机会
            self.assertEqual(recs[2]["sales_qty"], 1.0)          # 销售次数
            self.assertEqual(recs[2]["revenue"], 10.0)           # 销售收入
        finally:
            os.unlink(p)


class TestSalesRecord(unittest.TestCase):
    """视频销售记录：购买时间 | 购买账号 | 订单编号 | 视频标题 | 搜索词 | 收益金额 ..."""

    def test_detect(self):
        self.assertEqual(
            detect_table_type(["购买时间", "购买账号", "订单编号", "视频标题", "搜索词", "收益金额"]),
            "sales_record")

    def test_parse_theme_fallback_title(self):
        """搜索词为空时回退视频标题"""
        with tempfile.NamedTemporaryFile(suffix=".xlsx", delete=False) as f:
            p = f.name
        try:
            _make_xlsx(p, [("视频销售记录", [
                ["购买时间", "购买账号", "订单编号", "视频标题", "搜索词", "收益金额", "原价"],
                ["2026-08-16 11:11:54", "洛鸿影像", "SC1", "蓝色科技流光背景", None, 50.4, 72.0],
                ["2026-08-15 17:47:59", "湟阿康", "SC2", "蓝色科技流光背景", "科技领奖", 12.6, 18.0],
                ["2026-07-29 12:11:15", "v2", "SC3", "蓝色流线动态背景", "蓝色背景", 12.6, 18.0],
            ])])
            recs, ttype = parse_excel(p, return_meta=True)
            self.assertEqual(ttype, "sales_record")
            self.assertEqual(len(recs), 3)
            # 搜索词为空 → 回退视频标题
            self.assertEqual(recs[0]["theme_raw"], "蓝色科技流光背景")
            self.assertEqual(recs[0]["revenue"], 50.4)   # 收益金额
            self.assertEqual(recs[0]["sales_qty"], 1.0)  # 每条记录计 1 次销售
            # 有搜索词 → 用搜索词
            self.assertEqual(recs[1]["theme_raw"], "科技领奖")
            self.assertEqual(recs[1]["revenue"], 12.6)
        finally:
            os.unlink(p)


if __name__ == "__main__":
    unittest.main()
