"""
API 路由 — Seedance V2 多镜头结构化组装器 (全功能版)
27套维度词库 / 分镜项目CRUD / 镜头管理 / 拼接引擎 / 联动
"""

from fastapi import APIRouter, Body, HTTPException

from database import get_db, safe_commit

router = APIRouter(prefix="/api/seedance/v2", tags=["seedance-v2"])

# Phase 3.5: library/project 子路由（同 prefix 挂载）
from api.seedance_v2_library import router as seedance_v2_library_router
from api.seedance_v2_project import router as seedance_v2_project_router
# v5.36.0: 即梦视频生成任务子路由
from api.seedance_v2_video import router as seedance_v2_video_router
# v5.36.2: 图像参考子路由（全局/镜头级角色图·场景图）
from api.seedance_v2_refs import router as seedance_v2_refs_router

router.include_router(seedance_v2_library_router)
router.include_router(seedance_v2_project_router)
router.include_router(seedance_v2_video_router)
router.include_router(seedance_v2_refs_router)
from api.seedance_v2_project import _recalculate_scene_times  # noqa: F401

# ==================== 反向解析（文本→结构化） ====================

@router.post("/parse")
def parse_prompt(data: dict = Body(...)):
    """
    将已有的纯文本提示词 反向解析为结构化镜头数据
    用于从已有的Seedance提示词导入到编辑器
    """
    text = data.get("text", "")
    if not text:
        raise HTTPException(400, "text 必填")

    lines = text.strip().split("\n")
    result = {
        "global": {"style": "", "duration": 15, "aspect_ratio": "16:9", "resolution": "4K", "transition": "", "negative": ""},
        "shots": [],
        "unparsed": []
    }

    # 简单解析: 第一行非空为全局头部
    # 带"负面"的为尾部
    # 中间每行匹配 "数字-数字s：" 格式为镜头
    shot_lines = []
    after_negative = False
    neg_parts = []

    for line in lines:
        stripped = line.strip()
        if not stripped:
            continue

        # 负面提示
        if "负面" in stripped or "negative" in stripped.lower():
            after_negative = True
            # 提取负面内容
            neg_text = stripped.split("：")[-1] if "：" in stripped else stripped.split(":")[-1] if ":" in stripped else ""
            if neg_text:
                neg_parts.append(neg_text.strip())
            continue

        if after_negative:
            continue

        # 尝试匹配镜头时间戳
        import re
        match = re.match(r"(\d+)[-~](\d+)s?[：:]\s*(.*)", stripped)
        if match:
            st = int(match.group(1))
            et = int(match.group(2))
            desc = match.group(3).strip()
            shot_lines.append({"start": st, "end": et, "text": desc})
        elif not result["global"]["style"]:
            # 第一个非空非镜头行作为全局风格
            result["global"]["style"] = stripped
            # 尝试提取画幅和时长
            if "16:9" in stripped:
                result["global"]["aspect_ratio"] = "16:9"
            elif "9:16" in stripped:
                result["global"]["aspect_ratio"] = "9:16"
            elif "1:1" in stripped:
                result["global"]["aspect_ratio"] = "1:1"
            elif "2.35" in stripped:
                result["global"]["aspect_ratio"] = "2.35:1"

            dur_match = re.search(r"(\d+)s", stripped)
            if dur_match:
                result["global"]["duration"] = int(dur_match.group(1))

            if "4K" in stripped:
                result["global"]["resolution"] = "4K"
            elif "8K" in stripped:
                result["global"]["resolution"] = "8K"
        else:
            result["unparsed"].append(stripped)

    if neg_parts:
        result["global"]["negative"] = "，".join(neg_parts)

    # 尝试进一步拆解镜头描述
    dim_keywords = {
        "camera_move": ["推镜头", "拉镜头", "摇镜头", "移镜头", "跟镜头", "升降", "环绕", "滑动变焦", "手持", "固定", "俯视", "穿越机", "FPV", "dolly", "pan", "tracking", "orbit"],
        "composition": ["特写", "中景", "远景", "全景", "俯拍", "仰拍", "斜角", "对称", "三分法", "引导线", "框架", "第一人称", "POV", "过肩", "OTS"],
        "lighting": ["逆光", "侧光", "顺光", "顶光", "漫射", "聚光", "霓虹", "烛光", "月光", "硬光", "柔光", "晨光", "黄昏", "金色"],
        "speed": ["慢动作", "升格", "慢放", "快进", "延时", "timelapse", "slow motion"],
        "emotion": ["治愈", "紧张", "悬疑", "浪漫", "悲伤", "孤独", "热血", "神秘", "幽默", "安静", "温馨", "清冷"],
        "weather": ["晴朗", "细雨", "暴雨", "晨雾", "黄昏", "暴风雪", "雷雨", "彩虹", "雪", "雨", "雾"],
    }

    for sl in shot_lines:
        fields = {}
        desc = sl["text"]
        for dim, keywords in dim_keywords.items():
            for kw in keywords:
                if kw in desc:
                    fields[dim] = kw
                    break
        sl["fields"] = fields

    result["shots"] = shot_lines
    return {"ok": True, "result": result}


