import sys
sys.path.insert(0, r'C:\Users\ASUS\.openclaw\workspace\prompt-tool-dev\tools')
from fix_nested_i18n import fix_nested_i18n

tests = [
    # Basic collapse
    ('_t("k", _t("k", "v"))', 1, '_t("k", "v")'),
    # Triple collapse (should take 2 passes)
    ('_t("k", _t("k", _t("k", "v")))', 2, '_t("k", "v")'),
    # App._t prefix - SAME KEY
    ('App._t("k", App._t("k", "v"))', 1, 'App._t("k", "v")'),
    # App._t outer, bare _t inner - SAME KEY
    ('App._t("k", _t("k", "v"))', 1, 'App._t("k", "v")'),
    # Different keys - no change
    ('_t("a", _t("b", "c"))', 0, None),
    # Single quotes
    ("_t('k', _t('k', 'v'))", 1, "_t('k', 'v')"),
]

print("=== Unit Tests ===")
all_ok = True
for inp, exp_count, exp_result in tests:
    result, count = fix_nested_i18n(inp)
    ok = True
    if exp_result is not None and result.strip() != exp_result:
        ok = False
    if count != exp_count:
        ok = False
    status = 'OK' if ok else 'FAIL'
    if not ok:
        all_ok = False
        print(f'{status}: IN={inp[:80]}')
        print(f'       OUT={result.strip()[:80]}')
        print(f'       count={count} (expected {exp_count})')
    else:
        print(f'{status}: {inp[:60]}...')
print(f'=== {"ALL PASSED" if all_ok else "SOME FAILED"} ===')

# Test with real App._t code from seedance_v2_composer.js
print('\n=== Real Code Test ===')
real = "App._t('auto.str_4abc8a41',App._t('auto.str_4abc8a41',App._t('auto.str_4abc8a41','\u8fd0\u955c')))"
result, count = fix_nested_i18n(real)
print(f'IN:  {real}')
print(f'OUT: {result}')
print(f'Changes: {count}')
print(f'Expected result: App._t(\'auto.str_4abc8a41\', \'\u8fd0\u955c\')')
