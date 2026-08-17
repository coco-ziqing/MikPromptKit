# -*- coding: utf-8 -*-
"""清理光厂投稿手动测试数据（[测试] 前缀）"""
import sqlite3

DB = r'C:\Users\admin\prompt-tool-dev\MikPromptKit\data\prompts.db'
c = sqlite3.connect(DB)
c.execute("PRAGMA busy_timeout=4000")
n1 = c.execute("DELETE FROM vjshi_upload_tasks WHERE title LIKE '%[测试]%'").rowcount
n2 = c.execute("DELETE FROM card_gen_tasks WHERE prompt LIKE '%[测试]%'").rowcount
c.commit()
print(f"CLEANED — vjshi_upload_tasks {n1} 条, card_gen_tasks {n2} 条")
