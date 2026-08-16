# -*- coding: utf-8 -*-
"""评分模型 + 四池划分 单元测试"""
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services.score_service import classify_pool, composite_score, sales_signal


class TestSalesSignal(unittest.TestCase):
    def test_zero(self):
        self.assertEqual(sales_signal(0, 0), 0.0)

    def test_positive(self):
        s = sales_signal(1000, 5000)
        self.assertGreater(s, 0)
        self.assertLessEqual(s, 100)


class TestComposite(unittest.TestCase):
    def test_no_sales(self):
        self.assertEqual(composite_score(80, 60, 0.0, False), round(0.6 * 80 + 0.4 * 60, 2))

    def test_with_sales(self):
        c = composite_score(80, 60, 100, True)
        self.assertEqual(c, round(0.5 * 80 + 0.3 * 60 + 0.2 * 100, 2))

    def test_bounds(self):
        self.assertLessEqual(composite_score(100, 100, 100, True), 100)
        self.assertGreaterEqual(composite_score(0, 0, 0, True), 0)


class TestClassifyPool(unittest.TestCase):
    def test_main_pool(self):
        pool, reason = classify_pool(80, 70)
        self.assertEqual(pool, "main_pool")
        self.assertIn("双高", reason)

    def test_red_ocean(self):
        pool, _ = classify_pool(80, 30)
        self.assertEqual(pool, "red_ocean")

    def test_blue_ocean(self):
        pool, _ = classify_pool(40, 70)
        self.assertEqual(pool, "blue_ocean")

    def test_sunset(self):
        pool, _ = classify_pool(30, 30)
        self.assertEqual(pool, "sunset")

    def test_threshold_boundary(self):
        # 需求 60 恰好达标，机会 50 恰好达标 → 主力池
        pool, _ = classify_pool(60, 50)
        self.assertEqual(pool, "main_pool")
        # 机会 49.9 → 需求高但机会低 → 内卷慎入
        pool, _ = classify_pool(60, 49.9)
        self.assertEqual(pool, "red_ocean")


if __name__ == "__main__":
    unittest.main()
