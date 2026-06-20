import urllib.request, json, urllib.error

# Create a new group
data = json.dumps({'name':'侧栏测试','group_key':'custom_sidebar_test','icon':'f','description':'test'}).encode()
req = urllib.request.Request('http://127.0.0.1:8080/api/v4/word-cards/groups', data=data, headers={'Content-Type':'application/json'}, method='POST')
try:
    resp = json.load(urllib.request.urlopen(req))
    print('CREATE:', json.dumps(resp, ensure_ascii=False))
except urllib.error.HTTPError as e:
    print('ERR:', e.code, e.read().decode())

# Now reload groups as loadModules would
req2 = urllib.request.Request('http://127.0.0.1:8080/api/v4/word-cards/groups?include_empty=true')
resp2 = json.load(urllib.request.urlopen(req2))
# Simulate what wc_bridge does: filter for builtin/custom
for g in resp2.get('groups', []):
    gt = g['group_type']
    if gt in ('builtin','custom'):
        gk = g['group_key']
        gn = g['name']
        gc = g['card_count']
        print('SIDEBAR: [%s] key=%s name=%s cnt=%d' % (gt, gk, gn, gc))
