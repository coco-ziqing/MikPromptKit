# -*- coding: utf-8 -*-
"""合规自检单元测试：证明模块无外网/无浏览器自动化/无定时任务"""
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services.compliance_service import scan_schedulers, scan_source


class TestCompliance(unittest.TestCase):
    def test_no_network_code(self):
        r = scan_source()
        self.assertTrue(r["ok"], f"发现禁用模式命中：{r['findings']}")

    def test_no_scheduler(self):
        r = scan_schedulers()
        self.assertTrue(r["ok"], f"发现定时任务模式：{r['findings']}")

    def test_forbidden_patterns_cover_core(self):
        from config import FORBIDDEN_PATTERNS
        for pat in ("requests", "playwright", "selenium", "socket", "subprocess", "schedule"):
            self.assertIn(pat, FORBIDDEN_PATTERNS)


if __name__ == "__main__":
    unittest.main()
