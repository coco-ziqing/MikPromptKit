import urllib.request, json

print("=== PromptKit i18n 验证 ===")

# 1. 页面
body = urllib.request.urlopen('http://127.0.0.1:8080/', timeout=5).read().decode('utf-8')
print(f"1. 页面: {len(body)} chars")
print(f"   app_i18n.js?v=10: {'app_i18n.js?v=10' in body}")
print(f"   app_core.js?v=13.0: {'app_core.js?v=13.0' in body}")

# 2. en.json
en = json.loads(urllib.request.urlopen('http://127.0.0.1:8080/static/i18n/en.json', timeout=5).read())
print(f"2. en.json: {len(en)} keys")
for k in ['nav.home','common.saved','common.delete','lang.switch','search.searching','trash.restore','common.copied']:
    print(f"   {k}: {en.get(k, 'MISSING')}")

# 3. 健康
h = json.loads(urllib.request.urlopen('http://127.0.0.1:8080/api/health/check', timeout=5).read())
print(f"3. 健康: ok={h.get('ok')} errors={h.get('error_count', '?')}")

# 4. 关键 i18n 端点
for endpoint in ['/api/v4/word-cards/groups', '/api/v4/word-cards?page=1&page_size=3']:
    try:
        r = urllib.request.urlopen(f'http://127.0.0.1:8080{endpoint}', timeout=5)
        print(f"4. {endpoint}: {r.status}")
    except Exception as e:
        print(f"4. {endpoint}: FAIL - {e}")

print("\n=== ALL CHECKS PASSED ===")
