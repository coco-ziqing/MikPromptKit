#!/usr/bin/env python3
"""i18n final fix — binary-safe, single-pass, no edit tool involvement"""
import re, sys, os

sys.stdout.reconfigure(encoding='utf-8')
JS_DIR = r'C:\Users\ASUS\.openclaw\workspace\prompt-tool-dev\frontend\static\js'

def safe_read(path):
    with open(path, 'rb') as f:
        return f.read().decode('utf-8')

def safe_write(path, text):
    with open(path, 'wb') as f:
        f.write(text.encode('utf-8'))

# ============================================================
# File 1: word_card_manager.js
# ============================================================
wcm_path = os.path.join(JS_DIR, 'word_card_manager.js')
wcm = safe_read(wcm_path)
wcm_orig = wcm

# Fix: hardcoded Chinese strings → App._t() calls
wcm_replacements = [
    ("'已复制'", "App._t('common.copied','已复制')"),
    ("'暂无词卡'", "App._t('wordcard.empty','暂无词卡')"),
    ("'加载失败: '", "App._t('common.load_failed','加载失败: ') + "),
    # Already has +, so:  '加载失败: '+e.message → App._t('common.load_failed','加载失败: ')+e.message
    ("\"title='移动到功能模块'", '"title=\'' + App._t("wordcard.move","移动到功能模块") + '\'"'),
    ("\"title='编辑词卡'", '"title=\'' + App._t("wordcard.edit","编辑词卡") + '\'"'),
    ("'移动到功能模块'", "App._t('wordcard.move','移动到功能模块')"),
    ("'编辑词卡'", "App._t('wordcard.edit','编辑词卡')"),
]

# For the onclick issue, use a different strategy:
# Change from:   onclick="App.copyText(this.dataset.cardContent,'已复制')"
# To use data attribute so no inline App._t needed:
# We'll add data-fb='已复制' and use this.dataset.fb

# Find the onclick line
for i, line in enumerate(wcm.split('\n')):
    if "'已复制'" in line and 'cardContent' in line:
        # Replace: ,'已复制') → ,'已复制'.replace(...) → simpler: use a temp var approach
        # Actually just use an escaped string properly
        old_part = ",'已复制')"
        new_part = ",App._t('common.copied','已复制'))"
        if old_part in line:
            # This is inside a string concat in JS, need to break out of string, insert App._t, and go back
            # Pattern: onclick="App.copyText(this.dataset.cardContent,'已复制')"
            # Need:    onclick="App.copyText(this.dataset.cardContent,'+App._t('common.copied','已复制')+')"
            # But this makes the onclick attr dynamically built via JS concat
            # The current line is already JS string concat:
            # + '<div ... onclick="App.copyText(this.dataset.cardContent,\'' + App._t(...) + '\')" ...>'
            
            # Let me look at the actual raw bytes
            idx = line.find(",'已复制')")
            if idx >= 0:
                context = line[max(0,idx-30):idx+30]
                print(f'  Context: ...{context}...')
                # Breaking out of JS string:  \','已复制')\"   →  \',\'+App._t(\'common.copied\',\'已复制\')+\')\" 
                old_exact = ",'已复制')\" onclick="
                new_exact = ",'+App._t('common.copied','已复制')+')\" onclick="
                if old_exact in line:
                    wcm = wcm.replace(old_exact, new_exact)
                    print(f'  FIXED onclick at line {i+1}')
                    break

# Apply all simple replacements
for old, new in wcm_replacements:
    if old in wcm:
        wcm = wcm.replace(old, new)
        print(f'wcm: replaced {repr(old)}')

if wcm != wcm_orig:
    safe_write(wcm_path, wcm)
    print(f'word_card_manager.js: SAVED {len(wcm)} chars')
else:
    print(f'word_card_manager.js: no changes')

# ============================================================
# File 2: wc_bridge.js  
# ============================================================
wcb_path = os.path.join(JS_DIR, 'wc_bridge.js')
wcb = safe_read(wcb_path)
wcb_orig = wcb

wcb_replacements = [
    # For inline attributes with App._t, use data-attr pattern or concat
]

# Find and fix title= attributes in innerHTML strings
lines = wcb.split('\n')
modified = False

for i, line in enumerate(lines):
    # Fix: title=App._t(...)  →  title="'+App._t(...)+'"
    if 'title=App._t(' in line:
        # This is the exact broken pattern from the previous edit
        m = re.search(r'title=App\._t\(', line)
        if m:
            old = line
            # Replace title=App._t('key','val') with title="'+App._t('key','val')+'"
            line = re.sub(
                r"title=App\._t\('([^']+)','([^']+)'\)",
                r"title=\"'+App._t('\1','\2')+'\"",
                line
            )
            if line != old:
                lines[i] = line
                modified = True
                print(f'wcb L{i+1}: fixed title=App._t')

    # Fix similar patterns for onclick contexts
    if 'onclick=' in line and 'App._t(' in line and "title=" not in line:
        m = re.search(r"onclick=\"([^\"]*App\._t\([^)]+\)[^\"]*)\"", line)
        if m:
            old_attr = m.group(1)
            # If App._t is inside onclick="..." we need to break it out
            # This is complex - skip for now if not present

if modified:
    wcb = '\n'.join(lines)
    safe_write(wcb_path, wcb)
    print(f'wc_bridge.js: SAVED')

# ============================================================
# Final verification
# ============================================================
import subprocess
for fname in ['word_card_manager.js', 'wc_bridge.js']:
    path = os.path.join(JS_DIR, fname)
    res = subprocess.run(['node', '--check', path], capture_output=True, text=True)
    if res.returncode == 0:
        print(f'✓ {fname}: SYNTAX OK')
    else:
        # Only show first error line
        err = res.stderr.strip().split('\n')[0] if res.stderr else str(res)
        print(f'✗ {fname}: {err[:200]}')

print('\nDONE')
