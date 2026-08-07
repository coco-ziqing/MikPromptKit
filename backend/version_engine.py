"""
版本增量存储引擎
- v1 全量压缩存储
- v2+ 二进制差异（bsdiff 替代: 用 lzma 压缩的块级差异）
- 链深 5 时自动全量快照重置
- 任意版本还原
"""
import hashlib
import os
import shutil
import sqlite3
import struct
import time

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, "..")
DB = os.path.join(ROOT, "data", "prompts.db")
ARCHIVE_ROOT = os.path.join(ROOT, "data", "archive")
VERSION_STORE = os.path.join(ARCHIVE_ROOT, "versions")
os.makedirs(VERSION_STORE, exist_ok=True)

BLOCK_SIZE = 64 * 1024  # 64KB 块
CHAIN_DEPTH_LIMIT = 5    # 链深超过此值触发全量快照

def _rw():
    c = sqlite3.connect(DB, timeout=5)
    c.row_factory = sqlite3.Row
    c.execute("PRAGMA journal_mode=WAL")
    return c

def _ro():
    c = sqlite3.connect(DB, timeout=5)
    c.row_factory = sqlite3.Row
    c.execute("PRAGMA journal_mode=WAL")
    c.execute("PRAGMA query_only=ON")
    return c

def _safe_commit(c):
    for i in range(5):
        try: c.commit(); return
        except sqlite3.OperationalError:
            if i == 4: raise
            time.sleep(0.05*(i+1))

# ═══════════════════════════
# 块级差异计算（类 bsdiff 简化版）
# ═══════════════════════════

def _compute_block_hash(data):
    """计算单个块的 hash"""
    return hashlib.sha256(data).digest()

def compute_diff(old_path, new_path, out_path):
    """
    计算新旧文件的块级差异并保存。
    格式：header(diff_version:1, block_size:4, num_ops:4)
          ops: (type:1, ref_block_idx:4, new_data_len:4) + new_data
    type=0: 从旧文件复制块, type=1: 新数据
    """
    # 读新文件全量
    with open(new_path, "rb") as f:
        new_data = f.read()

    # 读旧文件 → 块 hash 索引
    old_hashes = {}
    try:
        with open(old_path, "rb") as f:
            idx = 0
            while True:
                block = f.read(BLOCK_SIZE)
                if not block: break
                h = _compute_block_hash(block)
                if h not in old_hashes:
                    old_hashes[h] = (idx, block)
                idx += 1
    except FileNotFoundError:
        old_hashes = {}

    # 新文件分块 → 匹配或插入
    ops = []  # [(type, ref_block_idx, new_data)]
    pos = 0
    while pos < len(new_data):
        block = new_data[pos:pos+BLOCK_SIZE]
        h = _compute_block_hash(block)
        if h in old_hashes:
            ops.append((0, old_hashes[h][0], b""))
        else:
            ops.append((1, 0, block))
        pos += len(block)

    # 写入差异文件
    with open(out_path, "wb") as f:
        f.write(struct.pack(">BII", 1, BLOCK_SIZE, len(ops)))
        for op_type, ref_idx, data in ops:
            f.write(struct.pack(">BI", op_type, ref_idx))
            if op_type == 1:
                f.write(struct.pack(">I", len(data)))
                f.write(data)

    return out_path

def apply_diff(old_path, diff_path, out_path):
    """应用差异还原最新版本"""
    with open(diff_path, "rb") as f:
        version, block_size, num_ops = struct.unpack(">BII", f.read(9))

    # 读旧文件块索引
    old_blocks = []
    try:
        with open(old_path, "rb") as f:
            while True:
                block = f.read(block_size)
                if not block: break
                old_blocks.append(block)
    except FileNotFoundError:
        old_blocks = []

    with open(out_path, "wb") as fout:
        for _ in range(num_ops):
            op_type, ref_idx = struct.unpack(">BI", f.read(5))
            if op_type == 0:
                if ref_idx < len(old_blocks):
                    fout.write(old_blocks[ref_idx])
            else:
                data_len = struct.unpack(">I", f.read(4))[0]
                data = f.read(data_len)
                fout.write(data)

    return out_path


