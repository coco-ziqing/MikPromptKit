# -*- coding: utf-8 -*-
"""master_asset 清退迁移：删残留 scene + 移除已弃用 character/scene 入口"""
import os, sqlite3, time, shutil

HERE = os.path.dirname(os.path.abspath(__file__))
DB = os.path.join(HERE, '..', 'data', 'prompts.db')
BK = os.path.join(HERE, '..', 'data', 'backups')

def main():
    os.makedirs(BK, exist_ok=True)
    fk = os.path.join(BK, f"cleanup_master_asset_pre_{time.strftime('%Y%m%d_%H%M%S')}.db")
    s = sqlite3.connect(DB, timeout=10)
    try:
        s.execute("PRAGMA wal_checkpoint(TRUNCATE)")
        s.execute("VACUUM INTO ?", [fk])
        print("[快照]", fk)
    except Exception as e:
        shutil.copy2(DB, fk); print("[WARN] copy snapshot:", e)
    finally: s.close()

    c = sqlite3.connect(DB, timeout=10)
    c.execute("PRAGMA journal_mode=WAL")
    try:
        # 1. 删除旧的 character/scene 残留行
        del_rows = c.execute("SELECT id, asset_type, name FROM master_asset WHERE asset_type IN ('character','scene')").fetchall()
        for r in del_rows:
            print(f"  删除 master_asset#{r[0]} ({r[1]}: {r[2]})")
        cur = c.execute("DELETE FROM master_asset WHERE asset_type IN ('character','scene')")
        print(f"[OK] 删除 {cur.rowcount} 条 residue")
        
        # 2. project_role 确认无冲突
        pr_count = c.execute("SELECT COUNT(1) FROM project_role").fetchone()[0]
        print(f"[OK] project_role 现存 {pr_count} 个实例，不受影响")
        
        # 3. 检查 project_role.master_project_id 列存在性（Phase36.2 迁移已加）
        has_mid = any(r[1]=='master_project_id' for r in c.execute("PRAGMA table_info(project_role)"))
        if has_mid:
            # 确保 project_role 数据完整：有 master_project_id 的记录计数
            linked = c.execute("SELECT COUNT(1) FROM project_role WHERE master_project_id IS NOT NULL").fetchone()[0]
            print(f"[OK] project_role.master_project_id 已关联 {linked}/{pr_count}")
        else:
            print("[INFO] project_role 无 master_project_id 列（旧部署），不影响运行")
        
        c.commit()
        print("[OK] Phase36 清退迁移完成")
    finally: c.close()

if __name__ == "__main__":
    main()
