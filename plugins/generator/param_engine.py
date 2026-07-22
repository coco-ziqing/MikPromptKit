"""
com.promptkit.generator — 角色肖像参数引擎 v1.0.0

定义捏脸参数模型、默认值、与 ComfyUI 提示词的组合映射。
不依赖 Portrait Master — 参数控制正向提示词的视觉描述片段。
"""
import json

# ========================================================================
# 参数定义 — 所有可调节的捏脸滑块与选择器
# ========================================================================

PARAM_SCHEMA = {
    "face": {
        "label": "面部",
        "icon": "bi-person-bounding-box",
        "order": 1,
        "params": {
            "face_shape": {
                "type": "select",
                "label": "脸型",
                "options": [
                    {"value": "oval", "label": "鹅蛋脸"},
                    {"value": "round", "label": "圆脸"},
                    {"value": "square", "label": "方脸"},
                    {"value": "heart", "label": "心形脸"},
                    {"value": "diamond", "label": "钻石脸"},
                    {"value": "long", "label": "长脸"},
                ],
                "default": "oval",
                "prompt_map": {
                    "oval": "oval face",
                    "round": "round face",
                    "square": "square jaw face",
                    "heart": "heart-shaped face",
                    "diamond": "diamond face",
                    "long": "long face",
                },
            },
            "cheekbone_height": {
                "type": "slider",
                "label": "颧骨高度",
                "min": 0.0, "max": 1.0, "default": 0.5, "step": 0.05,
                "prompt_map": None,  # 不直接加入提示词，影响整体脸型描述
            },
            "chin_width": {
                "type": "slider",
                "label": "下巴宽度",
                "min": 0.0, "max": 1.0, "default": 0.5, "step": 0.05,
                "prompt_prefix": {"0.0": "very narrow chin", "0.5": "", "1.0": "wide chin"},
            },
            "jaw_angle": {
                "type": "slider",
                "label": "下颌角度",
                "min": 0.0, "max": 1.0, "default": 0.5, "step": 0.05,
                "prompt_prefix": {"0.0": "soft jawline", "0.5": "", "1.0": "sharp angular jawline"},
            },
        },
    },

    "eyes": {
        "label": "眼鼻唇",
        "icon": "bi-eye",
        "order": 2,
        "params": {
            "eye_shape": {
                "type": "select",
                "label": "眼型",
                "options": [
                    {"value": "almond", "label": "杏眼"},
                    {"value": "round", "label": "圆眼"},
                    {"value": "monolid", "label": "单眼皮"},
                    {"value": "hooded", "label": "内双眼"},
                    {"value": "downturned", "label": "下垂眼"},
                    {"value": "upturned", "label": "上挑眼"},
                ],
                "default": "almond",
                "prompt_map": {
                    "almond": "almond shaped eyes",
                    "round": "large round eyes",
                    "monolid": "monolid eyes",
                    "hooded": "hooded eyes",
                    "downturned": "downturned gentle eyes",
                    "upturned": "upturned cat eyes",
                },
            },
            "eye_size": {
                "type": "slider",
                "label": "眼睛大小",
                "min": 0.5, "max": 1.5, "default": 1.0, "step": 0.05,
                "prompt_prefix": {"0.5": "small eyes", "0.75": "", "1.0": "normal eyes", "1.25": "large eyes", "1.5": "very large anime eyes"},
            },
            "eye_distance": {
                "type": "slider",
                "label": "眼距",
                "min": 0.3, "max": 1.0, "default": 0.6, "step": 0.05,
                "prompt_prefix": {"0.3": "close-set eyes", "0.6": "", "1.0": "wide-set eyes"},
            },
            "eye_color": {
                "type": "color",
                "label": "瞳孔颜色",
                "default": "#4a3728",
                "prompt_choices": {
                    "#4a3728": "brown eyes",
                    "#2c3e50": "dark brown eyes",
                    "#1a1a2e": "black eyes",
                    "#3a6ea5": "blue eyes",
                    "#4a8c5c": "green eyes",
                    "#7a9eb1": "grey eyes",
                    "#8b5e3c": "hazel eyes",
                    "#9b59b6": "purple eyes",
                    "#c0392b": "red eyes",
                    "#f39c12": "golden eyes",
                },
            },
            "nose_shape": {
                "type": "select",
                "label": "鼻型",
                "options": [
                    {"value": "straight", "label": "直鼻"},
                    {"value": "aquiline", "label": "鹰钩鼻"},
                    {"value": "snub", "label": "翘鼻"},
                    {"value": "button", "label": "圆鼻头"},
                    {"value": "hawk", "label": "鹰鼻"},
                ],
                "default": "straight",
                "prompt_map": {
                    "straight": "straight nose",
                    "aquiline": "aquiline nose",
                    "snub": "snub nose",
                    "button": "button nose",
                    "hawk": "hawk nose",
                },
            },
            "lip_shape": {
                "type": "select",
                "label": "唇形",
                "options": [
                    {"value": "thin", "label": "薄唇"},
                    {"value": "full", "label": "厚唇"},
                    {"value": "heart", "label": "心形唇"},
                    {"value": "wide", "label": "宽唇"},
                    {"value": "bow", "label": "弓形唇"},
                ],
                "default": "full",
                "prompt_map": {
                    "thin": "thin lips",
                    "full": "full lips",
                    "heart": "heart-shaped lips",
                    "wide": "wide lips",
                    "bow": "bow-shaped lips",
                },
            },
        },
    },

    "hair": {
        "label": "发型发色",
        "icon": "bi-person",
        "order": 3,
        "params": {
            "hair_style": {
                "type": "select",
                "label": "发型",
                "options": [
                    {"value": "long_straight", "label": "长直发"},
                    {"value": "long_wavy", "label": "长卷发"},
                    {"value": "short_bob", "label": "短发波波头"},
                    {"value": "short_pixie", "label": "精灵短发"},
                    {"value": "ponytail", "label": "马尾"},
                    {"value": "bun", "label": "丸子头"},
                    {"value": "twin_tails", "label": "双马尾"},
                    {"value": "braid", "label": "辫子"},
                    {"value": "curly", "label": "卷发"},
                    {"value": "messy", "label": "凌乱风"},
                ],
                "default": "long_straight",
                "prompt_map": {
                    "long_straight": "long straight hair",
                    "long_wavy": "long wavy hair",
                    "short_bob": "short bob haircut",
                    "short_pixie": "short pixie cut",
                    "ponytail": "ponytail hairstyle",
                    "bun": "hair bun",
                    "twin_tails": "twin tails hairstyle",
                    "braid": "braided hair",
                    "curly": "curly hair",
                    "messy": "messy casual hair",
                },
            },
            "hair_color": {
                "type": "color",
                "label": "发色",
                "default": "#1a1a2e",
                "prompt_choices": {
                    "#1a1a2e": "black hair",
                    "#2c1810": "dark brown hair",
                    "#8b4513": "brown hair",
                    "#d4a574": "light brown hair",
                    "#f0e6d3": "blonde hair",
                    "#e0e0e0": "silver hair",
                    "#ffffff": "white hair",
                    "#ff6b6b": "pink hair",
                    "#4ecdc4": "teal hair",
                    "#a855f7": "purple hair",
                    "#ef4444": "red hair",
                    "#3b82f6": "blue hair",
                },
            },
            "bangs_style": {
                "type": "select",
                "label": "刘海",
                "options": [
                    {"value": "none", "label": "无刘海"},
                    {"value": "straight", "label": "齐刘海"},
                    {"value": "side", "label": "侧分"},
                    {"value": "curtain", "label": "中分帘式"},
                    {"value": "wispy", "label": "空气刘海"},
                    {"value": "swept", "label": "斜刘海"},
                ],
                "default": "straight",
                "prompt_map": {
                    "none": "no bangs, forehead visible",
                    "straight": "straight bangs",
                    "side": "side-swept bangs",
                    "curtain": "curtain bangs",
                    "wispy": "wispy see-through bangs",
                    "swept": "swept bangs",
                },
            },
        },
    },

    "style": {
        "label": "风格构图",
        "icon": "bi-palette",
        "order": 4,
        "params": {
            "art_style": {
                "type": "select",
                "label": "画风",
                "options": [
                    {"value": "realistic", "label": "写实摄影"},
                    {"value": "semi_realistic", "label": "半写实"},
                    {"value": "anime", "label": "二次元动漫"},
                    {"value": "oil_painting", "label": "油画风"},
                    {"value": "watercolor", "label": "水彩风"},
                    {"value": "sketch", "label": "素描风"},
                    {"value": "3d_render", "label": "3D渲染"},
                    {"value": "ink_wash", "label": "水墨风"},
                ],
                "default": "realistic",
                "prompt_map": {
                    "realistic": "photorealistic, 8k, highly detailed, professional portrait photography",
                    "semi_realistic": "semi-realistic, detailed digital art, smooth rendering",
                    "anime": "anime style, manga art, cel shaded, 2d illustration",
                    "oil_painting": "oil painting style, brush strokes, artistic portrait",
                    "watercolor": "watercolor painting, soft washes, artistic delicate",
                    "sketch": "pencil sketch, charcoal drawing, monochrome art",
                    "3d_render": "3D render, CGI, octane render, unreal engine",
                    "ink_wash": "ink wash painting, sumi-e style, traditional Asian art",
                },
            },
            "lighting": {
                "type": "select",
                "label": "光照方向",
                "options": [
                    {"value": "front", "label": "正面光"},
                    {"value": "side", "label": "侧面光"},
                    {"value": "rim", "label": "轮廓光"},
                    {"value": "soft", "label": "柔光"},
                    {"value": "dramatic", "label": "戏剧光"},
                    {"value": "backlight", "label": "逆光"},
                ],
                "default": "soft",
                "prompt_map": {
                    "front": "front lighting, evenly lit",
                    "side": "side lighting, chiaroscuro",
                    "rim": "rim lighting, edge light, dramatic silhouette",
                    "soft": "soft diffused lighting, studio lighting",
                    "dramatic": "dramatic lighting, high contrast, cinematic",
                    "backlight": "backlight, golden hour rim glow, silhouette",
                },
            },
            "background_type": {
                "type": "select",
                "label": "背景",
                "options": [
                    {"value": "studio_grey", "label": "工作室灰"},
                    {"value": "studio_white", "label": "纯白背景"},
                    {"value": "nature", "label": "自然户外"},
                    {"value": "urban", "label": "城市场景"},
                    {"value": "solid_color", "label": "纯色背景"},
                    {"value": "gradient", "label": "渐变背景"},
                    {"value": "transparent", "label": "透明（PNG）"},
                    {"value": "fantasy", "label": "奇幻场景"},
                ],
                "default": "studio_grey",
                "prompt_map": {
                    "studio_grey": "grey studio background, clean backdrop",
                    "studio_white": "pure white background, studio photoshoot",
                    "nature": "outdoor nature background, trees and sky, bokeh",
                    "urban": "urban city street background, modern architecture",
                    "solid_color": "solid color background",
                    "gradient": "gradient background, soft color transition",
                    "transparent": "transparent background, isolated subject",
                    "fantasy": "fantasy setting, magical atmosphere, ethereal background",
                },
            },
            "expression": {
                "type": "select",
                "label": "表情",
                "options": [
                    {"value": "neutral", "label": "自然"},
                    {"value": "smile", "label": "微笑"},
                    {"value": "big_smile", "label": "大笑"},
                    {"value": "sad", "label": "忧伤"},
                    {"value": "angry", "label": "愤怒"},
                    {"value": "surprised", "label": "惊讶"},
                    {"value": "shy", "label": "害羞"},
                    {"value": "serious", "label": "严肃"},
                ],
                "default": "neutral",
                "prompt_map": {
                    "neutral": "neutral expression",
                    "smile": "gentle smile, warm expression",
                    "big_smile": "big bright smile, laughing, joyful",
                    "sad": "sad expression, melancholic, sorrowful gaze",
                    "angry": "angry expression, fierce glare",
                    "surprised": "surprised expression, wide-eyed wonder",
                    "shy": "shy expression, blushing, looking away",
                    "serious": "serious expression, intense gaze, stoic",
                },
            },
        },
    },

    "body": {
        "label": "姿态服饰",
        "icon": "bi-person-standing",
        "order": 5,
        "params": {
            "clothing": {
                "type": "select",
                "label": "服饰",
                "options": [
                    {"value": "casual", "label": "休闲装"},
                    {"value": "formal", "label": "正装"},
                    {"value": "school_uniform", "label": "学生制服"},
                    {"value": "traditional", "label": "传统服饰"},
                    {"value": "fantasy_armor", "label": "奇幻铠甲"},
                    {"value": "streetwear", "label": "街头潮流"},
                    {"value": "sportswear", "label": "运动装"},
                    {"value": "elegant_dress", "label": "优雅礼服"},
                ],
                "default": "casual",
                "prompt_map": {
                    "casual": "casual everyday clothing, comfortable outfit",
                    "formal": "formal business attire, professional suit",
                    "school_uniform": "school uniform, academic outfit",
                    "traditional": "traditional clothing, cultural costume",
                    "fantasy_armor": "fantasy armor, ornate battle gear",
                    "streetwear": "streetwear fashion, trendy urban clothing",
                    "sportswear": "sportswear, athletic outfit",
                    "elegant_dress": "elegant dress, evening gown, formal wear",
                },
            },
            "pose": {
                "type": "select",
                "label": "姿态",
                "options": [
                    {"value": "standing", "label": "站立"},
                    {"value": "sitting", "label": "坐姿"},
                    {"value": "portrait_close", "label": "正面特写"},
                    {"value": "three_quarter", "label": "3/4侧面"},
                    {"value": "profile", "label": "纯侧面"},
                    {"value": "action", "label": "动态"},
                ],
                "default": "portrait_close",
                "prompt_map": {
                    "standing": "standing pose, full body",
                    "sitting": "sitting pose, relaxed posture",
                    "portrait_close": "portrait close-up, head and shoulders, face focused",
                    "three_quarter": "three-quarter view, looking slightly to side",
                    "profile": "side profile, silhouette portrait",
                    "action": "dynamic action pose, movement, dramatic angle",
                },
            },
        },
    },
}

