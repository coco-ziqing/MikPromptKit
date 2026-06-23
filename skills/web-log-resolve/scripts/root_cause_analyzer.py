# -*- coding: utf-8 -*-
"""
web-log-resolve / root_cause_analyzer.py
========================================
多层根因定位 + DeepSeek 推理异常专项故障库（能力②④）

分层溯源：
  表层（symptom）  : 日志直接抛出的异常
  中层（mid）      : 代码 / 参数 / 跨服务通信问题
  底层（root）     : 硬件 / 驱动 / 模型权重 / 网络环境真实根源

内置 DeepSeek/本地推理专属故障规则库（FAULT_LIBRARY），
覆盖：显存溢出、KV缓存超限、量化不匹配、Tokenizer加载失败、
推理并发阻塞、批处理参数异常、多卡通信报错、推理服务兼容故障。

纯标准库；可 import 亦可 CLI 运行。
"""

from __future__ import annotations

import json
import sys
from dataclasses import dataclass, field, asdict
from pathlib import Path
from typing import List, Optional

# ── 专项故障规则库：fault_tag -> 三层根因 + 修复要点 ───────────────────
# 每条规则字段：symptom / mid / root / quick_fix / global_fix / prevent
FAULT_LIBRARY = {
    "OOM显存溢出": {
        "symptom": "CUDA out of memory / torch.cuda.OutOfMemoryError，分配显存失败。",
        "mid": "并发请求或 batch/seq 长度过大，显存峰值超物理上限；可能存在显存碎片。",
        "root": "GPU 物理显存不足或被其他进程占用；模型未量化/KV 缓存预留过大。",
        "quick_fix": "降低并发与 max_batch_size、缩短 max_seq_len；`nvidia-smi` 杀掉占显存的僵尸进程后重启推理服务。",
        "global_fix": "为推理服务设置显存上限与 gpu_memory_utilization=0.85；启用模型量化(int8/int4)；开启 PagedAttention/连续批处理。",
        "prevent": "上线显存阈值告警(>90%)；请求排队限流；按显存自动拒绝超长上下文。",
    },
    "KV缓存超限": {
        "symptom": "KV cache size 超过 reserved budget，随后触发 OOM 或请求丢弃。",
        "mid": "上下文长度 × 并发数导致 KV 缓存线性膨胀，超过预留块数。",
        "root": "KV 缓存块预算配置过小或上下文窗口设置过大。",
        "quick_fix": "调小 max_model_len / num_seqs；临时减少并发。",
        "global_fix": "按显存反推 KV 块数：block_size 与 max_num_seqs 联调；启用 PagedAttention。",
        "prevent": "对单请求 token 上限做硬校验；KV 占用监控面板。",
    },
    "量化不匹配": {
        "symptom": "量化精度不兼容 / dtype mismatch / unsupported quantization。",
        "mid": "权重量化格式与推理引擎/算子不匹配（如 AWQ vs GPTQ）。",
        "root": "模型量化方案与显卡算力(SM)或引擎版本不支持。",
        "quick_fix": "回退到 fp16 加载验证；更换匹配的量化权重。",
        "global_fix": "锁定 引擎版本↔量化格式↔显卡算力 三者兼容矩阵并写入部署文档。",
        "prevent": "部署前跑量化兼容性自检脚本。",
    },
    "权重文件损坏": {
        "symptom": "safetensors header too large / file truncated / 反序列化失败。",
        "mid": "权重文件下载不完整或磁盘写入中断。",
        "root": "存储介质故障 / 传输中断 / 文件被截断。",
        "quick_fix": "校验文件大小与 sha256，重新下载该分片(model-0000x-of-*)。",
        "global_fix": "下载后强制 checksum 校验；使用断点续传与镜像源。",
        "prevent": "权重仓库加 manifest+hash 清单；启动时预校验。",
    },
    "Tokenizer加载失败": {
        "symptom": "tokenizer.json not found / AutoTokenizer.from_pretrained failed。",
        "mid": "模型目录缺少 tokenizer 配置文件或路径错误。",
        "root": "权重包不完整（缺 tokenizer.* / special_tokens_map.json）或路径环境变量错误。",
        "quick_fix": "补齐 tokenizer.json/tokenizer_config.json 到模型目录；核对模型路径。",
        "global_fix": "模型目录完整性清单校验纳入启动自检。",
        "prevent": "拉取模型时校验必备文件清单。",
    },
    "推理并发阻塞": {
        "symptom": "请求长时间 pending / 队列堆积 / 超时。",
        "mid": "并发数超过引擎调度能力，或单请求过长阻塞队列。",
        "root": "线程/事件循环阻塞或 GPU 串行化。",
        "quick_fix": "降低并发、设置请求超时、拆分长请求。",
        "global_fix": "启用异步连续批处理；设置 max_num_seqs 与队列上限。",
        "prevent": "队列长度与 P99 延迟监控告警。",
    },
    "批处理参数异常": {
        "symptom": "batch 参数报错 / shape mismatch。",
        "mid": "max_batch_size / padding 配置与输入不匹配。",
        "root": "动态 batch 拼接逻辑或 padding 策略错误。",
        "quick_fix": "固定 batch=1 验证后再放开。",
        "global_fix": "统一 padding 与 max_batch_tokens 配置。",
        "prevent": "输入 shape 入口校验。",
    },
    "多卡通信故障": {
        "symptom": "NCCL error / AllReduce timeout / rank timed out。",
        "mid": "多卡分布式通信超时或拓扑不一致。",
        "root": "NCCL/驱动版本不匹配、NVLink/PCIe 通信异常或某 rank 卡死。",
        "quick_fix": "设置 NCCL_TIMEOUT、检查各 rank 健康，重启分布式作业。",
        "global_fix": "锁定 CUDA/NCCL/驱动 版本矩阵；配置 NCCL 网络接口与超时。",
        "prevent": "启动前 all-reduce 连通性自检。",
    },
    "推理引擎崩溃": {
        "symptom": "Engine iteration failed / ASGI application 异常，pending 请求被中止。",
        "mid": "上游异常(OOM/通信)向引擎主循环冒泡导致整体中止。",
        "root": "通常是显存/通信/权重等底层故障的连锁结果。",
        "quick_fix": "结合同窗口其它 ERROR 定位上游根因；重启引擎。",
        "global_fix": "引擎主循环加异常隔离，单请求失败不拖垮整体。",
        "prevent": "进程级守护 + 自动重启 + 健康探针。",
    },
    # ── 通用 Web/后端故障 ──────────────────────────────────────────
    "数据库锁": {
        "symptom": "sqlite3.OperationalError: database is locked，接口 500。",
        "mid": "并发写入争用同一 SQLite 文件，事务未及时提交/释放。",
        "root": "SQLite 单写锁特性 + 长事务/未关闭连接。",
        "quick_fix": "缩短事务、写操作串行化、连接用完即关；开启 WAL 模式。",
        "global_fix": "PRAGMA journal_mode=WAL; busy_timeout=5000；写操作加重试。",
        "prevent": "连接池 + 写队列；监控锁等待。",
    },
    "参数校验失败": {
        "symptom": "pydantic ValidationError / 422 / Field required。",
        "mid": "请求体缺字段或类型不符（前端传参与后端模型不一致）。",
        "root": "前后端契约不同步。",
        "quick_fix": "补齐缺失字段（如 content）；核对前端提交体。",
        "global_fix": "字段设默认值或可选；前后端共享 schema。",
        "prevent": "接口契约测试纳入 CI。",
    },
    "接口404": {
        "symptom": "GET/POST 404 Not Found（接口或静态资源）。",
        "mid": "路由路径错误 / 静态文件版本号失效 / 后端未挂载该路由。",
        "root": "前后端路径不一致或资源未部署。",
        "quick_fix": "核对 URL 与后端路由表；检查静态文件是否存在与版本号。",
        "global_fix": "统一 API 前缀常量；静态资源版本号自动注入。",
        "prevent": "路由清单与前端常量同源生成。",
    },
    "接口500": {
        "symptom": "500 Internal Server Error / Exception in ASGI application。",
        "mid": "后端处理函数抛未捕获异常。",
        "root": "见同窗口 Traceback 末帧（数据库/参数/空指针等）。",
        "quick_fix": "按 Traceback 末帧定位并加 try/except + 返回友好错误。",
        "global_fix": "全局异常处理中间件统一兜底。",
        "prevent": "关键路径单测 + 异常告警。",
    },
    "JS运行时报错": {
        "symptom": "Uncaught TypeError/ReferenceError（如读取 undefined 属性）。",
        "mid": "数据未就绪即渲染，或接口返回结构异常。",
        "root": "缺少空值兜底/可选链；通常由上游接口 404/500 引发。",
        "quick_fix": "渲染处加 `?.` 与默认值 `(list || []).map(...)`。",
        "global_fix": "统一响应解析层 + 加载态/错误态组件。",
        "prevent": "TypeScript 类型约束 + 接口 mock 测试。",
    },
    "JSON解析失败": {
        "symptom": "Unexpected token '<' ... is not valid JSON。",
        "mid": "接口返回了 HTML(如 404 页)而非 JSON，被当作 JSON 解析。",
        "root": "接口 404/500 + 前端未判状态码直接 .json()。",
        "quick_fix": "解析前判 res.ok 与 content-type；失败走错误分支。",
        "global_fix": "封装 _safeFetch 统一处理非 JSON 响应。",
        "prevent": "网络层契约测试。",
    },
    "资源加载失败": {
        "symptom": "Failed to load resource（静态 js/css 404）。",
        "mid": "版本号哈希失效或文件路径错误。",
        "root": "构建产物未同步部署 / 缓存版本不匹配。",
        "quick_fix": "核对文件存在性与版本号；强刷缓存。",
        "global_fix": "版本号随构建自动生成注入。",
        "prevent": "部署后静态资源可达性巡检。",
    },
    "端口占用": {
        "symptom": "Address already in use / EADDRINUSE (0.0.0.0:8080)。",
        "mid": "端口被上一进程或其它服务占用。",
        "root": "旧进程未退出 / 端口冲突。",
        "quick_fix": "`netstat -ano | findstr :8080` 找 PID → `taskkill /PID <pid> /F`；或换端口。",
        "global_fix": "启动脚本探测 8080→8100 自增可用端口。",
        "prevent": "服务单例锁 + 优雅退出释放端口。",
    },
}

