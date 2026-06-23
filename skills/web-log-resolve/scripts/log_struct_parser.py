# -*- coding: utf-8 -*-
"""
web-log-resolve / log_struct_parser.py
======================================
报错日志结构化解析模块（能力①）

职责：
  1. 读取原始日志（文件或字符串），按"日志记录"切分（支持多行堆栈聚合）；
  2. 过滤无效冗余打印（可配置丢弃 INFO/DEBUG 噪声）；
  3. 提取标准化字段：时间、级别、故障模块、文件路径、行号、完整堆栈、
     请求入参/返回值、硬件资源（显存/内存/端口）；
  4. 自动生成故障分类标签（fault_tags）。

设计原则：
  - 纯标准库实现，零第三方依赖，不污染本地环境；
  - 既可作为模块 import，也可命令行直接运行；
  - 解析失败永不抛出，降级为 raw 记录，保证管道不中断。
"""

from __future__ import annotations

import json
import re
import sys
from dataclasses import dataclass, field, asdict
from pathlib import Path
from typing import List, Optional

# ── 日志级别识别（覆盖大小写 / uvicorn 风格 "ERROR:" / 中文）──────────
_LEVEL_RE = re.compile(
    r"\b(PANIC|FATAL|CRITICAL|ERROR|ERR|WARNING|WARN|INFO|DEBUG|TRACE)\b",
    re.IGNORECASE,
)
_LEVEL_NORMALIZE = {
    "ERR": "ERROR",
    "WARNING": "WARN",
    "FATAL": "PANIC",
    "CRITICAL": "PANIC",
}

# ── 时间戳识别（ISO / 常见 "YYYY-MM-DD HH:MM:SS"）──────────────────────
_TS_RE = re.compile(r"\b(\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2})\b")

# ── 文件路径 + 行号（Python Traceback / JS stack 两种风格）─────────────
_PY_FRAME_RE = re.compile(r'File "([^"]+)", line (\d+)')
_JS_FRAME_RE = re.compile(r"\(?([\w./\\-]+\.(?:js|vue|ts|jsx|tsx)):(\d+):(\d+)\)?")

# ── HTTP 状态码 ───────────────────────────────────────────────────────
_HTTP_RE = re.compile(r'"\s*(GET|POST|PUT|DELETE|PATCH)\s+([^"]+?)\s+HTTP[^"]*"\s+(\d{3})')
_HTTP_BARE_RE = re.compile(r"\b(status(?: of)?|responded with(?: a status of)?)\s+(\d{3})\b", re.IGNORECASE)

# ── 硬件 / 资源信号 ───────────────────────────────────────────────────
_MEM_RE = re.compile(r"(\d+(?:\.\d+)?)\s*(GiB|GB|MiB|MB)", re.IGNORECASE)
_PORT_RE = re.compile(r"(?:port|地址|address)[^\d]{0,12}(\d{2,5})", re.IGNORECASE)

# ── 故障分类规则表：tag -> 关键词列表（命中即打标）────────────────────
_TAG_RULES = {
    "OOM显存溢出": ["out of memory", "outofmemory", "cuda out of memory", "oom"],
    "KV缓存超限": ["kv cache", "kv缓存"],
    "权重文件损坏": ["safetensor", "deserializing header", "truncated", "header too large"],
    "Tokenizer加载失败": ["tokenizer", "from_pretrained"],
    "多卡通信故障": ["nccl", "allreduce", "processgroup", "rank"],
    "端口占用": ["address already in use", "already in use", "addr in use", "eaddrinuse"],
    "数据库锁": ["database is locked", "operationalerror"],
    "参数校验失败": ["validationerror", "field required", "type=missing", "422"],
    "接口404": ["404", "not found ("],
    "接口500": ["500", "internal server error", "exception in asgi"],
    "JS运行时报错": ["typeerror", "referenceerror", "syntaxerror", "uncaught"],
    "JSON解析失败": ["unexpected token", "is not valid json", "json.parse"],
    "资源加载失败": ["failed to load resource"],
    "推理引擎崩溃": ["engine iteration failed", "asgi application", "vllm", "llm_engine"],
}

# ── 模块归属判定：module -> 关键词 ────────────────────────────────────
_MODULE_RULES = [
    ("前端(Vue/React)", [".vue", ".jsx", ".tsx", "vite", "devtools", "runtime-core", "rendercards", "app_core", "wc_bridge"]),
    ("推理服务", ["cuda", "nccl", "vllm", "ollama", "safetensor", "tokenizer", "kv cache", "llm_engine", "model_runner"]),
    ("后端API", ["asgi", "uvicorn", "traceback", ".py", "sqlite3", "pydantic", "http/1.1"]),
]

# 噪声级别（默认解析全部，但 drop_noise=True 时丢弃）
_NOISE_LEVELS = {"INFO", "DEBUG", "TRACE"}


@dataclass
class LogRecord:
    """单条结构化日志记录"""
    raw: str
    timestamp: Optional[str] = None
    level: str = "UNKNOWN"
    module: str = "未知"
    file_path: Optional[str] = None
    line_no: Optional[int] = None
    http_method: Optional[str] = None
    http_path: Optional[str] = None
    http_status: Optional[int] = None
    stack: List[str] = field(default_factory=list)
    resources: dict = field(default_factory=dict)
    fault_tags: List[str] = field(default_factory=list)
    message: str = ""

    def to_dict(self) -> dict:
        return asdict(self)


