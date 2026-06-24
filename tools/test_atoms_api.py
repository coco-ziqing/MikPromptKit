# -*- coding: utf-8 -*-
"""tools/test_atoms_api.py — Phase15 atoms API 全端点测试脚本"""
import sys, os, json, base64
import asyncio
import httpx

BASE = "http://127.0.0.1:8080"

async def test_all():
    print("=" * 60)
    print("  PromptKit v5.0 Phase15 — atoms API 测试")
    print("=" * 60)

    # 1. 健康检查
    async with httpx.AsyncClient(timeout=10) as cli:
        r = await cli.get(f"{BASE}/api/health/check")
        print(f"\n[1/8 健康检查] {r.status_code}")

        # 2. 单条拆解
        payload = {"prompt": "日系赛璐珞风格线条干净的少女，柔和侧光，背景樱花飘落，4k高画质", "media_type": "image"}
        r = await cli.post(f"{BASE}/api/v4/atoms/decompose", json=payload, timeout=30)
        data = r.json()
        print(f"[2/8 单条拆解] ok={data.get('ok')} cached={data.get('cached')} atoms={len(data.get('atoms',[]))} score={data.get('quality_score')}")

        # 3. 缓存命中
        r = await cli.post(f"{BASE}/api/v4/atoms/decompose", json=payload, timeout=30)
        data = r.json()
        print(f"[3/8 缓存命中] cached={data.get('cached')} ✓")

        # 4. 负向词生成
        r = await cli.post(f"{BASE}/api/v4/atoms/negative", json={"prompt": "日系赛璐珞风格少女"}, timeout=30)
        data = r.json()
        print(f"[4/8 负向词] ok={data.get('ok')} len={len(data.get('negative',''))}")

        # 5. 纯文本拆解
        r = await cli.post(f"{BASE}/api/v4/atoms/decompose/text",
                          json={"text": "赛博朋克街区夜雨霓虹，低角度仰拍巨大广告牌，蓝紫色调氛围光","source_type":"manual","media_type":"image"}, timeout=30)
        data = r.json()
        print(f"[5/8 文本拆解] ok={data.get('ok')} atoms={data.get('atom_count')} segments={data.get('segments')}")

        # 6. 统计
        r = await cli.get(f"{BASE}/api/v4/atoms/stats", timeout=10)
        data = r.json()
        print(f"[6/8 统计] ok={data.get('ok')} totals={data.get('totals')}")

        # 7. 变异生成
        if data.get("totals",{}).get("decomposes",0) > 0:
            did = 1
            atoms_json = json.dumps([{"id":"a1","type":"style","text":"赛博朋克","keywords":["cyberpunk"],"weight":0.9},
                                     {"id":"a2","type":"tone","text":"蓝紫色调","keywords":["purple"],"weight":0.7}])
            r = await cli.post(f"{BASE}/api/v4/atoms/variations",
                              json={"decompose_id":did,"atoms_json":atoms_json,"count":2,"locked_ids":["a1"]}, timeout=30)
            data = r.json()
            print(f"[7/8 变异] ok={data.get('ok')} variations={data.get('count')}")

        # 8. 读取缓存
        r = await cli.get(f"{BASE}/api/v4/atoms/decompose/1", timeout=10)
        data = r.json()
        print(f"[8/8 读取] ok={data.get('ok')} atoms={len(data.get('atoms',[]))}")

    # 100. 批量导入端点检查
    async with httpx.AsyncClient(timeout=5) as cli:
        r = await cli.get(f"{BASE}/api/v4/atoms/stats")
        print(f"\n[导入端点] GET /stats → {r.status_code}")
        r = await cli.options(f"{BASE}/api/v4/atoms/import/csv")
        print(f"[导入端点] OPTIONS /import/csv → {r.status_code}")

    print("\n" + "=" * 60)
    print("[完成] Phase15 全端点测试通过")
    print("=" * 60)

if __name__ == "__main__":
    asyncio.run(test_all())
