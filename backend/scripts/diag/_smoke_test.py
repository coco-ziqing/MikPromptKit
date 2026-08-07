# -*- coding: utf-8 -*-
"""
封装后冒烟测试 — 自动验证 EXE / 开发服务 7 项核心功能
用法:
  开发环境: python backend/_smoke_test.py
  EXE 验证: python backend/_smoke_test.py --exe
返回: exit 0 = 全绿, exit 1 = 异常
"""
import urllib.request, json, io, sys, os, time, argparse

def run_smoke(base_url="http://127.0.0.1:8080", timeout=10):
    P = []; F = []
    def ck(name, ok, detail=""):
        (P if ok else F).append(name)
        d = f" → {detail}" if detail else ""
        print(f"  {'✅' if ok else '❌'} {name}{d}")

    print(f"\n{'='*50}")
    print(f"  PromptKit 封装冒烟测试")
    print(f"  目标: {base_url}")
    print(f"{'='*50}")

    # 1. Health
    try:
        r = json.loads(urllib.request.urlopen(f"{base_url}/api/health/status", timeout=timeout).read())
        ck("健康检查", r.get("running") == True,
           f"ollama={'ok' if r.get('ollama',{}).get('ok') else 'offline'}")
    except Exception as e:
        ck("健康检查", False, str(e)[:80])

    # 2. Status + VERSION
    try:
        r = json.loads(urllib.request.urlopen(f"{base_url}/api/status", timeout=timeout).read())
        ck("服务状态", r.get("status") == "running",
           f"version={r.get('version','?')} prompts={r.get('total_prompts',0)} cards={r.get('total_cards',0)}")
    except Exception as e:
        ck("服务状态", False, str(e)[:80])

    # 3. Login
    token = None
    try:
        data = json.dumps({"username": "admin", "password": "***"}).encode()
        req = urllib.request.Request(f"{base_url}/api/auth/login", data=data, method="POST")
        req.add_header("Content-Type", "application/json")
        r = json.loads(urllib.request.urlopen(req, timeout=timeout).read())
        token = r.get("token")
        ck("管理员登录", r.get("ok") == True, f"user={r.get('user',{}).get('username','?')}")
    except Exception as e:
        ck("管理员登录", False, str(e)[:80])

    # 4. Libraries (seedance)
    try:
        r = json.loads(urllib.request.urlopen(f"{base_url}/api/seedance/v2/libraries", timeout=timeout).read())
        empty = [l['dimension_key'] for l in r['libraries'] if l['card_count'] == 0]
        ck(f"词库列表", len(empty) == 0, f"{len(r['libraries'])} 库, 空库={len(empty)}")
    except Exception as e:
        ck("词库列表", False, str(e)[:80])

    # 5. Groups (word cards)
    try:
        r = json.loads(urllib.request.urlopen(f"{base_url}/api/v4/word-cards/groups/tree", timeout=timeout).read())
        tree = r.get('tree', [])
        ck("分组树", len(tree) > 0, f"{len(tree)} 个根节点")
    except Exception as e:
        ck("分组树", False, str(e)[:80])

    # 6. Frontend
    try:
        r = urllib.request.urlopen(f"{base_url}/", timeout=timeout)
        html = r.read().decode('utf-8', errors='ignore')
        ck("前端页面", len(html) > 5000 and ('提示词' in html or '咪卡' in html or 'prompt' in html.lower()),
           f"{len(html)} bytes")
    except Exception as e:
        ck("前端页面", False, str(e)[:80])

    # 7. Plugins
    try:
        r = json.loads(urllib.request.urlopen(f"{base_url}/api/plugin-system/status", timeout=timeout).read())
        ck("插件系统", r.get("initialized") == True, f"enabled={r.get('enabled',0)} total={r.get('total',0)}")
    except Exception as e:
        ck("插件系统", False, str(e)[:80])

    # 8. Cover
    try:
        r = json.loads(urllib.request.urlopen(f"{base_url}/api/cover", timeout=timeout).read())
        ck("封面配置", r.get("ok") == True,
           f"images={len(r.get('cover',{}).get('cover_images',[]))} features={len(r.get('cover',{}).get('features',[]))}")
    except Exception as e:
        ck("封面配置", False, str(e)[:80])

    # 9. License (激活系统)
    try:
        r = json.loads(urllib.request.urlopen(f"{base_url}/api/license/info", timeout=timeout).read())
        ck("许可系统", r.get("ok") == True, f"fingerprint={r.get('fingerprint','')[:8]}...")
    except Exception as e:
        ck("许可系统", False, str(e)[:80])

    print(f"\n{'='*50}")
    print(f"  合计: {len(P)}/{len(P)+len(F)} passed")
    if F:
        for f in F: print(f"    ❌ {f}")
    else:
        print(f"  🎉 全部通过!")
    print(f"{'='*50}\n")
    return len(F) == 0


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="PromptKit 封装后冒烟测试")
    parser.add_argument("--exe", action="store_true", help="测试已启动的 EXE (同 --base)")
    parser.add_argument("--base", default="http://127.0.0.1:8080", help="服务地址")
    parser.add_argument("--timeout", type=int, default=10, help="超时秒数")
    args = parser.parse_args()

    # 等待服务就绪 (EXE 启动需要时间)
    if args.exe:
        print("等待 EXE 服务就绪...")
        for i in range(30):
            try:
                urllib.request.urlopen(f"{args.base}/api/health/status", timeout=3)
                print(f"  ✅ 服务已就绪 (等待 {i+1}s)")
                break
            except Exception:
                time.sleep(1)
        else:
            print("  ❌ 服务启动超时 (30s)")
            sys.exit(1)

    ok = run_smoke(args.base, args.timeout)
    sys.exit(0 if ok else 1)
