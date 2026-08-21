# -*- coding: utf-8 -*-
"""v5.50.31 验证：dreamina_submit_image2image 参数名 --images"""
import sys, os
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
sys.path.insert(0, r"C:\Users\admin\prompt-tool-dev\MikPromptKit\backend")
os.chdir(r"C:\Users\admin\prompt-tool-dev\MikPromptKit\backend")

import api.dreamina as dm

# mock _dreamina_run 捕获 args
captured = {}
def fake_run(args, timeout=300):
    captured["args"] = args
    return '{"ok":true,"submit_id":"mock-123","gen_status":"in_progress"}', "", 0
dm._dreamina_run = fake_run

PASS = 0
FAIL = 0
def ok(name, cond, extra=""):
    global PASS, FAIL
    if cond:
        PASS += 1
        print(f"  [PASS] {name} {extra}")
    else:
        FAIL += 1
        print(f"  [FAIL] {name} {extra}")

# 单图
r = dm.dreamina_submit_image2image([r"C:\tmp\a.png"], prompt="参考@图像1", model_version="5.0",
                                   ratio="1:1", resolution_type="2k")
args = captured["args"]
ok("命令 image2image", args[0] == "image2image")
ok("参数名 --images", "--images" in args and "--image" not in args, f"({args})")
ok("传图路径", args[args.index("--images") + 1] == r"C:\tmp\a.png")
ok("prompt 保留", "--prompt" in args)
ok("返回 submit_id", r.get("submit_id") == "mock-123")

# 双图（stringArray 重复）
r2 = dm.dreamina_submit_image2image([r"C:\tmp\a.png", r"C:\tmp\b.png"], prompt="x",
                                    model_version="5.0", ratio="1:1", resolution_type="2k")
args2 = captured["args"]
cnt = args2.count("--images")
ok("双图两个 --images", cnt == 2, f"({cnt})")

print(f"\n========== 结果: PASS=*** FAIL={FAIL} ==========")
sys.exit(0 if FAIL == 0 else 1)