# 根因聚合时的"上游优先级"——底层故障优先作为连锁根因
_ROOT_PRIORITY = [
    "权重文件损坏", "Tokenizer加载失败", "多卡通信故障", "OOM显存溢出",
    "KV缓存超限", "量化不匹配", "数据库锁", "端口占用",
    "接口404", "接口500", "参数校验失败",
    "资源加载失败", "JSON解析失败", "JS运行时报错", "推理引擎崩溃",
]


@dataclass
class CauseLayer:
    tag: str
    symptom: str
    mid: str
    root: str
    evidence: List[str] = field(default_factory=list)


@dataclass
class AnalysisResult:
    primary_tag: Optional[str]
    layers: List[CauseLayer] = field(default_factory=list)
    chain_note: str = ""
    all_tags: List[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        d = asdict(self)
        return d


def analyze(records: List["object"]) -> AnalysisResult:
    """对结构化记录做多层根因定位与连锁聚合。"""
    tag_evidence: dict = {}
    for r in records:
        for t in (getattr(r, "fault_tags", []) or []):
            tag_evidence.setdefault(t, [])
            ev = (getattr(r, "message", "") or getattr(r, "raw", ""))[:160]
            if ev and ev not in tag_evidence[t]:
                tag_evidence[t].append(ev)

    all_tags = list(tag_evidence.keys())
    if not all_tags:
        return AnalysisResult(primary_tag=None, chain_note="未识别到已知故障标签，建议人工复核或切 PRO 深度分析。")

    # 选主根因：按上游优先级
    primary = None
    for cand in _ROOT_PRIORITY:
        if cand in tag_evidence:
            primary = cand
            break
    primary = primary or all_tags[0]

    layers: List[CauseLayer] = []
    for t in all_tags:
        lib = FAULT_LIBRARY.get(t)
        if not lib:
            continue
        layers.append(CauseLayer(
            tag=t, symptom=lib["symptom"], mid=lib["mid"], root=lib["root"],
            evidence=tag_evidence[t][:3],
        ))

    chain = ""
    if len(all_tags) > 1:
        chain = (f"检测到连锁故障：底层根因『{primary}』很可能诱发了其余 "
                 f"{', '.join(t for t in all_tags if t != primary)}；建议优先修复『{primary}』。")

    # 主根因排到首位
    layers.sort(key=lambda c: 0 if c.tag == primary else 1)
    return AnalysisResult(primary_tag=primary, layers=layers, chain_note=chain, all_tags=all_tags)


def _main(argv: List[str]) -> int:
    if len(argv) < 2:
        print("用法: python root_cause_analyzer.py <日志文件>")
        return 2
    import importlib.util
    here = Path(__file__).resolve().parent
    spec = importlib.util.spec_from_file_location("lsp", here / "log_struct_parser.py")
    lsp = importlib.util.module_from_spec(spec)
    sys.modules["lsp"] = lsp  # Py3.14 @dataclass 需模块已注册
    spec.loader.exec_module(lsp)  # type: ignore

    recs = lsp.parse_file(argv[1], drop_noise=True)
    res = analyze(recs)
    print(json.dumps(res.to_dict(), ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    try:  # Windows 控制台默认 GBK，强制 UTF-8 输出
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass
    raise SystemExit(_main(sys.argv))
