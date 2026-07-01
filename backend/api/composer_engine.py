"""
共享组装引擎 — 提取自 seedance_v2.py，供 v2 和 v3 组装器共用
Phase 14.1: 从 seedance_v2.py 提取 6 个核心函数 + 2 个映射表
Phase 16: 集成 atom_asset_library 智能原子填充
"""
import re

# ==================== 分辨率映射表 ====================
RESOLUTION_MAP = {
    "1080p": (1920, 1080), "2K": (2560, 1440), "4K": (3840, 2160),
    "6K": (5760, 3240), "8K": (7680, 4320),
}
ASPECT_MAX_MAP = {
    "16:9": 2160, "9:16": 2160, "1:1": 2160, "21:9": 2160,
    "2.35:1": 2160, "4:3": 2160, "3:4": 2160, "3:2": 2160, "2:3": 2160,
}

AR_LABEL = {
    "16:9": "横屏", "9:16": "竖屏", "1:1": "方形",
    "21:9": "超宽", "2.35:1": "电影宽屏", "4:3": "方屏", "3:4": "竖屏3:4"
}


def _calc_pixel_res(ar: str, res: str) -> str:
    """计算画幅像素分辨率 e.g. 16:9 4K -> 3840x2160, 9:16 4K -> 2160x3840"""
    base_w, base_h = RESOLUTION_MAP.get(res, (1920, 1080))
    w_ratio, h_ratio = map(int, ar.split(":"))
    base_short = min(base_w, base_h)
    if w_ratio >= h_ratio:
        h = base_short
        w = int(h * w_ratio / h_ratio)
    else:
        w = base_short
        h = int(w * h_ratio / w_ratio)
    return f"{w}x{h}"


def _pick_non_empty(d: dict, keys: list) -> str:
    """拼接非空字段（排除纯空白值）"""
    vals = [d.get(k) for k in keys if d.get(k) and str(d.get(k)).strip()]
    return "，".join(vals) if vals else ""


def make_structured_description(scene_data: dict, density: str) -> str:
    """将镜头维度字段拼接为自然语言描述（按标准公式）
    
    拼接公式（行业标准）：
    运镜 → 主体 → 动作 → 场景 → 构图 → 光影 → 焦段 → 质感 → 速率 → 氛围 → 特效 → 细节
  
    密度:
      compact  = 运镜+主体+场景 (Sora/Kling 模式，简洁有力)
      standard = 运镜+主体+动作+场景+构图+光影+氛围 (Midjourney/Seedance)
      detailed = 全部维度 (ComfyUI/专业后期排错用)
    """
    d = scene_data
    parts = []

    # Layer 1: 运镜（所有密度）
    if d.get("camera_move", "").strip():
        parts.append(d["camera_move"])

    # Layer 2: 主体（所有密度）
    if d.get("subject", "").strip():
        parts.append(d["subject"])

    # Layer 3: 动作 (standard+)
    if d.get("action", "").strip() and density != "compact":
        parts.append(d["action"])

    # Layer 4: 场景 (所有密度)
    if d.get("scene_desc", "").strip():
        parts.append(d["scene_desc"])

    # Layer 5: 构图 (standard+)
    if d.get("composition", "").strip() and density != "compact":
        parts.append(d["composition"])

    # Layer 6: 光影 (standard+)
    if d.get("lighting", "").strip() and density != "compact":
        parts.append(d["lighting"])

    # Layer 7: 焦段 (detailed only)
    if d.get("focal_length", "").strip() and density == "detailed":
        parts.append(d["focal_length"])

    # Layer 8: 质感 (detailed only)
    if d.get("texture", "").strip() and density == "detailed":
        parts.append(d["texture"])

    # Layer 9: 速率 (detailed only)
    if d.get("speed", "").strip() and density == "detailed":
        parts.append(d["speed"])

    # Layer 10: 氛围组 (standard+)
    if density != "compact":
        mood = _pick_non_empty(d, ["emotion", "color_grade", "weather"])
        if mood and mood.strip():
            parts.append(mood)

    # Layer 11: 特效组 (detailed only)
    if density == "detailed":
        fx = _pick_non_empty(d, ["particles", "natural_force", "fantasy_physics", "filter"])
        if fx:
            parts.append(fx)

    # Layer 12: 细节组 (detailed only)
    if density == "detailed":
        detail = _pick_non_empty(d, ["perspective", "depth_of_field", "environment_detail",
                                      "film_flaw", "details"])
        if detail:
            parts.append(detail)

    return "，".join(p for p in parts if p.strip())


