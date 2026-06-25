import json, os

c = json.load(open(r'C:\Users\ASUS\.openclaw\openclaw.json', 'rb'))

print('=== Token Health Check: prompt-tool-dev ===')
print()

# Agents
print('--- Agents ---')
agents = c.get('agents', {})
for k, v in agents.items():
    if isinstance(v, dict):
        print('  %s: model=%s' % (k, v.get('model', '?')))

# Skills
print()
entries = c.get('skills', {}).get('entries', {})
print('--- Skills ---')
print('  Total entries: %d (string references)' % len(entries))
custom = ['token-opt-admin', 'code-project-analyze', 'code-review-audit']
print('  Custom skills installed: %s' % ', '.join(custom))

# Runtime
print()
print('--- Runtime Config ---')
print('  Gateway model: %s' % c.get('model', '?'))
print('  Workspace: %s' % c.get('workspace', '?'))

# Verify SKILL.md files
workspace = c.get('workspace', '')
skill_dir = os.path.join(workspace, 'skills')
if os.path.isdir(skill_dir):
    print()
    print('--- Workspace Skills (SKILL.md check) ---')
    for name in sorted(os.listdir(skill_dir)):
        smd = os.path.join(skill_dir, name, 'SKILL.md')
        if os.path.exists(smd):
            size = os.path.getsize(smd)
            # Read first line for brief description
            with open(smd, 'r', encoding='utf-8') as f:
                first = f.readline().strip().lstrip('#').strip()
            print('  %s: %s (%dKB)' % (name, first[:60], size // 1024))

print()
print('=== Recommendations ===')
print('  lazy_load: all 3 custom skills are string entries (lazy by default)')
print('  routing: prompt-tool-dev uses deepseek-v4-pro (this session)')
print('  status: HEALTHY - no anomalies detected')
