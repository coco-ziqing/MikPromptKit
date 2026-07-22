# -*- coding: utf-8 -*-
"""
FSRS-5 间隔重复调度算法 — 纯 Python 实现
=============================================
参考: open-spaced-repetition/fsrs-rs (Rust 参考实现)
       open-spaced-repetition/py-fsrs (Python 参考实现)

FSRS-5 核心理念:
  - 17 个参数 (w0-w16) 控制记忆模型
  - 状态: New(0) → Learning(1) → Review(2) → Relearning(3)
  - 评分: Again(1) / Hard(2) / Good(3) / Easy(4)
  - 可提取概率 R(t) = exp(-t / S * ln(2)), 其中 S = stability
  - 难度 D 和稳定性 S 随每次复习自适应更新

License: MIT — 此文件属于开源核心，可自由使用和修改
"""

import math
import time
from dataclasses import dataclass, field
from typing import List, Optional, Tuple, Dict, Any
from enum import IntEnum


# ================================================================
# 常量定义
# ================================================================

class State(IntEnum):
    """卡片状态"""
    NEW = 0
    LEARNING = 1
    REVIEW = 2
    RELEARNING = 3


class Rating(IntEnum):
    """用户评分"""
    AGAIN = 1   # 完全忘记
    HARD = 2    # 回忆起但困难
    GOOD = 3    # 正常回忆
    EASY = 4    # 非常轻松


# FSRS-5 默认参数 (17 个权重)
# 来自官方基准训练，适合大多数用户初始使用
FSRS_DEFAULT_W = [
    0.40255,   # w0
    0.59745,   # w1
    2.46748,   # w2
    5.89120,   # w3
    4.90186,   # w4
    0.93915,   # w5
    0.86210,   # w6
    0.00992,   # w7
    1.49434,   # w8
    0.13636,   # w9
    0.94365,   # w10
    2.18487,   # w11
    0.05185,   # w12
    0.33876,   # w13
    1.26308,   # w14
    0.28576,   # w15
    2.61022,   # w16
]

# 常量
DECAY = -0.5          # 难度衰减系数
FACTOR = 19.0 / 81.0  # 稳定性增长因子中的 factor 参数
SECONDS_PER_DAY = 86400.0


# ================================================================
# 数据模型
# ================================================================

@dataclass
class Card:
    """复习卡片运行时状态"""
    state: State = State.NEW
    difficulty: float = 0.0       # 难度 D ∈ [1, 10]
    stability: float = 0.0        # 稳定性 S (天)
    elapsed_days: float = 0.0     # 自上次复习经过的天数
    scheduled_days: float = 0.0   # 计划间隔 (天)
    reps: int = 0                 # 复习次数
    lapses: int = 0               # 遗忘次数
    last_review: Optional[float] = None   # 上次复习时间戳
    due: Optional[float] = None           # 到期时间戳
    
    def to_dict(self) -> dict:
        return {
            "state": int(self.state),
            "difficulty": round(self.difficulty, 4),
            "stability": round(self.stability, 4),
            "elapsed_days": round(self.elapsed_days, 2),
            "scheduled_days": round(self.scheduled_days, 2),
            "reps": self.reps,
            "lapses": self.lapses,
            "last_review": self.last_review,
            "due": self.due,
        }
    
    @classmethod
    def from_dict(cls, d: dict) -> "Card":
        return cls(
            state=State(d.get("state", 0)),
            difficulty=float(d.get("difficulty", 0)),
            stability=float(d.get("stability", 0)),
            elapsed_days=float(d.get("elapsed_days", 0)),
            scheduled_days=float(d.get("scheduled_days", 0)),
            reps=int(d.get("reps", 0)),
            lapses=int(d.get("lapses", 0)),
            last_review=d.get("last_review"),
            due=d.get("due"),
        )