def _normalize_level(token: str) -> str:
    t = token.upper()
    return _LEVEL_NORMALIZE.get(t, t)


def _split_blocks(text: str) -> List[List[str]]:
    """将原始日志按"新记录起始行"切块，缩进/Traceback 行归并到上一块。"""
    blocks: List[List[str]] = []
    cur: List[str] = []
    for line in text.splitlines():
        if not line.strip():
            continue
        starts_new = bool(_TS_RE.search(line)) or bool(_LEVEL_RE.match(line.strip()))
        is_continuation = (
            line.startswith((" ", "\t"))
            or line.lstrip().startswith(("File \"", "at ", "Traceback"))
            or _PY_FRAME_RE.search(line)
        )
        if starts_new and not is_continuation:
            if cur:
                blocks.append(cur)
            cur = [line]
        else:
            if not cur:
                cur = [line]
            else:
                cur.append(line)
    if cur:
        blocks.append(cur)
    return blocks


def _classify_tags(blob_low: str) -> List[str]:
    tags = []
    for tag, kws in _TAG_RULES.items():
        if any(kw in blob_low for kw in kws):
            tags.append(tag)
    return tags


def _classify_module(blob_low: str) -> str:
    for name, kws in _MODULE_RULES:
        if any(kw in blob_low for kw in kws):
            return name
    return "未知"


def _extract_resources(blob: str) -> dict:
    res = {}
    mems = _MEM_RE.findall(blob)
    if mems:
        res["memory_signals"] = [f"{v}{u}" for v, u in mems][:6]
    port = _PORT_RE.search(blob)
    if port:
        res["port"] = int(port.group(1))
    return res


def parse_block(block_lines: List[str]) -> LogRecord:
    """解析单个日志块为结构化记录。"""
    raw = "\n".join(block_lines)
    blob_low = raw.lower()
    head = block_lines[0]

    rec = LogRecord(raw=raw)

    ts = _TS_RE.search(head) or _TS_RE.search(raw)
    if ts:
        rec.timestamp = ts.group(1)

    lvl = _LEVEL_RE.search(head)
    rec.level = _normalize_level(lvl.group(1)) if lvl else "UNKNOWN"

    # 文件 + 行号：优先取堆栈最后一帧（最贴近真实出错点）
    py_frames = _PY_FRAME_RE.findall(raw)
    js_frames = _JS_FRAME_RE.findall(raw)
    if py_frames:
        path, ln = py_frames[-1]
        rec.file_path, rec.line_no = path, int(ln)
    elif js_frames:
        path, ln, _col = js_frames[-1]
        rec.file_path, rec.line_no = path, int(ln)

    # 堆栈帧汇总
    rec.stack = [f"{p}:{l}" for p, l in py_frames] + [f"{p}:{l}:{c}" for p, l, c in js_frames]

    # HTTP
    m = _HTTP_RE.search(raw)
    if m:
        rec.http_method, rec.http_path, rec.http_status = m.group(1), m.group(2), int(m.group(3))
    else:
        mb = _HTTP_BARE_RE.search(raw)
        if mb:
            rec.http_status = int(mb.group(2))

    rec.resources = _extract_resources(raw)
    rec.fault_tags = _classify_tags(blob_low)
    rec.module = _classify_module(blob_low)

    # message：首行去掉时间/级别前缀
    msg = head
    if ts:
        msg = msg.replace(ts.group(1), "", 1)
    if lvl:
        msg = msg.replace(lvl.group(0), "", 1)
    rec.message = msg.strip(" :[]-\t")
    return rec


def parse_logs(text: str, drop_noise: bool = True) -> List[LogRecord]:
    """
    解析整段日志。
      drop_noise=True 时丢弃纯 INFO/DEBUG 且无故障标签的噪声记录。
    """
    records: List[LogRecord] = []
    for block in _split_blocks(text):
        try:
            rec = parse_block(block)
        except Exception as e:  # 永不中断：降级为 raw 记录
            rec = LogRecord(raw="\n".join(block), level="PARSE_ERROR",
                            message=f"解析异常: {e}")
        if drop_noise and rec.level in _NOISE_LEVELS and not rec.fault_tags:
            continue
        records.append(rec)
    return records


def parse_file(path: str | Path, drop_noise: bool = True) -> List[LogRecord]:
    text = Path(path).read_text(encoding="utf-8", errors="replace")
    return parse_logs(text, drop_noise=drop_noise)


def _main(argv: List[str]) -> int:
    if len(argv) < 2:
        print("用法: python log_struct_parser.py <日志文件> [--keep-noise]")
        return 2
    keep_noise = "--keep-noise" in argv
    recs = parse_file(argv[1], drop_noise=not keep_noise)
    out = {
        "total": len(recs),
        "by_level": _count(recs, "level"),
        "by_module": _count(recs, "module"),
        "records": [r.to_dict() for r in recs],
    }
    print(json.dumps(out, ensure_ascii=False, indent=2))
    return 0


def _count(recs: List[LogRecord], attr: str) -> dict:
    out: dict = {}
    for r in recs:
        k = getattr(r, attr)
        out[k] = out.get(k, 0) + 1
    return out


if __name__ == "__main__":
    try:  # Windows 控制台默认 GBK，强制 UTF-8 输出
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass
    raise SystemExit(_main(sys.argv))
