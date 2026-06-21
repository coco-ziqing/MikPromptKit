"""
Phase14.1 里程碑备份
WAL checkpoint + DB备份 + 快照清单
"""
import sqlite3, shutil, os, json, subprocess
from datetime import datetime

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# 1. WAL checkpoint
db = sqlite3.connect(os.path.join(ROOT, 'data', 'prompts.db'))
db.execute('PRAGMA wal_checkpoint(TRUNCATE)')
db.close()
print('[OK] WAL checkpoint — 写入主文件')

# 2. 数据库备份
ts = datetime.now().strftime('%Y%m%d_%H%M%S')
backup_dir = os.path.join(ROOT, 'data', 'backups')
os.makedirs(backup_dir, exist_ok=True)
backup_path = os.path.join(backup_dir, f'phase14.1_{ts}.db')
shutil.copy2(os.path.join(ROOT, 'data', 'prompts.db'), backup_path)
size_mb = os.path.getsize(backup_path) / 1024 / 1024
print(f'[OK] DB备份: {backup_path} ({size_mb:.1f} MB)')

# 3. Git commit hash
hash_short = subprocess.check_output(
    ['git', 'rev-parse', '--short', 'HEAD'],
    cwd=ROOT, text=True
).strip()

# 4. 快照清单
snapshot = {
    'milestone': 'v4.2.1-phase14.1-complete',
    'date': datetime.now().isoformat(),
    'tag': 'v4.2.1-phase14.1-sidebar-fix',
    'git_commit': hash_short,
    'summary': 'Phase14分类架构重构完成 + 7层侧边栏bug链修复',
    'versions': {
        'wc_bridge.js': 'v9.6 (树形侧边栏+陈列架+try-catch)',
        'app_core.js': 'v12.4 (var App+命名函数空安全桩)',
        'signal_lights.js': 'v5 (延迟初始化)',
        'style.css': 'v12.0 (showcase-card/tree-node/tree-arrow)',
        'index.html': 'wc_bridge 置顶第1行加载'
    },
    'tables': {},
    'stats': {}
}

# 统计
cur = sqlite3.connect(os.path.join(ROOT, 'data', 'prompts.db')).cursor()
for table in ['word_cards', 'word_card_groups', 'v4_cards', 'library_assets',
              'collections', 'wordpacks', 'prompts', 'characters',
              'seedance_templates', 'seedance_scenes', 'seedance_projects']:
    try:
        cur.execute(f"SELECT COUNT(*) FROM {table}")
        snapshot['tables'][table] = cur.fetchone()[0]
    except:
        pass
cur.close()

snapshot_path = os.path.join(backup_dir, 'snapshot_phase14.1.json')
with open(snapshot_path, 'w', encoding='utf8') as f:
    json.dump(snapshot, f, ensure_ascii=False, indent=2)
print(f'[OK] 快照: {snapshot_path}')
print(f'  Git: {hash_short}')
print(f'  表:  {json.dumps(snapshot["tables"], indent=2)}')
print('\n✅ Phase14.1 备份完成')