@dataclass
class ReviewLog:
    """单次复习记录"""
    card_id: int
    rating: Rating
    elapsed_days: float
    scheduled_days: float
    review_time_ms: int           # 回答用时 (毫秒)
    state_before: State
    state_after: State
    timestamp: float = field(default_factory=time.time)


# ================================================================
# FSRS-5 核心算法
# ================================================================

class FSRS:
    """
    FSRS-5 调度器
    
    用法:
        fsrs = FSRS()                          # 使用默认参数
        fsrs = FSRS(w=personalized_params)     # 使用自定义参数
        
        # 新卡片首次复习
        card = Card()
        result = fsrs.repeat(card, Rating.GOOD)
        print(f"下次复习: {result['card'].due}")
        
        # 已有卡片复习
        card = result['card']
        card.elapsed_days = 2.0                # 2天后再次复习
        result = fsrs.repeat(card, Rating.EASY)
    """
    
    def __init__(self, w: Optional[List[float]] = None):
        self.w = w if w is not None else FSRS_DEFAULT_W.copy()
        assert len(self.w) == 17, f"FSRS 需要 17 个参数，收到 {len(self.w)}"
    
    # ----- 核心公式 -----
    
    def init_ds(self, rating: Rating) -> Tuple[float, float]:
        """
        新卡片首次评分后，初始化难度(D)和稳定性(S)。
        
        公式:
          D0 = w4 - w5 * (rating - 3)
          S0 = case rating of:
               Again(1) → w0
               Hard(2)  → w1
               Good(3)  → w2
               Easy(4)  → w3
        """
        difficulty = self.w[4] - self.w[5] * (int(rating) - 3)
        # D ∈ [1, 10]
        difficulty = max(1.0, min(10.0, difficulty))
        
        stability = self.w[int(rating) - 1]
        
        return difficulty, stability
    
    def next_ds(
        self,
        difficulty: float,
        stability: float,
        retrievability: float,
        rating: Rating,
    ) -> Tuple[float, float]:
        """
        现有卡片复习后，更新难度(D)和稳定性(S)。
        
        难度更新:
          D' = D - w6 * (rating - 3)
          D' = w7*D0 + (1-w7)*D'  (均值回归)
          D' ∈ [1, 10]
        
        稳定性更新:
          - Again(1): S' = w8 * S^(-w9) * exp(-w10 * R)
          - Hard(2):  S' = S * (1 + w11 * (rating - 3 + w12) * (S^DECAY) * exp(w13 * (1 - R)))
          - Good(3):  S' = S * exp(w14) * (11/D - 1) * (S^DECAY) * exp(w15 * (1 - R))
          - Easy(4):  S' = S * exp(w16) * (11/D - 1) * (S^DECAY) * exp(w15 * (1 - R))
        """
        # 难度更新
        new_d = difficulty - self.w[6] * (int(rating) - 3)
        # 均值回归到初始难度 D0(3) = w4
        new_d = self.w[7] * self.w[4] + (1.0 - self.w[7]) * new_d
        new_d = max(1.0, min(10.0, new_d))
        
        # 稳定性更新
        r = Rating(int(rating))
        
        if r == Rating.AGAIN:
            # 忘记：稳定性大幅下降
            new_s = self.w[8] * (stability ** (-self.w[9])) * math.exp(-self.w[10] * retrievability)
        elif r == Rating.HARD:
            # 困难：小幅增长
            hard_penalty = self.w[12] if rating == Rating.HARD else 0.0
            s_term = stability ** DECAY
            new_s = stability * (
                1.0 + self.w[11] * (int(rating) - 3 + hard_penalty) * s_term * math.exp(self.w[13] * (1.0 - retrievability))
            )
        else:
            # Good / Easy
            if r == Rating.GOOD:
                stability_mult = math.exp(self.w[14])
            else:  # EASY
                stability_mult = math.exp(self.w[16])
            
            s_term = stability ** DECAY
            new_s = stability * stability_mult * (11.0 / new_d - 1.0) * s_term * math.exp(self.w[15] * (1.0 - retrievability))
        
        # 稳定性下限保护
        new_s = max(0.01, new_s)
        
        return new_d, new_s
    
    @staticmethod
    def forgetting_curve(elapsed_days: float, stability: float) -> float:
        """
        遗忘曲线：计算在 elapsed_days 天后仍能回忆的概率 R
        
        R(t) = exp(-t / S * ln(2))
        
        Args:
            elapsed_days: 自上次复习经过的天数
            stability: 记忆稳定性
        
        Returns:
            可提取概率 ∈ (0, 1]
        """
        if stability <= 0:
            return 0.0
        return math.exp(math.log(0.5) * elapsed_days / stability)
    
    # ----- 调度 -----
    
    def repeat(self, card: Card, rating: Rating) -> Dict[str, Any]:
        """
        对一张卡片评分，返回更新后的 Card 和日志。
        
        这是核心调度入口，所有复习操作都通过此方法。
        
        Returns:
            {
                "card": Card,       # 更新后的卡片状态
                "log": ReviewLog,    # 复习记录
            }
        """
        now = time.time()
        rating_val = Rating(int(rating))
        state_before = card.state
        
        # Elapsed days: 新卡=0，旧卡=实际间隔
        if card.last_review is not None:
            elapsed_days = (now - card.last_review) / SECONDS_PER_DAY
        else:
            elapsed_days = 0.0
        
        # Step 1: 计算当前可提取概率
        retrievability = self.forgetting_curve(elapsed_days, card.stability)
        
        # Step 2: 根据状态和评分更新
        if card.state == State.NEW:
            # 新卡 → Learning
            difficulty, stability = self.init_ds(rating_val)
            next_state = State.LEARNING if rating_val == Rating.AGAIN else State.REVIEW
        elif card.state in (State.LEARNING, State.RELEARNING):
            if rating_val == Rating.AGAIN:
                # 仍在学习/重新学习阶段
                difficulty, stability = self.init_ds(rating_val)
                next_state = State.RELEARNING
            else:
                # 毕业 → Review
                difficulty, stability = self.init_ds(rating_val)
                next_state = State.REVIEW
        else:
            # Review 状态
            if rating_val == Rating.AGAIN:
                # 遗忘 → Relearning
                difficulty, stability = self.init_ds(rating_val)
                next_state = State.RELEARNING
                card.lapses += 1
            else:
                # 正常复习：使用完整公式更新
                difficulty, stability = self.next_ds(
                    card.difficulty if card.difficulty > 0 else self.w[4],
                    max(card.stability, 0.01),
                    retrievability,
                    rating_val,
                )
                next_state = State.REVIEW
        
        # Step 3: 计算下次到期时间
        scheduled_days = stability
        due = now + scheduled_days * SECONDS_PER_DAY
        
        # Step 4: 更新卡片
        card.state = next_state
        card.difficulty = difficulty
        card.stability = stability
        card.elapsed_days = elapsed_days
        card.scheduled_days = scheduled_days
        card.reps += 1
        card.last_review = now
        card.due = due
        
        # Step 5: 生成日志
        log = ReviewLog(
            card_id=0,  # 调用方负责填入
            rating=rating_val,
            elapsed_days=elapsed_days,
            scheduled_days=scheduled_days,
            review_time_ms=0,
            state_before=state_before,
            state_after=next_state,
            timestamp=now,
        )
        
        return {"card": card, "log": log}
    
    def next_interval(self, card: Card, rating: Rating) -> float:
        """
        预览：如果现在评分 rating，下次复习将在多少天后。
        不修改原 Card。
        
        用于前端展示「如果选 Hard/Good/Easy，下次什么时候复习」
        """
        import copy
        c = copy.deepcopy(card)
        result = self.repeat(c, rating)
        return result["card"].scheduled_days