def fmt_header(proj: dict, fmt: str) -> str:
    """按目标平台格式生成全局头部"""
    ar = proj.get("aspect_ratio", "16:9")
    res = proj.get("resolution", "4K")
    dur = int(proj.get("total_duration", 15))
    style = proj.get("global_style", "")
    transition = proj.get("global_transition", "")
    neg = proj.get("negative_prompt", "")
    pix = _calc_pixel_res(ar, res)

    ar_label = AR_LABEL.get(ar, ar)

    if fmt == "kling":
        line = f"{ar_label}{res} 视频 {dur}s"
        if style:
            line += f" {style}"
        return line

    elif fmt == "minimax":
        line = f"{ar_label}_{res}_{pix}_{dur}s"
        if style:
            line += f", {style}"
        return line

    elif fmt == "comfyui":
        line = f"resolution={pix}, duration={dur}s, fps=24"
        if style:
            line += f", style={style}"
        return line

    elif fmt == "raw":
        return ""

    else:  # seedance (default)
        parts = [f"{ar_label}{res} ({pix})"]
        if style:
            parts.append(style)
        parts.append(f"{dur}s")
        if transition:
            parts.append(transition)
        return "，".join(parts)


def fmt_scene(shot: int, start: float, end: float, desc: str, sc: dict, fmt: str) -> str:
    """按目标平台格式生成单个镜头行"""
    st, et = int(start), int(end)
    dur = round(end - start, 1)

    if fmt == "kling":
        return f"Shot{shot}[{st}s-{et}s]({dur}s): {desc}"
    elif fmt == "minimax":
        return f"[{st}-{et}]({dur}s) {desc}"
    elif fmt == "comfyui":
        fields = []
        if sc.get("camera_move"):
            fields.append(f"camera:{sc['camera_move']}")
        fields.append(f"desc:{desc}")
        return f"frame{shot}[{st}-{et}]: {'; '.join(fields)}"
    elif fmt == "raw":
        return desc
    else:  # seedance
        return f"{st}-{et}s：{desc}"


