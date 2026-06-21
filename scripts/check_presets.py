import re
c = open('backend/api/playground.py', encoding='utf8').read()
before = c.split('OPTIMIZATION_DIRECTIONS')[0]
# Count model presets by finding "key": { pattern in MODEL_PRESETS section
mp_section = before.split('MODEL_PRESETS')[1] if 'MODEL_PRESETS' in before else before
keys = re.findall(r'"([a-z0-9_]+)":\s*\{', mp_section)
direction_keys = {'convert','enhance','compress','negative','analyze','translate','style_transfer','variants'}
model_keys = [k for k in keys if k not in direction_keys]
print(f'Model presets: {len(model_keys)}')
for k in model_keys:
    print(f'  {k}')
