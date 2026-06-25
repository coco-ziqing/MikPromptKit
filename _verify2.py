import requests, json

r = requests.get('http://127.0.0.1:8080/api/v4/atoms/templates?page_size=3', timeout=5)
print(f'templates: HTTP {r.status_code}')
d = r.json()
print(f'  items: {len(d.get("items",[]))}, total: {d.get("total",0)}')

r2 = requests.get('http://127.0.0.1:8080/api/v4/atoms/stats/usage?days=30&limit=5', timeout=5)
print(f'usage: HTTP {r2.status_code}')
d2 = r2.json()
print(f'  overview: {d2.get("overview",{})}')
