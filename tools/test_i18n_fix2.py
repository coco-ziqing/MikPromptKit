import sys
sys.path.insert(0, r'C:\Users\ASUS\.openclaw\workspace\prompt-tool-dev\tools')
from fix_nested_i18n import fix_nested_i18n_v3

# Test with App._t prefix (real code pattern)
inp = "App._t('auto.str_4abc8a41',App._t('auto.str_4abc8a41',App._t('auto.str_4abc8a41','运镜')))"
result, count = fix_nested_i18n_v3(inp)
print(f'IN:  {inp}')
print(f'OUT: {result}')
print(f'Changes: {count}')
print(f'Expected: 1 change (inner collapse only, App._t prefix different)')

# Test actual line from seedance_v2_composer.js
inp2 = """_F:{'camera_move':App._t('auto.str_4abc8a41',App._t('auto.str_4abc8a41',App._t('auto.str_4abc8a41','运镜'))),'subject':'主体'}"""
result2, count2 = fix_nested_i18n_v3(inp2)
print(f'\nIN2: {inp2[:120]}')
print(f'OUT2: {result2[:120]}')
print(f'Changes: {count2}')