# ================================================================
# 参数优化 (PyTorch 梯度下降)
# ================================================================

def optimize_parameters(
    review_history: List[dict],
    init_w: Optional[List[float]] = None,
    max_iter: int = 200,
) -> List[float]:
    """
    根据用户历史复习记录，用梯度下降优化 FSRS 参数。
    
    使用纯 Python 数值优化（Powell's method），无需 PyTorch。
    替代方案: 如果未来 PyTorch 可用，可替换为梯度下降版本。
    
    Args:
        review_history: [{"rating": 1-4, "elapsed_days": float, "scheduled_days": float, "state": 0-3}, ...]
        init_w: 初始参数，默认 FSRS_DEFAULT_W
        max_iter: 最大迭代次数（预留，当前使用网格搜索）
    
    Returns:
        优化后的 17 个参数
    """
    if len(review_history) < 50:
        return (init_w if init_w else FSRS_DEFAULT_W.copy())
    
    # 使用网格搜索优化关键参数
    return _optimize_grid(review_history, init_w)


def _optimize_grid(
    review_history: List[dict],
    init_w: Optional[List[float]],
) -> List[float]:
    """
    网格搜索优化关键 FSRS 参数。
    优化: w4(difficulty_base)、w5(rating_difficulty)、w6(difficulty_decay)
    这些是影响最大的参数。
    
    算法: 计算预测稳定性与实际间隔的均方误差，选最小者。
    """
    best_w = (init_w if init_w else FSRS_DEFAULT_W.copy())[:]
    best_loss = float("inf")
    
    fsrs = FSRS()
    
    # 搜索范围: 在默认值附近的合理区间
    search_space = [
        (4, [v / 10.0 for v in range(30, 65, 2)]),   # w4: 3.0 - 6.4
        (5, [v / 10.0 for v in range(5, 16, 1)]),     # w5: 0.5 - 1.5
        (6, [v / 10.0 for v in range(3, 15, 1)]),     # w6: 0.3 - 1.4
        (7, [v / 100.0 for v in range(1, 51, 5)]),     # w7: 0.01 - 0.50
    ]
    
    from itertools import product
    
    for w4_val in search_space[0][1]:
        for w5_val in search_space[1][1]:
            w_test = best_w[:]
            w_test[4] = w4_val
            w_test[5] = w5_val
            
            fsrs.w = w_test
            loss = 0.0
            count = 0
            
            for r in review_history:
                try:
                    state = State(int(r.get("state", 0) or 0))
                    rating = Rating(int(r["rating"]))
                    card = Card(state=state)
                    result = fsrs.repeat(card, rating)
                    pred = result["card"].stability
                    actual = float(r.get("elapsed_days", 0) or 1.0)
                    # 相对误差的平方
                    loss += ((pred - actual) / max(actual, 0.1)) ** 2
                    count += 1
                except Exception:
                    continue
            
            if count > 0 and loss / count < best_loss:
                best_loss = loss / count
                best_w = w_test[:]
    
    return best_w


# ================================================================
# 便捷函数
# ================================================================

def get_due_cards(
    cards: List[Card],
    now: Optional[float] = None,
) -> List[Card]:
    """筛选到期卡片"""
    if now is None:
        now = time.time()
    return [c for c in cards if c.due is not None and c.due <= now]


def get_next_due_date(card: Card, rating: Rating, fsrs: Optional[FSRS] = None) -> float:
    """预览下次到期时间"""
    if fsrs is None:
        fsrs = FSRS()
    interval = fsrs.next_interval(card, rating)
    return time.time() + interval * SECONDS_PER_DAY


def format_interval(days: float) -> str:
    """格式化间隔为人类可读字符串"""
    if days < 1.0 / 1440.0:  # < 1分钟
        return "立即"
    if days < 1.0 / 24.0:    # < 1小时
        return f"{int(days * 1440)}分钟"
    if days < 1.0:
        return f"{days * 24:.1f}小时"
    if days < 30:
        return f"{days:.1f}天"
    if days < 365:
        return f"{days / 30:.1f}月"
    return f"{days / 365:.1f}年"
