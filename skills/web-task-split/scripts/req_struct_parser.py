# -*- coding: utf-8 -*-
"""
web-task-split / req_struct_parser.py
=====================================
需求结构化拆解模块（能力①）

职责：
  1. 清洗零散口语化需求文本（去寒暄/语气词/无效模糊描述）；
  2. 标准化输出结构化需求字段：
       business_goal   业务目标
       user_scenarios  用户使用场景
       io_constraints  输入输出约束
       interaction     交互规则
       deps_external   依赖外部服务
       acceptance      验收标准
       raw_points      逐条原始需求点（编号）
  3. 统一规范需求口径，剔除明显的"暂不确定/以后再说"类范围蔓延描述（移交 scope checker）。

设计原则：
  - 纯标准库，零第三方依赖，零环境污染；
  - 既可 import 亦可 CLI 运行；
  - 解析永不抛出，降级保底，保证管道不中断。
"""

from __future__ import annotations

import json
import re
import sys
from dataclasses import dataclass, field, asdict
from pathlib import Path
from typing import List

# ── 口语/寒暄噪声词（行内剔除，不影响语义）──────────────────────────
_NOISE_PHRASES = [
    "帮我梳理", "有点乱", "大概就是", "顺便", "差不多", "我们想", "想做", "希望能",
    "麻烦", "谢谢", "哈", "嗯", "那种", "之类", "啥的", "可能", "应该", "或许",
]

# ── 字段识别关键词表：field -> 关键词列表（命中即归类）──────────────
_FIELD_RULES = {
    "business_goal": ["升级", "版本", "迭代", "工作流", "能力", "功能", "目标", "做一个", "新增", "加一个"],
    "user_scenarios": ["用户", "点", "页面", "详情页", "列表页", "手机", "平板", "局域网", "访问", "点击", "在.*页"],
    "io_constraints": ["输入", "输出", "存到", "导出", "打包", "缩略图", "端口", "格式", "存储", "向量", "数据"],
    "interaction": ["交互", "按钮", "进度条", "队列", "重试", "拖拽", "搜索框", "弹窗", "切换", "显示", "选风格"],
    "deps_external": ["comfyui", "ollama", "sentence-transformers", "大模型", "模型", "api", "推理", "ffmpeg", "sqlite", ".pkb"],
    "acceptance": ["验收", "保证", "正常", "能用", "跑通", "可访问", "达到", "通过"],
}

# ── 范围蔓延信号（标记为 out_of_scope_hint，交 scope_limit_checker 处理）──
_SCOPE_CREEP_SIGNALS = [
    "以后", "后面", "远期", "未来", "不一定做", "这次不", "暂不", "可能还想",
    "也许", "拓展", "扩展功能", "下次", "之后再",
]

# 句子切分：中文句号/分号/换行/数字编号
_SENT_SPLIT = re.compile(r"[。；;\n]+|(?<=\d)[、.](?=\s*[^\d])")
_NUM_LEAD = re.compile(r"^\s*\d+[\.、)）]\s*")


@dataclass
class StructuredReq:
    business_goal: List[str] = field(default_factory=list)
    user_scenarios: List[str] = field(default_factory=list)
    io_constraints: List[str] = field(default_factory=list)
    interaction: List[str] = field(default_factory=list)
    deps_external: List[str] = field(default_factory=list)
    acceptance: List[str] = field(default_factory=list)
    raw_points: List[str] = field(default_factory=list)
    out_of_scope_hint: List[str] = field(default_factory=list)
    complexity_signals: dict = field(default_factory=dict)

    def to_dict(self) -> dict:
        return asdict(self)


def _denoise(line: str) -> str:
    """剔除口语寒暄，保留语义主体。"""
    s = line.strip()
    s = _NUM_LEAD.sub("", s)
    for p in _NOISE_PHRASES:
        s = s.replace(p, "")
    s = s.strip(" ，,、:：-—()（）")
    return s


def _split_sentences(text: str) -> List[str]:
    parts = []
    for raw in re.split(r"\n+", text):
        raw = raw.strip()
        if not raw:
            continue
        for seg in _SENT_SPLIT.split(raw):
            seg = (seg or "").strip()
            if len(seg) >= 4:  # 丢弃过短碎片
                parts.append(seg)
    return parts


def _classify(sent_low: str) -> List[str]:
    hits = []
    for fld, kws in _FIELD_RULES.items():
        for kw in kws:
            if kw.startswith("在") and ".*" in kw:  # 简单正则关键词
                if re.search(kw, sent_low):
                    hits.append(fld)
                    break
            elif kw in sent_low:
                hits.append(fld)
                break
    return hits


def _complexity(text_low: str, points: int) -> dict:
    """提取复杂度信号，供路由层判定 PRO/FLASH。"""
    sig = {}
    sig["req_points"] = points
    sig["mentions_frontend"] = any(k in text_low for k in ["页面", "前端", "vue", "react", "搜索框", "按钮", "深色模式"])
    sig["mentions_backend"] = any(k in text_low for k in ["接口", "后端", "api", "异步任务", "队列", "存储", "数据库"])
    sig["mentions_model"] = any(k in text_low for k in ["comfyui", "ollama", "大模型", "推理", "sentence-transformers", "语义", "向量", "出图"])
    sig["multi_version"] = any(k in text_low for k in ["分版本", "多轮", "几个版本", "迭代", "里程碑", "排期"])
    sig["multi_people"] = any(k in text_low for k in ["多人", "协作", "分工", "一起开发"])
    sig["vague_boundary"] = any(k in text_low for k in ["有点乱", "帮我梳理", "不一定", "可能还想", "模糊"])
    # 联动层数：前/后/模型 命中数
    sig["layer_span"] = sum([sig["mentions_frontend"], sig["mentions_backend"], sig["mentions_model"]])
    return sig


def parse_requirement(text: str) -> StructuredReq:
    req = StructuredReq()
    text_low = text.lower()
    sentences = _split_sentences(text)
    req.raw_points = [_denoise(s) for s in sentences if _denoise(s)]

    for s in sentences:
        clean = _denoise(s)
        if not clean:
            continue
        low = clean.lower()

        # 范围蔓延优先标记
        if any(sig in clean for sig in _SCOPE_CREEP_SIGNALS):
            req.out_of_scope_hint.append(clean)
            continue

        flds = _classify(low)
        if not flds:
            # 无明确归类 → 默认归 business_goal（保证不丢信息）
            req.business_goal.append(clean)
            continue
        for f in flds:
            getattr(req, f).append(clean)

    # 去重（保序）
    for f in ["business_goal", "user_scenarios", "io_constraints",
              "interaction", "deps_external", "acceptance", "out_of_scope_hint"]:
        seen = set()
        uniq = []
        for x in getattr(req, f):
            if x not in seen:
                seen.add(x)
                uniq.append(x)
        setattr(req, f, uniq)

    req.complexity_signals = _complexity(text_low, len(req.raw_points))
    return req


def parse_file(path: str | Path) -> StructuredReq:
    text = Path(path).read_text(encoding="utf-8", errors="replace")
    return parse_requirement(text)


def _main(argv: List[str]) -> int:
    if len(argv) < 2:
        print("用法: python req_struct_parser.py <需求文件或文本>")
        return 2
    p = Path(argv[1])
    text = p.read_text(encoding="utf-8", errors="replace") if p.exists() else argv[1]
    req = parse_requirement(text)
    print(json.dumps(req.to_dict(), ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    try:  # Windows 控制台默认 GBK，强制 UTF-8 输出
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass
    raise SystemExit(_main(sys.argv))
