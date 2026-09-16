"""光厂队列状态速查（只读）

用法： C:\\Users\\admin\\AppData\\Local\\Python\\bin\\python.exe backend\\tests\\_vjstatus.py
"""
import sqlite3, io, sys, os

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DB = os.path.join(os.path.dirname(BASE), "data", "prompts.db")
c = sqlite3.connect(DB)
c.row_factory = sqlite3.Row

print("precheck 设置:", dict((r["key"], r["value"]) for r in c.execute("SELECT key,value FROM vjshi_settings")))
print("\n最近任务：")
for r in c.execute(
    "SELECT id,status,fail_category,error,progress_note,review_status FROM vjshi_upload_tasks ORDER BY id DESC LIMIT 10"
):
    print(f"  #{r['id']:<3} {r['status']:<10} {r['fail_category'] or '-':<16} "
          f"{(r['error'] or '')[:50]} | 进度:{(r['progress_note'] or '')[:40]} | 审核:{r['review_status'] or '-'}")
