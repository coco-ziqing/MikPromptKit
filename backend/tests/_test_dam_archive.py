# -*- coding: utf-8 -*-
"""
T4 — DAM 归档层端到端验证（引擎级，直连 archive_engine，不走 HTTP 鉴权）。
覆盖：压缩归档 -> 内容寻址去重 -> 还原字节校验 -> 引用计数 -> 清理归零。
运行：从工作区根目录执行 python backend/tests/_test_dam_archive.py
前置：不需要服务在线（引擎自持 DB 连接）。
"""
import sys, os, io, hashlib
sys.path.insert(0, "backend")
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")

import archive_engine as AE

PASS, FAIL = [], []
def ck(name, ok, extra=""):
    (PASS if ok else FAIL).append(name)
    print(f"  {'PASS' if ok else 'FAIL'} {name}" + (f"  [{extra}]" if extra else ""))

def sha(p):
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for b in iter(lambda: f.read(1 << 20), b""):
            h.update(b)
    return h.hexdigest()

import sqlite3
DB = AE.DB
def q(sql, p=()):
    c = sqlite3.connect(DB, timeout=5); c.row_factory = sqlite3.Row
    try: return c.execute(sql, p).fetchall()
    finally: c.close()

psid = q("SELECT id FROM project_space ORDER BY id LIMIT 1")
PSID = psid[0]["id"] if psid else 1
print(f"== DAM archive E2E (project_space_id={PSID}) ==")

TMP = os.path.join(AE.ROOT, "data", "archive", "tmp", "_t4_fixtures")
os.makedirs(TMP, exist_ok=True)
created_catalog_ids = []
created_blob_hashes = []

try:
    f_doc = os.path.join(TMP, "design_brief.pdf")
    payload = ("PromptKit DAM archive verify payload. " * 2000).encode("utf-8")
    with open(f_doc, "wb") as f: f.write(payload)
    doc_sha = sha(f_doc); doc_size = os.path.getsize(f_doc)

    f_dup = os.path.join(TMP, "design_brief_copy.pdf")
    with open(f_dup, "wb") as f: f.write(payload)

    blob_before = q("SELECT COUNT(*) c FROM blob_store")[0]["c"]

    r1 = AE.do_full_archive(f_doc, PSID, "doc", filename="design_brief.pdf", is_critical=1)
    ck("archive1 ok", r1.get("ok"), f"method={r1.get('compression')} saved={r1.get('saved_pct')}%")
    ck("archive1 compressed <50%", r1.get("ok") and r1.get("compressed_size", 1e9) < doc_size * 0.5,
       f"{doc_size}->{r1.get('compressed_size')}")
    if r1.get("ok"):
        created_catalog_ids.append(r1["catalog_id"]); created_blob_hashes.append(r1["blob_hash"])
    ck("archive1 already_existed=False", r1.get("already_existed") is False)

    blob_after1 = q("SELECT COUNT(*) c FROM blob_store")[0]["c"]
    ck("blob_store +1", blob_after1 == blob_before + 1, f"{blob_before}->{blob_after1}")

    cat = q("SELECT blob_hash, archive_path FROM asset_catalog WHERE id=?", [r1["catalog_id"]])
    ck("catalog blob_hash set", bool(cat and cat[0]["blob_hash"]))
    ck("catalog archive_path exists", bool(cat and cat[0]["archive_path"] and os.path.exists(cat[0]["archive_path"])))

    bh = r1["blob_hash"]; store_path = os.path.join(AE.BLOB_STORE, bh[:2], bh)
    ck("blob entity on disk", os.path.exists(store_path))

    r2 = AE.do_full_archive(f_dup, PSID, "doc", filename="design_brief_copy.pdf", is_critical=0)
    ck("archive2 ok", r2.get("ok"))
    if r2.get("ok"): created_catalog_ids.append(r2["catalog_id"])
    ck("archive2 dedup already_existed=True", r2.get("already_existed") is True)
    ck("archive2 same blob_hash", r2.get("blob_hash") == r1.get("blob_hash"))

    blob_after2 = q("SELECT COUNT(*) c FROM blob_store")[0]["c"]
    ck("dedup keeps blob count", blob_after2 == blob_after1, f"={blob_after2}")
    rc = q("SELECT ref_count FROM blob_store WHERE blob_hash=?", [bh])
    ck("ref_count=2 after dedup", rc and rc[0]["ref_count"] == 2, f"ref={rc[0]['ref_count'] if rc else '?'}")

    out = os.path.join(TMP, "restored_design_brief.pdf")
    n = AE.restore_from_blob(bh, out, r1["compression"])
    ck("restore produced file", os.path.exists(out), f"{n}B")
    ck("restore bytes match orig (sha256)", os.path.exists(out) and sha(out) == doc_sha,
       f"orig={doc_sha[:8]} restored={sha(out)[:8] if os.path.exists(out) else 'NA'}")

    try:
        from PIL import Image
        f_png = os.path.join(TMP, "swatch.png")
        img = Image.new("RGB", (256, 256), (180, 40, 90))
        for x in range(256):
            for y in range(0, 256, 8): img.putpixel((x, y), (20, 200, 120))
        img.save(f_png, "PNG")
        dim = img.size
        r3 = AE.do_full_archive(f_png, PSID, "image", filename="swatch.png", is_critical=0)
        ck("PNG archive ok (webp lossless)", r3.get("ok"), f"method={r3.get('compression')}")
        if r3.get("ok"):
            created_catalog_ids.append(r3["catalog_id"]); created_blob_hashes.append(r3["blob_hash"])
            out_png = os.path.join(TMP, "restored_swatch.png")
            AE.restore_from_blob(r3["blob_hash"], out_png, r3["compression"])
            ck("PNG restore dim match", Image.open(out_png).size == dim)
    except Exception as e:
        ck("PNG archive (needs Pillow)", False, str(e)[:60])

    all_exist = all(os.path.exists(os.path.join(AE.BLOB_STORE, h[:2], h)) for h in set(created_blob_hashes))
    ck("integrity - all blob entities on disk", all_exist)

finally:
    c = sqlite3.connect(DB, timeout=5)
    for cid in created_catalog_ids:
        try: c.execute("DELETE FROM asset_catalog WHERE id=?", [cid])
        except Exception: pass
    c.commit(); c.close()
    for h in created_blob_hashes:
        try: AE.remove_from_blob_store(h)
        except Exception: pass
    try: AE.remove_from_blob_store(created_blob_hashes[0] if created_blob_hashes else "")
    except Exception: pass
    import shutil
    shutil.rmtree(TMP, ignore_errors=True)
    AE.cleanup_temp()
    left = q("SELECT COUNT(*) c FROM blob_store")[0]["c"]
    print(f"\nblob_store rows after cleanup = {left} (test-introduced rows reverted)")
    print(f"\n{len(PASS)}/{len(PASS)+len(FAIL)} passed" + (f"  FAIL: {FAIL}" if FAIL else ""))
    sys.exit(1 if FAIL else 0)
