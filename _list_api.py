import re
with open('backend/api/v2.py','r',encoding='utf-8') as f:
    txt = f.read()
endpoints = re.findall(r'@router\.(get|post|put|delete)\("([^"]+)"\)', txt)
print(f'v2.py endpoints: {len(endpoints)}')
for method, path in endpoints:
    print(f'  {method.upper():6} {path}')
