# -*- coding: utf-8 -*-
"""题材清洗 / 同义词 / 聚类 / 归一化 单元测试"""
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services.clean_service import (aggregate_metrics, clean_theme, cluster_records,
                                    lookup_synonym, minmax_normalize, normalize)


class TestNormalize(unittest.TestCase):
    def test_fullwidth_to_halfwidth(self):
        self.assertEqual(normalize("ＡＢＣ１２３"), "abc123")

    def test_strip_spaces_and_lower(self):
        self.assertEqual(normalize(" 城市 夜景 "), "城市夜景")

    def test_stopwords_removed_in_clean(self):
        self.assertNotIn("视频", clean_theme("科技感视频素材"))
        self.assertEqual(clean_theme("科技感视频素材"), "科技感")


class TestSynonym(unittest.TestCase):
    def test_synonym_dict(self):
        self.assertEqual(lookup_synonym("都市夜景"), "城市夜景")
        self.assertEqual(lookup_synonym("汉服人物"), "古风人物")

    def test_unknown_keeps_original(self):
        self.assertEqual(lookup_synonym("海上日出"), "海上日出")


class TestCluster(unittest.TestCase):
    def test_synonym_merge(self):
        records = [
            {"theme_raw": "都市夜景"}, {"theme_raw": "城市夜景"}, {"theme_raw": "美食"},
        ]
        groups, order = cluster_records(records)
        self.assertIn("城市夜景", groups)
        self.assertEqual(len(groups["城市夜景"]), 2)
        self.assertEqual(len(order), 2)

    def test_fuzzy_merge_similar(self):
        records = [{"theme_raw": "城市夜景"}, {"theme_raw": "城市夜"}]  # 高度相似
        groups, order = cluster_records(records)
        self.assertEqual(len(order), 1)

    def test_distinct_not_merged(self):
        records = [{"theme_raw": "城市夜景"}, {"theme_raw": "国潮"}, {"theme_raw": "萌宠"}]
        groups, order = cluster_records(records)
        self.assertEqual(len(order), 3)


class TestNormalize(unittest.TestCase):
    def test_minmax(self):
        vals = [10, 20, 30]
        self.assertEqual(minmax_normalize(vals), [0.0, 50.0, 100.0])

    def test_minmax_all_zero(self):
        self.assertEqual(minmax_normalize([0, 0, 0]), [0.0, 0.0, 0.0])

    def test_minmax_single(self):
        # 唯一题材 = 版本内最高需求 → 归一化为 100
        self.assertEqual(minmax_normalize([5]), [100.0])

    def test_aggregate_metrics(self):
        groups = {
            "美食": [{"demand_index": 100, "opportunity_index": 40, "sales_qty": 10, "revenue": 100}],
            "萌宠": [{"demand_index": 50, "opportunity_index": 80, "sales_qty": 0, "revenue": 0}],
        }
        metrics = aggregate_metrics(groups, ["美食", "萌宠"], 1)
        by_key = {m["theme_key"]: m for m in metrics}
        self.assertEqual(by_key["美食"]["demand_index"], 100.0)
        self.assertEqual(by_key["萌宠"]["demand_index"], 0.0)
        self.assertEqual(by_key["萌宠"]["opportunity_index"], 100.0)


if __name__ == "__main__":
    unittest.main()
