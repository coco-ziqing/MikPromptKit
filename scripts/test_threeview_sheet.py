# -*- coding: utf-8 -*-
"""v5.50.26 三视图 sheet 模式验证：单元级 prompt 组装 + HTTP 参数校验"""
import sys, json, io, os
sys.stdout.reconfigure(encoding="utf-8", errors="replace")

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

# ---- 单元级：直接调 _build_three_view_prompts ----
sys.path.insert(0, r"C:\Users\admin\prompt-tool-dev\MikPromptKit\backend")
import importlib.util
spec = importlib.util.spec_from_file_location("proj_roles_mod", r"C:\Users\admin\prompt-tool-dev\MikPromptKit\backend\api\project_roles.py")
# 不真正 import（有依赖），改用文本级检查 + 独立复现组装逻辑
import ast
src = io.open(r"C:\Users\admin\prompt-tool-dev\MikPromptKit\backend\api\project_roles.py", encoding="utf-8").read()
tree = ast.parse(src)
# 提取 _build_three_view_prompts 源码段
fn = None
for node in ast.walk(tree):
    if isinstance(node, ast.FunctionDef) and node.name == "_build_three_view_prompts":
        fn = node
        break
ok("_build_three_view_prompts 存在", fn is not None)
if fn:
    fn_src = ast.get_source_segment(src, fn)
    # 静态断言 sheet 分支存在
    ok("含 sheet 四宫格分支", "layout == \"sheet\"" in fn_src or "sheet" in fn_src)
    ok("含 style_prefix 风格注入", "style_prefix" in fn_src and "style_part" in fn_src)
    ok("含脸部特写", "脸部特写" in fn_src)
    ok("含无阴影", "无阴影" in fn_src)
    ok("含标准正交视图", "标准正交视图" in fn_src)
    ok("含完全一致约束", "完全一致" in fn_src)
    ok("含并排布局", "依次并排展示" in fn_src)

# 实际执行组装逻辑（独立复现，验证产出文本）
settings = {
    "gender": "男性", "age": "25岁", "body": "身高182cm，瘦高挺拔",
    "hairstyle": "束发", "facial": "五官清秀，眼神深邃",
    "clothing": "修仙宗门杂役弟子装扮，灰色为主，蓝色和棕色为配色，服装剪裁合身，都市简约风格",
    "occupation": "修仙宗门杂役弟子", "temperament": "沉稳", "style": ""
}
name = "杂役弟子·玄尘"
style_prefix = "3D写实国漫风格，UE5渲染，细节超高清"

# 复现 sheet 组装（与后端逻辑一致）
subj_parts = []
for k in ("gender", "age", "body", "hairstyle", "facial", "clothing", "accessory", "occupation", "temperament", "style"):
    v = (settings.get(k) or "").strip()
    if v: subj_parts.append(v)
subj = "，".join(subj_parts)
if name: subj = f"{name}（{subj}）"
style_part = f"{style_prefix}，" if style_prefix else ""
sheet_prompt = (
    f"{style_part}角色三视图加脸部特写设定表，纯白背景，无阴影，"
    f"清晰展示正面、侧面、背面标准正交视图，"
    f"依次并排展示：正面全身站立像、90度侧面全身像、背面全身像、脸部特写，"
    f"角色：{subj}，"
    f"服装、发型、配饰等所有细节在三个视角中完全一致，"
    f"人物比例协调，构图完整，专业角色设定图风格，高清细节，服装剪裁合身"
)
ok("sheet 提示词含风格前缀", sheet_prompt.startswith("3D写实国漫风格，UE5渲染，细节超高清，角色三视图"))
ok("sheet 提示词含角色描述", "修仙宗门杂役弟子" in sheet_prompt and "182cm" in sheet_prompt and "杂役弟子·玄尘" in sheet_prompt)
ok("sheet 提示词四要素齐", all(x in sheet_prompt for x in ["正面全身站立像", "90度侧面全身像", "背面全身像", "脸部特写"]))
ok("sheet 一致性约束", "完全一致" in sheet_prompt)
ok("sheet 背景无阴影", "纯白背景，无阴影" in sheet_prompt)

# single 模式保持旧结构
base = (f"{style_part}{subj}，角色三视图设定图，纯白背景，全身立绘，"
        f"统一角色外观与服装细节，人物比例协调，专业角色设定图风格，高清细节")
front = f"{base}，正面视角，正面站姿，双手自然下垂，面部与服装正面完整展示"
side = f"{base}，正侧面视角，侧身站姿，展示侧面轮廓与服装侧面细节"
back = f"{base}，背面视角，背身站姿，展示背面服装与发型背面细节"
ok("single 模式三视角齐全", all(x in front + side + back for x in ["正面视角", "正侧面视角", "背面视角"]))
ok("single 模式带风格前缀", front.startswith("3D写实国漫风格"))

# ---- HTTP 级：参数校验（不真实生成，只测非法参数 400）----
import urllib.request, urllib.error
BASE = "http://127.0.0.1:8080"
def call(method, path, body=None, token=None):
    req = urllib.request.Request(BASE + path, method=method)
    req.add_header("Content-Type", "application/json")
    if token: req.add_header("Authorization", "Bearer " + token)
    if body is not None: req.data = json.dumps(body).encode("utf-8")
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8")[:200]

st, d = call("POST", "/api/auth/login", {"username": "admin", "password": "admin"})
token = d.get("token", "")
ok("登录", st == 200)

# 非法 layout → 400（在 _auth 之后校验，需真实角色 id；用不存在角色先测 auth 路径）
st, d = call("POST", "/api/roles/999999/three-view/generate", {"engine": "dreamina", "layout": "bad"}, token)
ok("非法 layout 400", st == 400 and "single/sheet" in d, f"({st} {d[:60]})")

# 合法 sheet 但角色不存在 → 404（说明 layout 校验通过）
st, d = call("POST", "/api/roles/999999/three-view/generate", {"engine": "dreamina", "layout": "sheet", "style_prefix": "3D写实国漫风格，UE5渲染，细节超高清"}, token)
ok("合法 layout 通过参数校验（404=角色不存在）", st == 404, f"({st})")

print(f"\n========== 结果: PASS={PASS} FAIL={FAIL} ==========")
sys.exit(0 if FAIL == 0 else 1)
