import urllib.request, json

def test(name, fn):
    try:
        fn()
    except Exception as e:
        print(f'  {name}: FAIL ({e})')

BASE = 'http://127.0.0.1:8080'

print('=== Phase 14.1 Regression Tests ===')

# Test 1: Health
def t1():
    r = urllib.request.urlopen(f'{BASE}/api/health/check', timeout=5)
    d = json.loads(r.read())
    ok = d.get('total_checks',0) >= 9
    print(f'  Health: {"PASS" if ok else "FAIL"} ({d.get("checked")}/{d.get("total_checks")} checks)')
test('Health', t1)

# Test 2: v2 compose (shared engine)
def t2():
    r = urllib.request.urlopen(f'{BASE}/api/seedance/v2/projects', timeout=5)
    projects = json.loads(r.read()).get('projects', [])
    if not projects:
        print('  v2 compose: SKIP (no projects)')
        return
    pid = projects[0]['id']
    data = json.dumps({'format': 'minimax', 'density': 'detailed'}).encode()
    req = urllib.request.Request(f'{BASE}/api/seedance/v2/projects/{pid}/compose',
                                 data=data, headers={'Content-Type': 'application/json'}, method='POST')
    r = urllib.request.urlopen(req, timeout=5)
    d = json.loads(r.read())
    ok = d.get('text') is not None and d.get('shot_count') is not None
    print(f'  v2 compose: {"PASS" if ok else "FAIL"} (shots={d.get("shot_count")}, fmt={d.get("format")}, density={d.get("density")})')
test('v2 compose', t2)

# Test 3: v3 cards
def t3():
    r = urllib.request.urlopen(f'{BASE}/api/v4/composer/cards-available?page_size=5', timeout=5)
    d = json.loads(r.read())
    ok = d.get('ok') and d.get('items') is not None
    print(f'  v3 cards: {"PASS" if ok else "FAIL"} ({d.get("total",0)} cards)')
test('v3 cards', t3)

# Test 4: v3 compose with format/density
def t4():
    r = urllib.request.urlopen(f'{BASE}/api/seedance/v2/projects', timeout=5)
    projects = json.loads(r.read()).get('projects', [])
    if not projects:
        print('  v3 compose: SKIP (no projects)')
        return
    pid = projects[0]['id']
    url = f'{BASE}/api/v4/composer/projects/{pid}/compose?format=kling&density=detailed'
    r = urllib.request.urlopen(url, timeout=5)
    d = json.loads(r.read())
    ok = d.get('ok') and d.get('output') is not None
    print(f'  v3 compose: {"PASS" if ok else "FAIL"} (fmt={d.get("format")}, density={d.get("density")}, len={d.get("length")})')
test('v3 compose', t4)

# Test 5: i18n flat test (frontend loads without errors)
def t5():
    r = urllib.request.urlopen(f'{BASE}/static/js/seedance_v2_composer.js', timeout=5)
    content = r.read().decode('utf-8')
    # Check no triple-nested _t remains
    import re
    triple = re.findall(r'_t\([^,]+,.+_t\([^,]+,.+_t\(', content)
    count = len(triple)
    ok = count == 0
    print(f'  i18n flat: {"PASS" if ok else "FAIL"} ({count} triple-nested remaining)')
test('i18n flat', t5)

# Test 6: v3-card CSS exists
def t6():
    r = urllib.request.urlopen(f'{BASE}/static/css/style.css', timeout=5)
    content = r.read().decode('utf-8')
    ok = '.v3-card' in content and '.v3-selected' in content
    print(f'  v3 CSS: {"PASS" if ok else "FAIL"}')
test('v3 CSS', t6)

print('\n=== All regression tests completed ===')
