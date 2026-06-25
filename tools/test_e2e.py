import urllib.request, json

BASE = 'http://127.0.0.1:8080'

def api(method, path, body=None):
    data = json.dumps(body).encode() if body else None
    req = urllib.request.Request(BASE + path, data=data,
        headers={'Content-Type': 'application/json'}, method=method)
    r = urllib.request.urlopen(req, timeout=10)
    return json.loads(r.read())

print('=== Phase14.1 E2E Test ===')

# Step 1: Create project
print('1. Creating project...')
resp = api('POST', '/api/seedance/v2/projects', {
    'name': 'Phase14.1 E2E Test',
    'total_duration': 12,
    'aspect_ratio': '16:9',
    'resolution': '4K',
    'global_style': 'cinematic lighting',
})
pid = resp['id']
print('   OK: id=%d' % pid)

# Step 2: Add scene
print('2. Adding scene...')
resp2 = api('POST', '/api/seedance/v2/projects/%d/scenes' % pid, {
    'subject': 'a lone wanderer',
    'camera_move': 'slow push-in',
    'scene_desc': 'misty forest at dawn',
    'composition': 'rule of thirds',
    'lighting': 'golden hour',
    'emotion': 'melancholic',
    'action': 'walking through fog',
})
sid = resp2['id']
print('   OK: scene id=%d' % sid)

# Step 3: Compose all 5 formats x 3 densities
print('3. Compose formats...')
FORMATS = [
    ('seedance', 'compact'),
    ('kling', 'standard'),
    ('minimax', 'detailed'),
    ('comfyui', 'compact'),
    ('raw', 'standard'),
]
all_ok = True
for fmt, density in FORMATS:
    resp = api('POST', '/api/seedance/v2/projects/%d/compose' % pid, {
        'format': fmt, 'density': density,
    })
    ok = resp.get('text') is not None and len(resp.get('text', '')) > 0
    status = 'OK' if ok else 'FAIL'
    if not ok:
        all_ok = False
    print('   %s/%s: %s (len=%d, shots=%d)' % (
        fmt, density, status, resp.get('length', 0), resp.get('shot_count', 0)))

# Step 4: v3 compose
print('4. v3 compose...')
url = '%s/api/v4/composer/projects/%d/compose?format=kling&density=detailed' % (BASE, pid)
r = urllib.request.urlopen(url, timeout=10)
d = json.loads(r.read())
ok = d.get('ok') and d.get('output') is not None
print('   %s (fmt=%s, density=%s, len=%d)' % (
    'OK' if ok else 'FAIL', d.get('format'), d.get('density'), d.get('length', 0)))
if not ok:
    all_ok = False

# Step 5: Lock test
print('5. Lock + recalculate...')
resp3 = api('POST', '/api/seedance/v2/projects/%d/scenes' % pid, {
    'subject': 'ancient ruins',
    'camera_move': 'aerial drone shot',
    'scene_desc': 'overgrown temple',
})
sid2 = resp3['id']
api('PUT', '/api/seedance/v2/projects/%d/scenes/%d/lock' % (pid, sid), {'locked': True})
resp = api('POST', '/api/seedance/v2/projects/%d/compose' % pid, {
    'format': 'seedance', 'density': 'standard',
})
print('   shots=%d, text=[%s...]' % (resp.get('shot_count'), resp.get('text', '')[:80].replace('\n', ' | ')))

# Cleanup
print('6. Cleanup...')
api('DELETE', '/api/seedance/v2/projects/%d' % pid)
print('   Deleted.')

if all_ok:
    print('\n=== ALL E2E TESTS PASSED ===')
else:
    print('\n=== SOME TESTS FAILED ===')
