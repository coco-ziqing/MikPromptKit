"""快速检查服务是否运行"""
import urllib.request
try:
    r = urllib.request.urlopen("http://127.0.0.1:8080/api/health/check", timeout=5)
    print(f"HTTP {r.status} - OK")
except Exception as e:
    print(f"FAIL: {e}")