def compose_full(scenes: list, proj: dict, fmt: str = "seedance",
                 density: str = "standard", include_audio: bool = False,
                 db=None) -> dict:
    """
    完整组装引擎 — 输入镜头列表和项目信息，输出多格式提示词
    
    参数:
      scenes: list of scene dicts (from user_project_scene)
      proj: project dict (from user_project)
      fmt: seedance|kling|minimax|comfyui|raw
      density: compact|standard|detailed
      include_audio: 是否包含音频信息
      db: 数据库连接（音频需要查角色表）
    
    返回:
      dict with text, json, shot_count, pixel_res, format, density, duration, length
    """
    if not scenes:
        return {"text": "", "json": {}, "error": "无镜头数据"}

    ar = proj.get("aspect_ratio", "16:9")
    res = proj.get("resolution", "4K")
    duration = int(proj.get("total_duration", 15))
    pix = _calc_pixel_res(ar, res)
    header_line = fmt_header(proj, fmt)

    scene_lines = []
    json_scenes = []
    all_negatives = []

    for sc in scenes:
        scd = dict(sc)
        st = float(scd.get("start_time", 0))
        et = float(scd.get("end_time", st + 1))
        char_info = None  # 初始化为 None，供后续 json_scenes 引用

        scene_desc = make_structured_description(scd, density)

        # ===== Phase16 角色注入：有 character_id 时，自动填充原子化词卡 =====
        char_id_for_visual = scd.get("character_id")
        if char_id_for_visual and db:
            try:
                char_vis = db.execute(
                    "SELECT id, name, appearance, personality, age_range, gender, occupation "
                    "FROM character_profiles WHERE id=?", [char_id_for_visual]
                ).fetchone()
                if char_vis:
                    char_vis = dict(char_vis)
                    char_inject = []
                    cname = (char_vis["name"] or "").strip()
                    capp = (char_vis["appearance"] or "").strip()
                    cp = (char_vis["personality"] or "").strip()
                    cocc = (char_vis["occupation"] or "").strip()
                    cage = (char_vis["age_range"] or "").strip()
                    cgend = (char_vis["gender"] or "").strip()

                    # Phase16: 从原子库智能填充关联词卡
                    media_cat = "image" if scd.get("media_type", "image") == "image" else "video"
                    atom_fill = _fill_atoms_from_library(char_vis=char_vis, db=db,
                                                         media_category=media_cat, limit=5)
                    if atom_fill:
                        char_inject.extend(atom_fill[:3])

                    # 主体描述优先用 appearance
                    if capp:
                        char_inject.append(capp)
                    else:
                        if cgend: char_inject.append(cgend)
                        if cage: char_inject.append(cage)
                        if cp: char_inject.append(cp)
                    if cocc: char_inject.append(cocc)
                    if cname: char_inject.append(cname)
                    if char_inject:
                        char_text = "，".join(char_inject)
                        if scene_desc:
                            scene_desc = scene_desc + "，" + char_text
                        else:
                            scene_desc = char_text
            except Exception:
                pass

        # 音频四要素
        if include_audio and scd.get("audio_enabled"):
            audio_parts = []
            char_id = scd.get("character_id")
            char_info = None
            if char_id and db:
                char_info = db.execute(
                    "SELECT name, voice_type, voice_detail, narration_style, personality "
                    "FROM character_profiles WHERE id=?", [char_id]
                ).fetchone()

            if char_info:
                char_name = char_info["name"] or ""
                voice_text = char_info["voice_type"] or ""
                if char_info["voice_detail"]:
                    voice_text += "，" + char_info["voice_detail"]
                if char_name and voice_text:
                    audio_parts.append(f"[角色:{char_name}({voice_text})]")
                elif char_name:
                    audio_parts.append(f"[角色:{char_name}]")
                narr = char_info["narration_style"] or ""
                if narr:
                    audio_parts.append(f"[旁白:{narr}]")
            else:
                cv = scd.get("character_voice") or scd.get("narration") or ""
                if cv:
                    audio_parts.append(f"[角色旁白:{cv}]")

            bm = scd.get("bgm") or ""
            sf = scd.get("sfx") or ""
            if bm:
                audio_parts.append(f"[BGM:{bm}]")
            if sf:
                audio_parts.append(f"[音效:{sf}]")
            if audio_parts:
                scene_desc = scene_desc + " (" + ", ".join(audio_parts) + ")" if scene_desc else ", ".join(audio_parts)

        shot_neg = scd.get("details") or ""
        if shot_neg and shot_neg.startswith("--neg"):
            all_negatives.append(shot_neg.replace("--neg", "").strip())
            shot_neg = ""

        if scene_desc:
            scene_lines.append(
                fmt_scene(scd.get("scene_order", len(scene_lines) + 1),
                          st, et, scene_desc, scd, fmt)
            )

        json_scenes.append({
            "shot": scd.get("scene_order", len(json_scenes) + 1),
            "start": st,
            "end": et,
            "duration": round(et - st, 1),
            "text": scene_desc,
            "negative": shot_neg,
            "audio": {
                "character_voice": scd.get("character_voice") or scd.get("narration") or "",
                "bgm": scd.get("bgm") or "",
                "sfx": scd.get("sfx") or "",
                "enabled": bool(scd.get("audio_enabled")),
                "character_id": scd.get("character_id"),
                "character_name": char_info["name"] if char_info else None,
            } if include_audio else None,
            "fields": {
                "camera_move": scd.get("camera_move") or "",
                "subject": scd.get("subject") or "",
                "action": scd.get("action") or "",
                "scene": scd.get("scene_desc") or "",
                "composition": scd.get("composition") or "",
                "lighting": scd.get("lighting") or "",
                "focal_length": scd.get("focal_length") or "",
                "texture": scd.get("texture") or "",
                "speed": scd.get("speed") or "",
                "emotion": scd.get("emotion") or "",
                "color_grade": scd.get("color_grade") or "",
                "weather": scd.get("weather") or "",
                "particles": scd.get("particles") or "",
                "perspective": scd.get("perspective") or "",
                "depth_of_field": scd.get("depth_of_field") or "",
                "environment_detail": scd.get("environment_detail") or "",
                "film_flaw": scd.get("film_flaw") or "",
                "fantasy_physics": scd.get("fantasy_physics") or "",
            }
        })

    global_neg = proj.get("negative_prompt", "")
    all_neg = []
    if global_neg:
        all_neg.append(global_neg)
    all_neg.extend(all_negatives)
    neg_line = "，".join(all_neg) if all_neg else ""

    full_lines = []
    if header_line:
        full_lines.append(header_line)
    if full_lines and scene_lines:
        full_lines.append("")
    full_lines.extend(scene_lines)
    if neg_line:
        full_lines.append("")
        full_lines.append(f"负面：{neg_line}")

    full_text = "\n".join(full_lines).strip()

    json_output = {
        "meta": {
            "format": fmt,
            "density": density,
            "pixel_res": pix,
            "fps": 24,
        },
        "global": {
            "aspect_ratio": ar,
            "resolution": res,
            "pixel_width": int(pix.split("x")[0]) if "x" in pix else 0,
            "pixel_height": int(pix.split("x")[1]) if "x" in pix else 0,
            "duration": duration,
            "style": proj.get("global_style", ""),
            "transition": proj.get("global_transition", ""),
            "negative": neg_line,
        },
        "shots": json_scenes,
        "full_text": full_text,
    }

    return {
        "text": full_text,
        "json": json_output,
        "length": len(full_text),
        "shot_count": len(scenes),
        "duration": duration,
        "format": fmt,
        "density": density,
        "pixel_res": pix,
    }

