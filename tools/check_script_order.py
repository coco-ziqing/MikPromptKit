import re

f = r'C:\Users\ASUS\.openclaw\workspace\prompt-tool-dev\frontend\index.html'
lines = open(f, encoding='utf-8').readlines()
scripts = []
for i, line in enumerate(lines, 1):
    m = re.search(r"src=['\"]([^'\"]*\.js[^'\"]*)['\"]", line)
    if m:
        scripts.append((i, m.group(1)))

print("=== Script Load Order ===")
for line_no, src in scripts:
    short = src.split('/')[-1] if '/' in src else src
    print(f"  L{line_no:4d}: {short}")

# Find key positions
key_files = ['app_core.js', 'app_i18n.js', 'seedance_v2_composer.js', 'wc_bridge.js']
for kf in key_files:
    found = [(ln, s) for ln, s in scripts if kf in s]
    if found:
        print(f"\n  [KEY] {kf}: line {found[0][0]}")
    else:
        print(f"\n  [KEY] {kf}: NOT FOUND")
