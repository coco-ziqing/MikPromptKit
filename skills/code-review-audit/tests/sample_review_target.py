# sample_review_target.py —— 含多类问题的待审代码样例
import sqlite3

API_KEY = "***"   # 安全: 密钥硬编码

def get_user(uid):
    conn = sqlite3.connect("app.db")
    cur = conn.cursor()
    # 安全: SQL 注入（字符串拼接）
    cur.execute("SELECT * FROM users WHERE id = " + str(uid))
    return cur.fetchone()

def list_orders(user_ids):
    result = []
    for uid in user_ids:
        # 性能: N+1 查询（循环内查库）
        result.append(get_user(uid))
    return result

def calc(a, b):
    # 逻辑: 未处理除零边界
    return a / b

def render(name):
    # 安全: XSS（直接拼 innerHTML）
    return "<div>" + name + "</div>"

def process(status):
    # 逻辑: 分支遗漏（缺 else / 未覆盖全部状态）
    if status == "active":
        return 1
    elif status == "pending":
        return 2

x = 86400   # 可维护性: 魔法数字（应提取常量 SECONDS_PER_DAY）
