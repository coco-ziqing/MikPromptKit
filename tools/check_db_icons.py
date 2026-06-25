import sqlite3, json, sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

db = sqlite3.connect(r'C:\Users\ASUS\.openclaw\workspace\prompt-tool-dev\data\prompts.db')
db.row_factory = sqlite3.Row

# All groups with their types and icons  
print('=== ALL GROUPS ===')
rows = db.execute('SELECT id, name, group_type, icon, parent_group_id FROM word_card_group ORDER BY id').fetchall()
for r in rows:
    icon = r['icon'] if r['icon'] else '(null)'
    gtype = r['group_type'] if r['group_type'] else '(null)'
    pid = r['parent_group_id'] if r['parent_group_id'] else '(null)'
    name = (r['name'] or '')[0:30]
    print('  id=%s type=%s icon=%s pid=%s  name=%s' % (r['id'], gtype, icon, pid, name))

# Focus on root/sub groups (id 54-62 based on parent_group_id values)
print('\n=== GROUPS with parent_group_id in 54-62 (likely root/sub) ===')
roots = db.execute('SELECT * FROM word_card_group WHERE id BETWEEN 53 AND 63').fetchall()
for r in roots:
    print('  id=%s type=%s icon=[%s] name=%s parent=%s' % (
        r['id'], r['group_type'], r['icon'] or 'NULL', (r['name'] or '')[:30], r['parent_group_id'] or '-'
    ))

# Check the API response
print('\n=== API /api/v4/word-cards/groups/tree ===')
import urllib.request
try:
    r = urllib.request.urlopen('http://127.0.0.1:8080/api/v4/word-cards/groups/tree', timeout=10)
    data = json.loads(r.read())
    tree = data.get('tree', [])
    for root in tree:
        print('ROOT: id=%s name=%s icon=%s type=%s' % (
            root.get('id'), root.get('name','')[:20], repr(root.get('icon','?')), root.get('group_type','?')
        ))
        for child in root.get('children', []):
            print('  SUB: id=%s name=%s icon=%s type=%s' % (
                child.get('id'), child.get('name','')[:20], repr(child.get('icon','?')), child.get('group_type','?')
            ))
            for leaf in child.get('children', [])[:2]:
                print('    LEAF: id=%s name=%s icon=%s type=%s' % (
                    leaf.get('id'), leaf.get('name','')[:20], repr(leaf.get('icon','?')), leaf.get('group_type','?')
                ))
except Exception as e:
    print('  API error: %s' % e)
