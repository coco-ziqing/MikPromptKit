"""组装器词卡入口全面验证（父分组递归修复回归）"""
import io
import json
import sys
import urllib.request

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
BASE = 'http://127.0.0.1:8080'
PASS=[];FAIL=[]
def ck(n, ok): (PASS if ok else FAIL).append(n)
def get(p):
    return json.loads(urllib.request.urlopen(BASE+p, timeout=15).read())

# 1. 词库根分组递归（上一轮修复）
d = get('/api/v4/word-cards?group_id=94&page_size=5')
ck('char_root 递归=110', d.get('total') == 110)
d = get('/api/v4/word-cards?group_id=109&page_size=5')
ck('scene_root 递归=102', d.get('total') == 102)
d = get('/api/v4/word-cards?group_id=96&page_size=5')
ck('叶子组不受影响=8', d.get('total') == 8)

# 2. /groups 端点父分组 card_count 递归（本轮修复）
d = get('/api/v4/word-cards/groups')
gk = {g['group_key']: g for g in d.get('groups', [])}
ck('/groups 含char_root', 'char_root' in gk)
ck('char_root card_count=110', gk.get('char_root', {}).get('card_count') == 110)
ck('/groups 含scene_root', 'scene_root' in gk)
ck('scene_root card_count=102', gk.get('scene_root', {}).get('card_count') == 102)

# 3. /groups/tree（词库侧边栏，返回键为 tree）
d = get('/api/v4/word-cards/groups/tree')
def find(nodes, key):
    for n in nodes:
        if n.get('group_key') == key: return n
        r = find(n.get('children', []), key)
        if r: return r
    return None
tree_nodes = d.get('tree', d.get('groups', []))
cr = find(tree_nodes, 'char_root')
sr = find(tree_nodes, 'scene_root')
ck('tree含char_root且有14子组', cr is not None and len(cr.get('children', [])) == 14)
ck('tree含scene_root且有13子组', sr is not None and len(sr.get('children', [])) == 13)
kids_total = sum(k.get('card_count', 0) for k in (cr.get('children', []) if cr else []))
ck('tree char子组卡片合计=110', kids_total == 110)

# 4. 角色组装器维度（每维度分组都有卡片）
d = get('/api/character-composer/dimensions')
dims = d.get('dimensions', [])
empty_dims = [dd['key'] for dd in dims if not dd.get('groups')]
ck(f'角色组装器 {len(dims)}维度全绑定分组', len(empty_dims) == 0)
all_have = True
for dd in dims:
    for g in dd.get('groups', []):
        c = get(f"/api/v4/word-cards?group_id={g['id']}&page_size=1")
        if c.get('total', 0) == 0: all_have = False; print(f"  空分组: {dd['key']} -> {g['name']}")
ck('角色组装器所有维度分组有卡片', all_have)

# 5. 场景组装器维度
d = get('/api/scene-composer/dimensions')
dims = d.get('dimensions', [])
empty_dims = [dd['key'] for dd in dims if not dd.get('groups')]
ck(f'场景组装器 {len(dims)}维度全绑定分组', len(empty_dims) == 0)
all_have = True
for dd in dims:
    for g in dd.get('groups', []):
        c = get(f"/api/v4/word-cards?group_id={g['id']}&page_size=1")
        if c.get('total', 0) == 0: all_have = False; print(f"  空分组: {dd['key']} -> {g['name']}")
ck('场景组装器所有维度分组有卡片', all_have)

# 6. 分镜组装器词库
d = get('/api/seedance/v2/libraries')
libs = d.get('libraries', [])
empty = [item.get('name') for item in libs if not item.get('card_count', len(item.get('cards', []) or []))]
ck(f'分镜组装器 {len(libs)}词库全有卡片', len(empty) == 0)

# 7. word_picker（全局词卡选取器）
d = get('/api/v4/word-cards/picker?group_type=all')
keys = [g.get('key','') for g in d.get('groups', [])]
ck('picker含14个char_*组', len([k for k in keys if k.startswith('char_')]) == 14)
ck('picker含13个scene_*组', len([k for k in keys if k.startswith('scene_')]) == 13)
# picker 各组有卡
pick_empty = [g['name'] for g in d.get('groups', []) if not g.get('cards')]
ck('picker所有组有卡片', len(pick_empty) == 0)

# 8. composer_wc_bridge 用的 /groups（同2）+ /word-cards?group_id（同1）已覆盖

print()
for p in PASS: print("PASS", p)
for f in FAIL: print("FAIL", f)
print(f"\n{len(PASS)}/{len(PASS)+len(FAIL)} 通过")
sys.exit(0 if not FAIL else 1)
