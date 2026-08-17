# -*- coding: utf-8 -*-
"""投稿前本地视频质检服务（v5.40.0 P1）
ffprobe 解析：时长/分辨率/编码/大小/fps → 规则校验 → 质检报告
纯本地进程调用（ffprobe/ffmpeg），无外部网络请求
"""
import json
import os
import re
import shutil
import subprocess

# 质检规则（光厂投稿要求）
RULES = {
    "min_duration_s": 5,        # 最短时长（秒）
    "max_duration_s": 900,      # 最长时长（15 分钟）
    "min_width": 1280,          # 最小宽度（720p）
    "min_height": 720,          # 最小高度
    "max_size_mb": 2048,        # 最大文件大小（2GB）
    "min_fps": 12,              # 最低帧率
    "allowed_codecs": ["h264", "hevc", "avc1"],  # 编码白名单（hevc 兼容性警告）
}


def _find_ffprobe():
    """探测 ffprobe 可执行路径（PATH + 常见安装位置 + Topaz 自带）"""
    candidates = [
        "ffprobe",
        r"C:\Program Files\Topaz Labs LLC\Topaz Video AI\ffprobe.exe",
        r"C:\ffmpeg\bin\ffprobe.exe",
        r"C:\Program Files\ffmpeg\bin\ffprobe.exe",
        r"C:\Users\admin\ffmpeg\bin\ffprobe.exe",
    ]
    for c in candidates:
        try:
            if os.path.isfile(c):
                return c
            w = shutil.which(c)
            if w:
                return w
        except Exception:
            pass
    # ImageMagick 目录（PATH 里 ffmpeg 所在，可能带 ffprobe）
    ff = shutil.which("ffmpeg")
    if ff:
        p = os.path.join(os.path.dirname(ff), "ffprobe.exe")
        if os.path.isfile(p):
            return p
    return None


def _probe_with_ffmpeg(path: str) -> dict:
    """无 ffprobe 时降级：用 ffmpeg -i 解析 Duration/Video 行"""
    try:
        proc = subprocess.run(["ffmpeg", "-i", path], capture_output=True, timeout=60)
        txt = (proc.stderr or b"").decode("utf-8", "replace")
        duration = 0.0
        width = height = 0
        codec = ""
        m = re.search(r"Duration: (\d+):(\d+):(\d+\.?\d*)", txt)
        if m:
            duration = int(m.group(1)) * 3600 + int(m.group(2)) * 60 + float(m.group(3))
        m = re.search(r"Video: (\w+)[^,]*,\s*(\d+)x(\d+)", txt)
        if m:
            codec, width, height = m.group(1), int(m.group(2)), int(m.group(3))
        return {"duration": round(duration, 2), "width": width, "height": height,
                "codec": codec, "fps": 0.0, "size_mb": round(os.path.getsize(path) / 1048576, 1)}
    except Exception as e:
        return {"error": f"ffmpeg 解析异常: {e}"}


def probe_video(path: str) -> dict:
    """ffprobe 解析视频元数据（找不到 ffprobe 时降级 ffmpeg -i）；失败返回 error"""
    if not os.path.isfile(path):
        return {"error": "文件不存在"}
    size = os.path.getsize(path)
    ffprobe = _find_ffprobe()
    if not ffprobe:
        r = _probe_with_ffmpeg(path)
        if "error" not in r:
            return r
        return {"error": r["error"]}
    try:
        proc = subprocess.run(
            [ffprobe, "-v", "quiet", "-print_format", "json",
             "-show_format", "-show_streams", path],
            capture_output=True, timeout=60)
        if proc.returncode != 0:
            r = _probe_with_ffmpeg(path)
            if "error" not in r:
                return r
            return {"error": f"ffprobe 解析失败: {proc.stderr.decode('utf-8', 'replace')[:200]}"}
        data = json.loads(proc.stdout.decode("utf-8", "replace"))
    except subprocess.TimeoutExpired:
        return {"error": "ffprobe 超时"}
    except Exception as e:
        return {"error": f"ffprobe 异常: {e}"}

    duration = 0.0
    width = height = 0
    codec = ""
    fps = 0.0
    for st in data.get("streams", []):
        if st.get("codec_type") == "video":
            codec = st.get("codec_name") or ""
            width = int(st.get("width") or 0)
            height = int(st.get("height") or 0)
            r = st.get("avg_frame_rate") or st.get("r_frame_rate") or "0/1"
            try:
                num, den = r.split("/")
                fps = float(num) / float(den) if float(den) else 0.0
            except Exception:
                fps = 0.0
            break
    if not duration:
        duration = float(data.get("format", {}).get("duration") or 0)

    return {"duration": round(duration, 2), "width": width, "height": height,
            "codec": codec, "fps": round(fps, 2), "size_mb": round(size / 1048576, 1)}


def check_video(path: str) -> dict:
    """质检：返回 {ok, metrics, issues:[{level,code,msg}]}"""
    m = probe_video(path)
    if "error" in m:
        # v5.41.2: service_error 区分「服务不可用」与「质检不通过」
        return {"ok": False, "service_error": True, "metrics": {},
                "issues": [{"level": "error", "code": "probe_fail", "msg": m["error"]}]}
    issues = []
    d = m["duration"]
    if d < RULES["min_duration_s"]:
        issues.append({"level": "error", "code": "duration_short",
                       "msg": f"时长 {d}s 不足 {RULES['min_duration_s']}s（光厂要求 ≥5s）"})
    elif d > RULES["max_duration_s"]:
        issues.append({"level": "error", "code": "duration_long",
                       "msg": f"时长 {d}s 超 {RULES['max_duration_s']}s（建议 ≤15 分钟）"})
    if m["width"] < RULES["min_width"] or m["height"] < RULES["min_height"]:
        issues.append({"level": "error", "code": "resolution_low",
                       "msg": f"分辨率 {m['width']}x{m['height']} 低于 720p（1280x720）"})
    if m["codec"] not in RULES["allowed_codecs"]:
        if m["codec"]:
            issues.append({"level": "warning", "code": "codec_unsupported",
                           "msg": f"编码 {m['codec']} 非 H.264（兼容性风险，建议转码）"})
        else:
            issues.append({"level": "error", "code": "codec_unknown", "msg": "无法识别视频编码"})
    if m["fps"] and m["fps"] < RULES["min_fps"]:
        issues.append({"level": "warning", "code": "fps_low", "msg": f"帧率 {m['fps']} 低于 {RULES['min_fps']}fps"})
    if m["size_mb"] > RULES["max_size_mb"]:
        issues.append({"level": "error", "code": "size_large", "msg": f"文件 {m['size_mb']}MB 超 2GB"})
    has_error = any(i["level"] == "error" for i in issues)
    return {"ok": not has_error, "metrics": m, "issues": issues}
