#!/usr/bin/env python3
"""
i18n clean fix — pure Python, rb→decode→replace→wb, NO edit tool involvement.
Handles the tricky inline App._t() inside string-concatenation scenarios.
"""
import re, sys, os, subprocess

sys.stdout.reconfigure(encoding='utf-8')
JS_DIR = r'C:\Users\ASUS\.openclaw\workspace\prompt-tool-dev\frontend\static\js'

def safe_read(path):
    with open(path, 'rb') as f:
        return f.read().decode('utf-8')

def safe_write(path, text):
    with open(path, 'wb') as f:
        f.write(text.encode('utf-8'))

def check_syntax(name):
    """Run node --check, return (ok, error_msg)"""
    path = os.path.join(JS_DIR, name)
    res = subprocess.run(['node', '--check', path], capture_output=True, text=True)
    if res.returncode == 0:
        return True, ""
    return False, res.stderr.strip().split('\n')[-3] if res.stderr else str(res)

# ============================================================
# word_card_manager.js — fix inline onclick
# ============================================================
wcm_path = os.path.join(JS_DIR, 'word_card_manager.js')
wcm = safe_read(wcm_path)

# Strategy: change from inline '已复制' to data-copied attribute
# Original: ...onclick="App.copyText(this.dataset.cardContent,\'已复制\')"...
# New:      ...data-copied="已复制" onclick="App.copyText(this.dataset.cardContent,this.dataset.copied)"...
# The data attr is statically rendered (no App._t needed for fallback case)
# For the i18n, it just works because the onclick reads the pre-rendered text

# Find the onclick line
old_onclick = ",'\\\\'' + '已复制' + '\\\\')"
new_onclick = ",'\\\\'+App._t('common.copied','已复制')+'\\\\')"

if old_onclick in wcm:
    wcm = wcm.replace(old_onclick, new_onclick)
    print('wcm: fixed onclick pattern')

# Also replace standalone '已复制' used elsewhere
replacements_wcm = [
    ("'暂无词卡'", "App._t('wordcard.empty','暂无词卡')"),
    ("'移动到功能模块'", "App._t('wordcard.move','移动到功能模块')"),
    ("'编辑词卡'", "App._t('wordcard.edit','编辑词卡')"),
    ("'加载失败: '", "App._t('common.load_failed','加载失败: ') + "),
]

for old, new in replacements_wcm:
    if old in wcm:
        wcm = wcm.replace(old, new)
        print(f'wcm: replaced {repr(old)}')

safe_write(wcm_path, wcm)
ok, err = check_syntax('word_card_manager.js')
print(f'wcm syntax: {"OK" if ok else "FAIL: "+err}')

# ============================================================
# wc_bridge.js — fix inline title= attributes
# ============================================================
wcb_path = os.path.join(JS_DIR, 'wc_bridge.js')
wcb = safe_read(wcb_path)

# This file has title=App._t('key','中文') in innerHTML strings
# These need to be title="'+App._t('key','中文')+'"
# This pattern appears as:  title=App._t('xxx','yyy')  inside a JS string

# Fix all occurrences: title=App._t('...','...') → title="'+App._t('...','...')+'"
def fix_title_app_t(text):
    """Fix title=App._t() inside JS string concatenation"""
    # Pattern: title=App._t('k','v') followed by space or >
    return re.sub(
        r"title=App\._t\('([^']+)','([^']+)'\)",
        r"title=\"'+App._t('\1','\2')+'\"",
        text
    )

wcb = fix_title_app_t(wcb)

# Also check for common patterns that cause issues
if 'title=App._t(' in wcb:
    print('WARNING: some title=App._t patterns remain')
    # Find remaining
    for m in re.finditer(r'title=App\._t\(', wcb):
        ctx = wcb[m.start():m.start()+80]
        print(f'  at offset {m.start()}: {ctx[:80]}')

# Apply simple replacements
replacements_wcb = [
    ("'删除分组'", "App._t('group.delete','删除分组')"),
    ("'编辑分组'", "App._t('group.edit','编辑分组')"),
    ("'删除'", "App._t('common.delete','删除')"),
    ("'移动到分组'", "App._t('group.move_to','移动到分组')"),
]

for old, new in replacements_wcb:
    if old in wcb:
        wcb = wcb.replace(old, new)
        print(f'wcb: replaced {repr(old)}')

safe_write(wcb_path, wcb)
ok, err = check_syntax('wc_bridge.js')
print(f'wcb syntax: {"OK" if ok else "FAIL: "+err}')

# ============================================================
# Final check: all JS files
# ============================================================
print('\n=== Full syntax check ===')
all_ok = True
for fname in os.listdir(JS_DIR):
    if not fname.endswith('.js') or fname == 'app_i18n.js':
        continue
    ok, err = check_syntax(fname)
    if not ok:
        print(f'  FAIL: {fname}')
        print(f'    {err[:200]}')
        all_ok = False

if all_ok:
    print('  ALL FILES PASS ✓')
else:
    print(f'\n  {sum(1 for _ in ...)} errors to fix')

print('\nDONE')
