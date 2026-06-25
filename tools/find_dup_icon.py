import re, os

f = r'C:\Users\ASUS\.openclaw\workspace\prompt-tool-dev\frontend\static\js\wc_bridge.js'
lines = open(f, encoding='utf-8').readlines()

print('=== Tree icon related lines ===')
for i, line in enumerate(lines, 1):
    line_s = line.rstrip()
    # Match tree-node, icon, arrow patterns
    matches = any(k in line_s for k in ['tree-node', 'tree-arrow', 'tree-icon', 'treeIcon',
                                         'iconSpan', 'iconHTML', 'groupIcon', 'nodeIcon',
                                         'fas fa', 'chevron', 'arrow', '.icon',
                                         'renderTreeNode', 'renderSidebar', 'renderTree'])
    if matches:
        # Only show ASCII-safe parts
        safe = ''.join(c if 32 <= ord(c) < 127 or c in '\t\n\r' else '?' for c in line_s)
        if 'tree' in safe.lower() or 'icon' in safe.lower() or 'arrow' in safe.lower() or 'chevron' in safe.lower():
            print('L%5d: %s' % (i, safe[:160]))

print('\n=== Looking for duplicate icon pattern ===')
# Find all lines with icon declarations
for i, line in enumerate(lines, 1):
    ls = line.rstrip()
    if 'icon' in ls.lower() and ('fas' in ls or 'fa-' in ls or 'emoji' in ls or '<i' in ls.lower()):
        safe = ''.join(c if 32 <= ord(c) < 127 or c in '\t\n\r' else '?' for c in ls)
        if 100 < i < 700:  # sidebar/tree section
            print('L%5d: %s' % (i, safe[:160]))
