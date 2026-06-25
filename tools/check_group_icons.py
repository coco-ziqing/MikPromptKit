import urllib.request, json

r = urllib.request.urlopen('http://127.0.0.1:8080/api/v4/word-cards/groups/tree', timeout=10)
d = json.loads(r.read())

def show_tree(nodes, depth=0):
    for n in nodes:
        icon = n.get('icon', 'N/A')
        name = n.get('name', '?')
        gtype = n.get('group_type', '?')
        gid = n.get('id', '?')
        indent = '  ' * depth
        print('%s[%s] icon=%s name=%s id=%s' % (indent, gtype, repr(icon), name[:30], gid))
        if n.get('children'):
            show_tree(n['children'], depth+1)

print('=== Group Tree Icons ===')
show_tree(d.get('tree', []))