# ========================================================================
# 作品比例
# ========================================================================

ASPECT_RATIOS = [
    {"value": "1:1", "label": "1:1 正方形头像", "width": 1024, "height": 1024},
    {"value": "3:4", "label": "3:4 竖向半身", "width": 768, "height": 1024},
    {"value": "2:3", "label": "2:3 经典肖像", "width": 768, "height": 1152},
    {"value": "9:16", "label": "9:16 全身竖版", "width": 576, "height": 1024},
    {"value": "4:3", "label": "4:3 半身横版", "width": 1024, "height": 768},
    {"value": "16:9", "label": "16:9 横版场景", "width": 1024, "height": 576},
]

# ========================================================================
# 参数 → 提示词组合引擎
# ========================================================================

def compose_prompt(params: dict, aspect_ratio: str = "1:1") -> str:
    """
    将捏脸参数 JSON 组合为 ComfyUI 正向提示词。
    
    params 结构:
    {
      "face": {"face_shape": "oval", "cheekbone_height": 0.5, ...},
      "eyes": {"eye_shape": "almond", ...},
      "hair": {"hair_style": "long_straight", ...},
      "style": {"art_style": "realistic", ...},
      "body": {"clothing": "casual", ...}
    }
    
    返回: 英文提示词字符串
    """
    segments = {
        "subject": [],   # 主体描述
        "face": [],      # 面部特征
        "eyes": [],      # 眼部
        "hair": [],      # 发型发色
        "style": [],     # 风格光照背景
        "pose": [],      # 姿态服饰
        "quality": [],   # 画质增强词
    }

    # --- 遍历所有参数组 ---
    for group_key, group_def in PARAM_SCHEMA.items():
        group_params = params.get(group_key, {})
        for param_key, param_def in group_def["params"].items():
            val = group_params.get(param_key, param_def["default"])

            if param_def["type"] == "select":
                prompt = param_def.get("prompt_map", {}).get(val, "")
                if prompt:
                    if group_key == "style":
                        segments["style"].append(prompt)
                    elif group_key == "body":
                        segments["pose"].append(prompt)
                    elif group_key == "hair":
                        segments["hair"].append(prompt)
                    elif group_key == "eyes":
                        segments["eyes"].append(prompt)
                    else:
                        segments["face"].append(prompt)

            elif param_def["type"] == "slider":
                prefix_map = param_def.get("prompt_prefix")
                if prefix_map:
                    # 找最接近的阈值
                    thresholds = sorted(prefix_map.keys(), key=float)
                    best = thresholds[0]
                    for t in thresholds:
                        if float(t) <= val:
                            best = t
                    prompt = prefix_map[best]
                    if prompt and group_key == "eyes" and "eye" in param_key:
                        segments["eyes"].append(prompt)
                    elif prompt:
                        segments["face"].append(prompt)

            elif param_def["type"] == "color":
                choices = param_def.get("prompt_choices", {})
                # 精确匹配色值
                prompt = choices.get(val)
                if prompt:
                    if group_key == "hair" and "hair_color" == param_key:
                        segments["hair"].append(prompt)
                    elif group_key == "eyes" and "eye_color" == param_key:
                        segments["eyes"].append(prompt)

    # --- 组装最终提示词 ---
    subject = "portrait of one person"
    face_text = ", ".join(segments["face"]) if segments["face"] else ""
    eyes_text = ", ".join(segments["eyes"]) if segments["eyes"] else ""
    hair_text = ", ".join(segments["hair"]) if segments["hair"] else ""

    # 风格段是完整描述，直接拼接
    style_parts = segments["style"]
    pose_text = ", ".join(segments["pose"]) if segments["pose"] else ""

    # 质量增强词
    quality = ", ".join(segments["quality"])
    if not quality:
        quality = "best quality, masterpiece, sharp focus"

    # 构建
    parts = [subject]
    if face_text:
        parts.append(face_text)
    if eyes_text:
        parts.append(eyes_text)
    if hair_text:
        parts.append(hair_text)
    if style_parts:
        parts.extend(style_parts)
    if pose_text:
        parts.append(pose_text)
    parts.append(quality)

    return ", ".join(parts)


def params_to_summary(params: dict) -> str:
    """生成参数摘要（中文），用于生成历史展示。"""
    summary_parts = []
    for group_key in ["face", "eyes", "hair", "style", "body"]:
        group_def = PARAM_SCHEMA.get(group_key, {})
        group_params = params.get(group_key, {})
        for param_key, param_def in group_def.get("params", {}).items():
            val = group_params.get(param_key, param_def.get("default"))
            if param_def["type"] == "select":
                for opt in param_def.get("options", []):
                    if opt["value"] == val:
                        summary_parts.append(f"{param_def['label']}:{opt['label']}")
                        break
    return " · ".join(summary_parts[:8])


def get_default_params() -> dict:
    """获取所有参数的默认值。"""
    defaults = {}
    for group_key, group_def in PARAM_SCHEMA.items():
        defaults[group_key] = {}
        for param_key, param_def in group_def["params"].items():
            defaults[group_key][param_key] = param_def["default"]
    return defaults


def get_param_labels() -> dict:
    """获取参数的扁平化中文标签映射（用于前端展示）。"""
    labels = {}
    for group_key, group_def in PARAM_SCHEMA.items():
        labels[group_key] = group_def["label"]
    return labels