# ═══════════════════════════
# 版本存储
# ═══════════════════════════

def store_version(catalog_id, filepath, version_no, prev_version_path=None):
    """
    存储新版本。自动判断全量/增量。
    返回: (version_path, method, size)

    规则：
    - v1 或无前置 → 全量压缩存储
    - v2+ 且有前置 → 差异存储
    - 链深 >= CHAIN_DEPTH_LIMIT → 全量快照重置链
    """
    db = _rw()
    try:
        # 计算当前链深
        chain = db.execute("""
            SELECT id, version_no, storage_path, diff_method, chain_depth
            FROM asset_version WHERE catalog_id=? ORDER BY version_no DESC LIMIT ?
        """, [catalog_id, CHAIN_DEPTH_LIMIT]).fetchall()
        chain = list(chain)  # 最新在前

        should_full = False
        if not chain or version_no == 1:
            should_full = True
        elif len(chain) >= CHAIN_DEPTH_LIMIT - 1:
            # 要超过限制了，全量重置
            should_full = True
    finally:
        db.close()

    ver_dir = os.path.join(VERSION_STORE, str(catalog_id))
    os.makedirs(ver_dir, exist_ok=True)

    if should_full:
        # 全量压缩
        import lzma
        ver_path = os.path.join(ver_dir, f"v{version_no}.lzma")
        with open(filepath, "rb") as fin, lzma.open(ver_path, "wb", preset=5) as fout:
            while True:
                buf = fin.read(16 * 1024 * 1024)
                if not buf: break
                fout.write(buf)
        return (ver_path, "full_lzma", os.path.getsize(ver_path))

    else:
        # 增量差异（基于最新全量版本）
        # 找最近的全量版本作为 base
        base_ver = None
        for v in chain:
            if v["diff_method"] == "full_lzma":
                base_ver = v
                break

        if base_ver and os.path.exists(base_ver["storage_path"]):
            # 先解压 base 到临时
            import lzma
            base_tmp = os.path.join(ver_dir, f"_base_v{base_ver['version_no']}.tmp")
            with lzma.open(base_ver["storage_path"], "rb") as fin, open(base_tmp, "wb") as fout:
                while True:
                    buf = fin.read(16 * 1024 * 1024)
                    if not buf: break
                    fout.write(buf)

            ver_path = os.path.join(ver_dir, f"v{version_no}.diff")
            compute_diff(base_tmp, filepath, ver_path)
            try:
                os.remove(base_tmp)
            except Exception:
                pass
            return (ver_path, "diff", os.path.getsize(ver_path))
        else:
            # 找不到 base，回退全量
            import lzma
            ver_path = os.path.join(ver_dir, f"v{version_no}.lzma")
            with open(filepath, "rb") as fin, lzma.open(ver_path, "wb", preset=5) as fout:
                while True:
                    buf = fin.read(16 * 1024 * 1024)
                    if not buf: break
                    fout.write(buf)
            return (ver_path, "full_lzma", os.path.getsize(ver_path))