# ==================== 智能模版导入（词卡匹配+自动创建词卡+拆镜填充） ====================

@router.post("/import-from-template")
def import_from_template(data: dict = Body(...)):
    """
    智能模版导入：取一条场景模版→解析时间轴→多镜头拆分→
    词库维度匹配→自动创建自定义词卡→创建项目并填充镜头字段
    """
    tpl_id = data.get("template_id")
    if not tpl_id:
        raise HTTPException(400, "template_id 必填")

    db = get_db()
    row = db.execute("SELECT * FROM prompts WHERE id=? AND module='seedance'", [tpl_id]).fetchone()
    if not row:
        raise HTTPException(404, "模版不存在")

    tpl_content = row["content"] or ""
    tpl_meaning = row["meaning"] or ""
    tpl_category = row["category"] or "Seedance"
    # ── 1. 解析模版文本 ──
    lines = tpl_content.strip().split("\n")
    global_style = ""
    global_aspect = "16:9"
    global_resolution = "4K"
    global_duration = 15
    global_negative = ""
    global_transition = ""
    shots_raw = []  # [{start, end, desc}]
    extra_lines = []
    in_negative = False
    negative_lines = []

    import re
    for line in lines:
        s = line.strip()
        if not s:
            continue

        # 负面提示词区域
        if re.search(r"负面|negative", s, re.IGNORECASE):
            in_negative = True
            t = re.split(r"[：:]", s, maxsplit=1)
            if len(t) > 1 and t[1].strip():
                negative_lines.append(t[1].strip())
            continue
        if in_negative:
            negative_lines.append(s)
            continue

        # 全局元数据行（风格/画幅/时长）
        if re.match(r"^【.*】$", s):
            inner = s[1:-1]
            if not global_style:
                global_style = inner[:80]
            # 提取数字元素
            dur_m = re.search(r"(\d+)秒", inner)
            if dur_m:
                global_duration = int(dur_m.group(1))
            for ratio in ["2.35:1","21:9","16:9","9:16","1:1","4:3","3:4"]:
                if ratio in inner:
                    global_aspect = ratio if ratio != "2.35:1" else "21:9"
                    break
            for res in ["8K","6K","4K","2K","1080p","720p"]:
                if res in inner:
                    global_resolution = res
                    break
            continue

        # 时间轴镜头行: "0-3秒：xxx" / "0-3s: xxx"
        shot_m = re.match(r"(\d+)[-~](\d+)\s*秒?[：:]\s*(.+)", s)
        if shot_m:
            shots_raw.append({
                "start": int(shot_m.group(1)),
                "end": int(shot_m.group(2)),
                "desc": shot_m.group(3).strip()
            })
            continue

        # 英文冒号格式
        shot_m2 = re.match(r"(\d+)[-~](\d+)s?\s*:\s*(.+)", s)
        if shot_m2:
            shots_raw.append({
                "start": int(shot_m2.group(1)),
                "end": int(shot_m2.group(2)),
                "desc": shot_m2.group(3).strip()
            })
            continue

        # 纯数字间隔: "0-3s 开场"
        shot_m3 = re.match(r"(\d+)[-~](\d+)s?\s+(.+)", s)
        if shot_m3:
            shots_raw.append({
                "start": int(shot_m3.group(1)),
                "end": int(shot_m3.group(2)),
                "desc": shot_m3.group(3).strip()
            })
            continue

        # 非结构行存为额外提示
        extra_lines.append(s)

    if negative_lines:
        global_negative = "，".join(negative_lines)

    if not global_style:
        global_style = tpl_category

    # 如果没有解析出镜头，整段作为单镜头
    if not shots_raw and tpl_content.strip():
        shots_raw = [{"start": 0, "end": global_duration, "desc": tpl_content.strip()[:500]}]

    # ── 2. 加载词库全维度的词卡索引 ──
    all_libs = db.execute("SELECT * FROM prompt_library ORDER BY sort_order").fetchall()
    dim_cards = {}  # {dimension_key: [{id, word, definition, heat_weight}]}
    dim_lib_id = {}  # {dimension_key: library_id}
    for lib in all_libs:
        lk = lib["dimension_key"]
        cards = db.execute(
            "SELECT id, word_text, definition, heat_weight, usage_count FROM prompt_word_card WHERE library_id=?",
            [lib["id"]]
        ).fetchall()
        dim_cards[lk] = [dict(c) for c in cards]
        dim_lib_id[lk] = lib["id"]

    # ── 3. 每镜头匹配词卡 ──
    def _match_dim(desc, dim_key, cards):
        """在描述文本中匹配维度词卡
        策略: ①纯中文部分精确/子串匹配 ②2-gram交叉命中 ③拆词反向匹配"""
        matched = []
        desc_no_punc = re.sub(r"[，。、；：！？\s·""''「」『』【】（）\\-]+", "", desc)

        for card in cards:
            raw = (card["word_text"] or "").strip()
            if not raw or len(raw) < 1:
                continue

            # 提取纯中文核心词(去掉英文标注)
            cn_core = re.sub(r"[a-zA-Z0-9]+", "", raw).strip()
            if not cn_core:
                cn_core = raw

            score = 0

            # ① 精确匹配: 完整词卡文本出现在描述中
            if raw in desc:
                score = 10

            # ② 中文核心词完全匹配: cn_core 是 desc_no_punc 的子串
            elif len(cn_core) >= 1 and cn_core in desc_no_punc:
                score = min(10, 4 + len(cn_core))

            # ③ 中文词拆为2~3字短语分别匹配(如"中景构图"→"中景"+"构图")
            if score == 0 and len(cn_core) >= 2:
                sub_hits = 0
                # 生成所有2-3字连续子串
                sub_parts = []
                for length in (3, 2):
                    for i in range(len(cn_core) - length + 1):
                        sub_parts.append(cn_core[i:i+length])
                for sp in set(sub_parts):  # 去重
                    if sp in desc_no_punc:
                        sub_hits += 1
                if sub_hits >= 1:
                    score = min(7, sub_hits * 3 + 1)

            # ④ 2-gram反向匹配: 描述中的短语出现在词卡中
            if score == 0 and len(desc_no_punc) >= 2:
                desc_phrases = set()
                for i in range(len(desc_no_punc) - 1):
                    desc_phrases.add(desc_no_punc[i:i+2])
                card_phrases = set()
                for i in range(len(cn_core) - 1):
                    card_phrases.add(cn_core[i:i+2])
                overlap = len(desc_phrases & card_phrases)
                if overlap >= 2:
                    score = min(5, overlap + 1)

            # ⑤ 英文token匹配: 描述中的英文词出现在词卡中
            if score == 0:
                eng_tokens = re.findall(r"[a-zA-Z]{2,}", desc)
                for tok in eng_tokens:
                    if tok.lower() in raw.lower():
                        score = 6
                        break

            if score > 0:
                matched.append({"card_id": card["id"], "word": raw, "score": score})

        matched.sort(key=lambda x: x["score"], reverse=True)
        seen = set()
        filtered = []
        for m in matched:
            cn = re.sub(r"[a-zA-Z0-9\s]+", "", m["word"]).strip() or m["word"]
            if cn not in seen:
                filtered.append(m)
                seen.add(cn)
        return filtered[:3]

    scene_matches = []  # [{scene_index, dim_matches: {dim_key: [card_ids]}, unmatched_terms: [str]}]

    for si, shot in enumerate(shots_raw):
        desc = shot["desc"]
        dim_result = {}
        all_matched_words = set()

        # 对每个维度尝试匹配
        for dim_key, cards in dim_cards.items():
            # 跳过非镜头级别的全局维度
            if dim_key in ("quality", "art_style", "era", "region", "transition", "sound_effect", "costume", "negative"):
                continue
            ms = _match_dim(desc, dim_key, cards)
            if ms:
                dim_result[dim_key] = [m["card_id"] for m in ms]
                for m in ms:
                    all_matched_words.add(m["word"])

        scene_matches.append({
            "scene_index": si,
            "start": shot["start"],
            "end": shot["end"],
            "desc": desc,
            "dim_matches": dim_result
        })

    # ── 4. 全局维度的匹配（对整个模版） ──
    full_text = tpl_content
    global_matches = {}
    for dim_key in ("quality", "art_style", "era", "region", "transition", "sound_effect", "costume"):
        if dim_key in dim_cards:
            ms = _match_dim(full_text, dim_key, dim_cards[dim_key])
            if ms:
                global_matches[dim_key] = [m["card_id"] for m in ms]
    # 负面
    if global_negative and "negative" in dim_cards:
        ms = _match_dim(global_negative, "negative", dim_cards["negative"])
        if ms:
            global_matches["negative"] = [m["card_id"] for m in ms]

    # ── 5. 创建项目 ──
    cur = db.execute(
        """INSERT INTO user_project
            (name, total_duration, aspect_ratio, resolution,
             global_style, global_transition, negative_prompt, bgm, sfx, dialogue, template_id)
        VALUES (?,?,?,?,?,?,?,?,?,?,?)""",
        [f"模版: {tpl_meaning[:20] or tpl_category}", global_duration, global_aspect, global_resolution,
         global_style, global_transition, global_negative, "", "", "", tpl_id]
    )
    project_id = cur.lastrowid

    # ── 6. 创建镜头并填充字段 ──
    scene_ids = []
    for si, shot in enumerate(shots_raw):
        duration = shot["end"] - shot["start"]
        if duration <= 0:
            duration = 3
        # 组装镜头字段文本
        field_texts = {}
        sm = scene_matches[si]
        for dim_key, card_ids in sm["dim_matches"].items():
            if not card_ids:
                continue
            words = []
            for cid in card_ids:
                # 查找词卡文本
                cards = dim_cards.get(dim_key, [])
                for c in cards:
                    if c["id"] == cid:
                        words.append(c["word_text"])
                        break
            if words:
                field_texts[dim_key] = ", ".join(words)

        sc = db.execute(
            "INSERT INTO user_project_scene (project_id, scene_order, start_time, end_time, duration, scene_desc) VALUES (?,?,?,?,?,?)",
            [project_id, si + 1, float(shot["start"]), float(shot["end"]), float(duration), shot["desc"]]
        )
        scene_id = sc.lastrowid
        scene_ids.append(scene_id)

        # 立即更新镜头字段（填充匹配到的词卡文本），但跳过 scene_desc（已从模版原文写入）
        if field_texts:
            set_parts = []
            values = []
            for k, v in field_texts.items():
                if k == "scene":
                    continue  # scene_desc 已写模版原文，不覆盖
                col = _scene_field_to_db_column(k)
                if col:
                    set_parts.append(f"{col}=?")
                    values.append(v)
            if set_parts:
                db.execute(
                    f"UPDATE user_project_scene SET {', '.join(set_parts)} WHERE id=?",
                    values + [scene_id]
                )

    # 重算时间轴
    _recalculate_scene_times(project_id)
    safe_commit()

    # ── 7. 构建返回 ──
    return {
        "ok": True,
        "project_id": project_id,
        "scene_count": len(shots_raw),
        "scenes": [
            {
                "id": scene_ids[si],
                "start": shot["start"],
                "end": shot["end"],
                "desc": shot["desc"],
                "fields": sm["dim_matches"]
            }
            for si, (shot, sm) in enumerate(zip(shots_raw, scene_matches))
        ],
        "global_style": global_style,
        "global_aspect": global_aspect,
        "global_duration": global_duration,
        "global_matches": global_matches,
        "fields_populated": sum(
            1 for s in scene_matches if s["dim_matches"]
        )
    }


def _scene_field_to_db_column(field_key):
    """前端词卡字段名 → DB 列名映射"""
    mapping = {
        "camera_move": "camera_move",
        "subject": "subject",
        "scene": "scene_desc",
        "composition": "composition",
        "lighting": "lighting",
        "action": "action",
        "focal_length": "focal_length",
        "texture": "texture",
        "speed": "speed",
        "perspective": "perspective",
        "particles": "particles",
        "weather": "weather",
        "color_grade": "color_grade",
        "emotion": "emotion",
        "natural_force": "natural_force",
        "depth_of_field": "depth_of_field",
        "filter": "filter",
        "film_flaw": "film_flaw",
        "fantasy_physics": "fantasy_physics",
        "env_detail": "environment_detail",
        "shot_scale": "shot_scale",
        # v4.0.0-phase10: audio
        "character_voice": "character_voice",
        "audio_bgm": "bgm",
        "audio_sfx": "sfx",
    }
    return mapping.get(field_key)