# ==================== Phase16-v5.2.0: 原子化词库智能填充 ====================

def _fill_atoms_from_library(char_vis=None, scene_id=None, db=None,
                             media_category="image", limit=8):
    """Phase16: 从 atom_asset_library 智能填充原子词卡"""
    import re
    if not db:
        return []
    keywords = []
    linked_type = None
    linked_id = None

    if char_vis:
        appearance = (char_vis.get("appearance") or "").strip()
        personality = (char_vis.get("personality") or "").strip()
        occupation = (char_vis.get("occupation") or "").strip()
        desc = f"{appearance} {personality} {occupation}"
        keywords.extend(re.findall(r'[\u4e00-\u9fff]{2,}', desc))
        linked_type = "character"
        linked_id = char_vis.get("id")
    elif scene_id:
        linked_type = "scene"
        linked_id = scene_id

    if not keywords and not linked_type:
        return []

    stop_words = {"一个","一种","这是","就是","可以","非常","特别","比较","没有","什么","这个","那个"}
    keywords = [w for w in set(keywords) if w not in stop_words][:8]

    conditions = ["is_active=1"]
    params = []
    if linked_type:
        conditions.append("linked_type=?")
        params.append(linked_type)
    if linked_id:
        conditions.append("linked_id=?")
        params.append(linked_id)
    if media_category:
        conditions.append("(media_category=? OR media_category='both')")
        params.append(media_category)

    kw_conds = []
    for kw in keywords:
        if len(kw) >= 2:
            kw_conds.append("atom_text LIKE ?")
            params.append(f"%{kw}%")
    if kw_conds:
        conditions.append(f"({' OR '.join(kw_conds)})")
    elif not linked_id:
        return []

    where = " AND ".join(conditions)
    params.append(limit * 2)
    try:
        rows = db.execute(
            f"SELECT atom_text, usage_count FROM atom_asset_library WHERE {where} ORDER BY usage_count DESC, combo_count DESC LIMIT ?",
            params
        ).fetchall()
        seen = set()
        result = []
        for r in rows:
            text = (r["atom_text"] or "").strip()
            if text and text not in seen:
                seen.add(text)
                result.append(text)
        return result[:limit]
    except Exception:
        return []


def _fill_atoms_by_character(char_vis, db):
    """Phase16: 角色->原子库查询"""
    return _fill_atoms_from_library(char_vis=char_vis, db=db, media_category="image")