def restore_version(catalog_id, version_no, dest_path):
    """
    还原指定版本到 dest_path。
    自动处理全量/差异链。
    """
    db = _ro()
    try:
        ver = db.execute("""
            SELECT version_no, storage_path, diff_method
            FROM asset_version WHERE catalog_id=? AND version_no=?
        """, [catalog_id, version_no]).fetchone()
        if not ver:
            raise FileNotFoundError(f"版本 v{version_no} 不存在")

        if not os.path.exists(ver["storage_path"]):
            raise FileNotFoundError(f"版本存储文件不存在: {ver['storage_path']}")

        if ver["diff_method"] == "full_lzma":
            # 直接解压
            import lzma
            try:
                with lzma.open(ver["storage_path"], "rb") as fin, open(dest_path, "wb") as fout:
                    while True:
                        buf = fin.read(16 * 1024 * 1024)
                        if not buf: break
                        fout.write(buf)
            except Exception:
                # 可能不是 lzma 文件，试试原始拷贝
                shutil.copy2(ver["storage_path"], dest_path)
        else:
            # 差异文件：找到最近的全量版本作为 base
            base_ver = db.execute("""
                SELECT version_no, storage_path FROM asset_version
                WHERE catalog_id=? AND diff_method='full_lzma' AND version_no < ?
                ORDER BY version_no DESC LIMIT 1
            """, [catalog_id, version_no]).fetchone()

            if not base_ver:
                raise RuntimeError(f"找不到 v{version_no} 的基准版本")

            # 解压 base
            import lzma
            ver_dir = os.path.join(VERSION_STORE, str(catalog_id))
            base_tmp = os.path.join(ver_dir, "_restore_base.tmp")
            try:
                with lzma.open(base_ver["storage_path"], "rb") as fin, open(base_tmp, "wb") as fout:
                    while True:
                        buf = fin.read(16 * 1024 * 1024)
                        if not buf: break
                        fout.write(buf)

                # 应用差异链（base → target 之间的所有差异文件按序应用）
                # 找到 base 到 target 之间的差异文件
                diffs = db.execute("""
                    SELECT version_no, storage_path FROM asset_version
                    WHERE catalog_id=? AND diff_method='diff' AND version_no > ? AND version_no <= ?
                    ORDER BY version_no
                """, [catalog_id, base_ver["version_no"], version_no]).fetchall()

                current = base_tmp
                for d in diffs:
                    next_tmp = os.path.join(ver_dir, f"_restore_step_{d['version_no']}.tmp")
                    apply_diff(current, d["storage_path"], next_tmp)
                    if current != base_tmp:
                        try: os.remove(current)
                        except Exception: pass
                    current = next_tmp

                shutil.copy2(current, dest_path)
                try: os.remove(current)
                except Exception: pass
            finally:
                try:
                    if os.path.exists(base_tmp): os.remove(base_tmp)
                except Exception: pass
    finally:
        db.close()
    return dest_path


def get_chain_depth(catalog_id):
    """获取当前版本链深度"""
    db = _ro()
    try:
        # 从最近一次全量快照开始数
        last_full = db.execute("""
            SELECT version_no FROM asset_version
            WHERE catalog_id=? AND diff_method='full_lzma'
            ORDER BY version_no DESC LIMIT 1
        """, [catalog_id]).fetchone()
        if not last_full:
            return 0
        cnt = db.execute("""
            SELECT COUNT(1) FROM asset_version
            WHERE catalog_id=? AND version_no >= ?
        """, [catalog_id, last_full["version_no"]]).fetchone()[0]
        return cnt
    finally:
        db.close()


if __name__ == "__main__":
    print("[TEST] version_engine loaded")
    print(f"  CHAIN_DEPTH_LIMIT: {CHAIN_DEPTH_LIMIT}")
    print(f"  VERSION_STORE: {VERSION_STORE}")

    # 自测差异计算
    import tempfile
    tf1 = tempfile.NamedTemporaryFile(delete=False, suffix=".bin")
    tf1.write(b"A" * 1000 + b"B" * 500)
    tf1.close()
    tf2 = tempfile.NamedTemporaryFile(delete=False, suffix=".bin")
    tf2.write(b"A" * 1000 + b"C" * 500 + b"D" * 200)
    tf2.close()
    tf3 = tempfile.NamedTemporaryFile(delete=False, suffix=".diff")
    tf3.close()

    compute_diff(tf1.name, tf2.name, tf3.name)
    diff_size = os.path.getsize(tf3.name)
    print(f"  diff test: old={os.path.getsize(tf1.name)}B, new={os.path.getsize(tf2.name)}B, diff={diff_size}B")

    # 还原测试
    restore_path = tempfile.NamedTemporaryFile(delete=False, suffix=".rst")
    restore_path.close()
    apply_diff(tf1.name, tf3.name, restore_path.name)
    with open(tf2.name, "rb") as f: expect = f.read()
    with open(restore_path.name, "rb") as f: actual = f.read()
    print(f"  roundtrip: {'OK' if expect == actual else 'FAIL'}")

    for p in [tf1.name, tf2.name, tf3.name, restore_path.name]:
        try: os.remove(p)
        except Exception: pass
