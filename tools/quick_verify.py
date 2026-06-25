import re, os, urllib.request, json

# 1. Find remaining triple-nested i18n in JS files
js_dir = r'C:\Users\ASUS\.openclaw\workspace\prompt-tool-dev\frontend\static\js'
total_residues = 0
for fname in sorted(os.listdir(js_dir)):
    if not fname.endswith('.js'):
        continue
    fpath = os.path.join(js_dir, fname)
    content = open(fpath, encoding='utf-8').read()
    matches = list(re.finditer(r'_t\([^,]+,.+_t\([^,]+,.+_t\(', content))
    if matches:
        total_residues += len(matches)
        print(f'  {fname}: {len(matches)} residues')
        for m in matches[:2]:
            ctx = content[m.start():m.end()+60]
            safe = ''.join(c if 32 <= ord(c) < 128 else '?' for c in ctx)
            print(f'    {safe}')
print(f'Total i18n residues: {total_residues}')

# 2. Test health
print('\n=== Health ===')
try:
    r = urllib.request.urlopen('http://127.0.0.1:8080/api/health/check', timeout=10)
    d = json.loads(r.read())
    print('  ok=%s, checks=%s/%s' % (d.get('ok'), d.get('checked'), d.get('total_checks')))
except Exception as e:
    print('  Error: %s' % e)

# 3. Test projects
print('\n=== Projects ===')
try:
    r = urllib.request.urlopen('http://127.0.0.1:8080/api/seedance/v2/projects', timeout=10)
    d = json.loads(r.read())
    projs = d.get('projects', [])
    print('  Count: %d' % len(projs))
    if projs:
        print('  First: id=%s, name=%s' % (projs[0].get('id'), projs[0].get('name', '?')[:30]))
except Exception as e:
    print('  Error: %s' % e)

# 4. Test v2 compose
print('\n=== v2 Compose ===')
try:
    r = urllib.request.urlopen('http://127.0.0.1:8080/api/seedance/v2/projects', timeout=10)
    d = json.loads(r.read())
    projs = d.get('projects', [])
    if projs:
        pid = projs[0]['id']
        data = json.dumps({'format': 'minimax', 'density': 'detailed'}).encode()
        req = urllib.request.Request(
            'http://127.0.0.1:8080/api/seedance/v2/projects/%d/compose' % pid,
            data=data, headers={'Content-Type': 'application/json'}, method='POST')
        r = urllib.request.urlopen(req, timeout=10)
        d = json.loads(r.read())
        print('  shots=%s, fmt=%s, density=%s, len=%s' % (
            d.get('shot_count'), d.get('format'), d.get('density'), d.get('length')))
    else:
        print('  SKIP - no projects')
except Exception as e:
    import traceback
    traceback.print_exc()
    print('  Error: %s' % e)
