import urllib.request, json

req = urllib.request.Request('http://127.0.0.1:8080/api/v4/word-cards/groups?include_empty=true')
resp = json.load(urllib.request.urlopen(req))
print('Total:', resp.get('total'))
for g in resp.get('groups', []):
    ct = g.get('card_count', 0)
    print(f'  [{g["group_type"]:8s}] key={g["group_key"]:30s} name={g["name"]:12s} cards={ct}')
