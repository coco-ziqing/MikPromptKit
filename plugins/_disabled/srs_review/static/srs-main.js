/**
 * SRS 间隔复习 — 前端核心
 * com.promptkit.srs-review v1.0.0
 *
 * 功能: 卡片翻转 + FSRS评分 + 统计仪表盘 + 词卡选取器 + 配置面板
 * 挂载: window.__PK_PLUGINS__ 注册视图 srs_review
 *
 * @license MIT
 */
(function () {
  'use strict';

  const API_BASE = '/api/plugins/com.promptkit.srs-review';
  const SEC = 1000;

  // ==============================================================
  // 状态管理
  // ==============================================================

  const S = {
    view: 'review',           // review | stats | enroll | config
    dueCards: [],
    currentIndex: 0,
    currentCard: null,
    isFlipped: false,
    reviewStartTime: 0,
    sessionStats: { reviewed: 0, remembered: 0 },
    autoNext: false,          // 评分后自动下一张
    config: null,
    stats: null,
  };

  // ==============================================================
  // HTML 模板
  // ==============================================================

  const T = {
    container: /*html*/`
      <div id="srs-app" class="srs-app">
        <!-- 顶部导航 -->
        <div class="srs-topbar">
          <div class="srs-tabs">
            <button class="srs-tab active" data-view="review">
              <i class="bi bi-card-text"></i> 复习
            </button>
            <button class="srs-tab" data-view="stats">
              <i class="bi bi-graph-up"></i> 统计
            </button>
            <button class="srs-tab" data-view="enroll">
              <i class="bi bi-plus-circle"></i> 加入
            </button>
            <button class="srs-tab" data-view="config">
              <i class="bi bi-sliders"></i> 设置
            </button>
          </div>
          <div class="srs-session-stats" id="srsSessionStats">
            <span class="srs-ss-item">📋 <b id="srsSSReviewed">0</b>/<b id="srsSSTotal">0</b></span>
            <span class="srs-ss-item">✅ <b id="srsSSRecall">-</b>%</span>
          </div>
        </div>

        <!-- 内容区 -->
        <div class="srs-content" id="srsContent"></div>
      </div>
    `,
  };

  // ==============================================================
  // 视图渲染
  // ==============================================================

  function render(container) {
    container.innerHTML = T.container;
    bindEvents();
    loadDueCount();
    switchView('review');
  }

  function bindEvents() {
    // Tab 切换
    document.querySelectorAll('.srs-tab').forEach(btn => {
      btn.addEventListener('click', () => switchView(btn.dataset.view));
    });

    // 键盘快捷键
    document.addEventListener('keydown', handleKeyboard);
  }

  function switchView(view) {
    S.view = view;

    // Tab 高亮
    document.querySelectorAll('.srs-tab').forEach(b => {
      b.classList.toggle('active', b.dataset.view === view);
    });

    const content = document.getElementById('srsContent');
    if (!content) return;

    switch (view) {
      case 'review': renderReviewView(content); break;
      case 'stats': renderStatsView(content); break;
      case 'enroll': renderEnrollView(content); break;
      case 'config': renderConfigView(content); break;
    }
  }

  // ==============================================================
  // 复习视图
  // ==============================================================

  async function renderReviewView(container) {
    // 显示加载
    container.innerHTML = `<div class="srs-loading"><i class="bi bi-hourglass-split"></i> 加载复习队列...</div>`;

    const resp = await fetch(`${API_BASE}/due?limit=50`);
    const data = await resp.json();

    if (!data.ok || data.cards.length === 0) {
      container.innerHTML = /*html*/`
        <div class="srs-empty">
          <div class="srs-empty-icon">🎉</div>
          <h3>今日复习完毕！</h3>
          <p>所有到期卡片都已复习。去「加入」页面添加新卡片，或等待明天。</p>
          <button class="srs-btn srs-btn-primary" onclick="SRS.switchView('enroll')">
            <i class="bi bi-plus-circle"></i> 加入新卡片
          </button>
        </div>
      `;
      updateSessionStats(0, 0);
      return;
    }

    S.dueCards = data.cards;
    S.currentIndex = 0;
    S.sessionStats = { reviewed: 0, remembered: 0 };
    updateSessionStats(0, S.dueCards.length);

    renderCard(container);
  }

  function renderCard(container) {
    const card = S.dueCards[S.currentIndex];
    if (!card) {
      container.innerHTML = `<div class="srs-empty">🎉 本轮复习完毕！</div>`;
      updateSessionStats(S.sessionStats.reviewed, S.dueCards.length, 100);
      return;
    }

    S.currentCard = card;
    S.isFlipped = false;
    S.reviewStartTime = Date.now();

    const stateLabel = {
      NEW: '🆕 新卡',
      LEARNING: '📖 学习中',
      REVIEW: '🔄 复习',
      RELEARNING: '🔁 重新学习',
    }[card.state_name] || '';

    const progressPct = S.dueCards.length > 0
      ? Math.round((S.currentIndex) / S.dueCards.length * 100)
      : 0;

    const frontContent = buildCardFront(card);
    const backContent = buildCardBack(card);

    container.innerHTML = /*html*/`
      <div class="srs-progress-bar">
        <div class="srs-progress-fill" style="width:${progressPct}%"></div>
      </div>

      <div class="srs-card-container">
        <div class="srs-card-flipper" id="srsFlipper">
          <!-- 正面 -->
          <div class="srs-card-face srs-card-front">
            <div class="srs-card-header">
              <span class="srs-card-state">${stateLabel}</span>
              <span class="srs-card-index">${S.currentIndex + 1} / ${S.dueCards.length}</span>
            </div>
            <div class="srs-card-body">
              ${frontContent}
            </div>
            <div class="srs-card-hint">
              <span>按空格键或点击翻转</span>
            </div>
          </div>

          <!-- 背面 -->
          <div class="srs-card-face srs-card-back">
            <div class="srs-card-header">
              <span class="srs-card-state">📝 答案</span>
              <span class="srs-card-index">${S.currentIndex + 1} / ${S.dueCards.length}</span>
            </div>
            <div class="srs-card-body">
              ${backContent}
            </div>
            <div class="srs-rating-buttons">
              <button class="srs-rate-btn srs-rate-again" onclick="SRS.rate(1)" title="完全忘记">
                <span class="srs-rate-num">1</span>
                <span class="srs-rate-label">Again</span>
                <span class="srs-rate-hint">${card.preview?.['1']?.label || '1分钟'}</span>
              </button>
              <button class="srs-rate-btn srs-rate-hard" onclick="SRS.rate(2)" title="回忆起但困难">
                <span class="srs-rate-num">2</span>
                <span class="srs-rate-label">Hard</span>
                <span class="srs-rate-hint">${card.preview?.['2']?.label || '6小时'}</span>
              </button>
              <button class="srs-rate-btn srs-rate-good" onclick="SRS.rate(3)" title="正常回忆">
                <span class="srs-rate-num">3</span>
                <span class="srs-rate-label">Good</span>
                <span class="srs-rate-hint">${card.preview?.['3']?.label || '2.5天'}</span>
              </button>
              <button class="srs-rate-btn srs-rate-easy" onclick="SRS.rate(4)" title="非常轻松">
                <span class="srs-rate-num">4</span>
                <span class="srs-rate-label">Easy</span>
                <span class="srs-rate-hint">${card.preview?.['4']?.label || '5.9天'}</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      <div class="srs-key-hints">
        <kbd>Space</kbd> 翻转 &nbsp;
        <kbd>1</kbd> Again &nbsp;
        <kbd>2</kbd> Hard &nbsp;
        <kbd>3</kbd> Good &nbsp;
        <kbd>4</kbd> Easy &nbsp;
        <kbd>← →</kbd> 翻页
      </div>
    `;

    // 点击翻转
    const flipper = document.getElementById('srsFlipper');
    if (flipper) {
      flipper.addEventListener('click', () => SRS.flip());
    }
  }

  function buildCardFront(card) {
    const mode = card.card_mode || 'text';
    const title = card.title || '未命名';

    switch (mode) {
      case 'image':
        // 显示缩略图/视频首帧，隐藏文字
        if (card.thumbnail || card.preview_media) {
          const thumbUrl = card.thumbnail
            ? `/api/thumbnails/${card.thumbnail}`
            : `/api/media/${card.preview_media}`;
          return /*html*/`
            <div class="srs-card-media">
              <img src="${thumbUrl}" alt="${E(title)}" class="srs-card-thumb" />
            </div>
          `;
        }
        return /*html*/`<div class="srs-card-text-big">${E(card.content || title)}</div>`;

      case 'classification':
        // 显示分类名，背面是词条列表
        return /*html*/`
          <div class="srs-card-text-huge">${E(card.module || card.category || title)}</div>
        `;

      case 'translation':
        // 正面显示中文，背面显示英文翻译
        return /*html*/`
          <div class="srs-card-text-big">${E(card.content || title)}</div>
        `;

      case 'text':
      default:
        // 纯文本模式
        return /*html*/`
          <div class="srs-card-text-big">${E(card.content || title)}</div>
          ${card.thumbnail ? `<img src="/api/thumbnails/${card.thumbnail}" class="srs-card-thumb-small" />` : ''}
        `;
    }
  }

  function buildCardBack(card) {
    return /*html*/`
      <div class="srs-card-detail">
        <h4 class="srs-card-title">${E(card.title || '未命名')}</h4>
        <div class="srs-card-content">${E(card.content || '—')}</div>
        ${card.meaning ? `<div class="srs-card-meaning"><span class="srs-label">释义：</span>${E(card.meaning)}</div>` : ''}
        ${card.scene ? `<div class="srs-card-scene"><span class="srs-label">场景：</span>${E(card.scene)}</div>` : ''}
        ${card.module ? `<div class="srs-card-module"><span class="srs-label">分组：</span>${E(card.module)}</div>` : ''}
        ${card.tags ? `<div class="srs-card-tags"><span class="srs-label">标签：</span>${card.tags.split(',').map(t => `<span class="srs-tag">${E(t.trim())}</span>`).join(' ')}</div>` : ''}
        <div class="srs-card-meta">
          复习次数: ${card.reps || 0} | 遗忘: ${card.lapses || 0}
          ${card.difficulty ? ` | 难度: ${card.difficulty.toFixed(1)}` : ''}
        </div>
      </div>
    `;
  }

  function updateSessionStats(reviewed, total, recall) {
    const elReviewed = document.getElementById('srsSSReviewed');
    const elTotal = document.getElementById('srsSSTotal');
    const elRecall = document.getElementById('srsSSRecall');
    if (elReviewed) elReviewed.textContent = reviewed;
    if (elTotal) elTotal.textContent = total;
    if (elRecall) elRecall.textContent = recall != null ? recall : (
      reviewed > 0 ? Math.round(S.sessionStats.remembered / reviewed * 100) : '-'
    );
  }

  // ==============================================================
  // 统计视图
  // ==============================================================

  async function renderStatsView(container) {
    container.innerHTML = `<div class="srs-loading"><i class="bi bi-hourglass-split"></i> 加载统计...</div>`;

    const resp = await fetch(`${API_BASE}/stats`);
    const data = await resp.json();
    if (!data.ok) {
      container.innerHTML = `<div class="srs-empty">⚠️ 无法加载统计</div>`;
      return;
    }

    S.stats = data.stats;
    const s = data.stats;

    container.innerHTML = /*html*/`
      <div class="srs-stats-grid">
        <div class="srs-stat-card">
          <div class="srs-stat-value">${s.total_cards}</div>
          <div class="srs-stat-label">总卡片</div>
        </div>
        <div class="srs-stat-card">
          <div class="srs-stat-value">${s.total_reviews}</div>
          <div class="srs-stat-label">总复习次数</div>
        </div>
        <div class="srs-stat-card">
          <div class="srs-stat-value">${s.today_reviews}</div>
          <div class="srs-stat-label">今日复习</div>
        </div>
        <div class="srs-stat-card srs-stat-highlight">
          <div class="srs-stat-value">${s.recall_rate}%</div>
          <div class="srs-stat-label">回忆率</div>
        </div>
        <div class="srs-stat-card">
          <div class="srs-stat-value">${s.streak_days}</div>
          <div class="srs-stat-label">连续天数</div>
        </div>
      </div>

      <div class="srs-stats-section">
        <h4>📊 卡片状态分布</h4>
        <div class="srs-state-bars">
          ${['NEW', 'LEARNING', 'REVIEW', 'RELEARNING'].map(state => {
            const count = s.state_distribution[state] || 0;
            const pct = s.total_cards > 0 ? Math.round(count / s.total_cards * 100) : 0;
            return /*html*/`
              <div class="srs-state-bar-item">
                <span class="srs-state-bar-label">${state}</span>
                <div class="srs-state-bar-bg">
                  <div class="srs-state-bar-fill" style="width:${pct}%"></div>
                </div>
                <span class="srs-state-bar-count">${count}</span>
              </div>
            `;
          }).join('')}
        </div>
      </div>

      <div class="srs-stats-section">
        <h4>📅 未来7天到期</h4>
        <div class="srs-future-bars">
          ${s.future_due.map(d => {
            const maxCount = Math.max(...s.future_due.map(x => x.count), 1);
            const height = Math.max(4, Math.round(d.count / maxCount * 100));
            return /*html*/`
              <div class="srs-future-bar-col">
                <div class="srs-future-bar" style="height:${height}px" title="${d.count}张"></div>
                <span class="srs-future-bar-count">${d.count}</span>
                <span class="srs-future-bar-label">${d.label}</span>
              </div>
            `;
          }).join('')}
        </div>
      </div>
    `;
  }

  // ==============================================================
  // 加入视图 — 词卡选取器
  // ==============================================================

  let enrollSearchTimer = null;

  async function renderEnrollView(container) {
    container.innerHTML = /*html*/`
      <div class="srs-enroll-panel">
        <div class="srs-enroll-header">
          <h4>📥 将词卡加入复习计划</h4>
          <div class="srs-enroll-search">
            <input type="text" id="srsEnrollSearch" class="srs-search-input"
                   placeholder="搜索词卡（标题/内容/标签）..." />
          </div>
          <div class="srs-enroll-actions">
            <button class="srs-btn srs-btn-outline" onclick="SRS.enrollSelected()" id="srsEnrollBtn" disabled>
              加入选中 (<span id="srsEnrollCount">0</span>)
            </button>
            <button class="srs-btn srs-btn-outline" onclick="SRS.enrollAllVisible()">
              全部加入
            </button>
          </div>
        </div>
        <div class="srs-enroll-list" id="srsEnrollList">
          <div class="srs-loading">搜索词卡...</div>
        </div>
      </div>
    `;

    // 搜索事件
    document.getElementById('srsEnrollSearch').addEventListener('input', (e) => {
      clearTimeout(enrollSearchTimer);
      enrollSearchTimer = setTimeout(() => loadEnrollable(e.target.value), 300);
    });

    loadEnrollable('');
  }

  async function loadEnrollable(q) {
    const list = document.getElementById('srsEnrollList');
    if (!list) return;

    list.innerHTML = `<div class="srs-loading">加载中...</div>`;

    const params = new URLSearchParams({ limit: '100' });
    if (q) params.set('q', q);

    const resp = await fetch(`${API_BASE}/enrollable?${params}`);
    const data = await resp.json();

    if (!data.ok || data.cards.length === 0) {
      list.innerHTML = `<div class="srs-empty">没有可加入的词卡 — 所有词卡已在复习计划中 🎉</div>`;
      return;
    }

    list.innerHTML = data.cards.map(c => /*html*/`
      <div class="srs-enroll-item" data-wcid="${c.id}">
        <input type="checkbox" class="srs-enroll-check" data-wcid="${c.id}" />
        <div class="srs-enroll-info">
          <div class="srs-enroll-title">${E(c.title || '未命名')}</div>
          <div class="srs-enroll-meta">
            ${c.module ? `<span class="srs-enroll-module">${E(c.module)}</span>` : ''}
            ${c.tags ? c.tags.split(',').slice(0, 3).map(t => `<span class="srs-tag">${E(t.trim())}</span>`).join(' ') : ''}
          </div>
        </div>
        <button class="srs-btn-small" onclick="SRS.enrollOne(${c.id})">＋加入</button>
      </div>
    `).join('');

    // Checkbox 事件
    list.querySelectorAll('.srs-enroll-check').forEach(cb => {
      cb.addEventListener('change', updateEnrollCount);
    });

    updateEnrollCount();
  }

  function updateEnrollCount() {
    const checked = document.querySelectorAll('.srs-enroll-check:checked');
    const btn = document.getElementById('srsEnrollBtn');
    const countEl = document.getElementById('srsEnrollCount');
    if (countEl) countEl.textContent = checked.length;
    if (btn) btn.disabled = checked.length === 0;
  }

  async function enrollOne(wcId) {
    const resp = await fetch(`${API_BASE}/enroll`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ word_card_id: wcId, card_mode: 'text' }),
    });
    const data = await resp.json();
    if (data.ok) {
      // 刷新列表
      const q = document.getElementById('srsEnrollSearch')?.value || '';
      loadEnrollable(q);
      loadDueCount();
    }
  }

  async function enrollSelected() {
    const checked = document.querySelectorAll('.srs-enroll-check:checked');
    const ids = Array.from(checked).map(cb => parseInt(cb.dataset.wcid));
    if (ids.length === 0) return;

    const resp = await fetch(`${API_BASE}/enroll-batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ word_card_ids: ids, card_mode: 'text' }),
    });
    const data = await resp.json();
    if (data.ok) {
      alert(`已加入 ${data.added} 张卡片`);
      const q = document.getElementById('srsEnrollSearch')?.value || '';
      loadEnrollable(q);
      loadDueCount();
    }
  }

  async function enrollAllVisible() {
    const items = document.querySelectorAll('.srs-enroll-item');
    const ids = Array.from(items).map(el => parseInt(el.dataset.wcid));
    if (ids.length === 0) return;

    if (!confirm(`将当前显示的 ${ids.length} 张词卡全部加入复习？`)) return;

    const resp = await fetch(`${API_BASE}/enroll-batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ word_card_ids: ids, card_mode: 'text' }),
    });
    const data = await resp.json();
    if (data.ok) {
      alert(`已加入 ${data.added} 张卡片`);
      const q = document.getElementById('srsEnrollSearch')?.value || '';
      loadEnrollable(q);
      loadDueCount();
    }
  }

  // ==============================================================
  // 设置视图
  // ==============================================================

  async function renderConfigView(container) {
    container.innerHTML = `<div class="srs-loading">加载配置...</div>`;

    const [confResp, paramResp] = await Promise.all([
      fetch(`${API_BASE}/config`),
      fetch(`${API_BASE}/params`),
    ]);
    const confData = await confResp.json();
    const paramData = await paramResp.json();

    const config = confData.config || {};
    const params = paramData.params || {};

    container.innerHTML = /*html*/`
      <div class="srs-config-panel">
        <div class="srs-config-section">
          <h4>📋 复习策略</h4>
          <div class="srs-config-row">
            <label>目标回忆率</label>
            <div class="srs-config-range">
              <input type="range" id="srsCfgTargetRecall" min="70" max="97"
                     value="${Math.round((confData.fsrs_params?.target_retrievability || 0.9) * 100)}"
                     step="1" />
              <span id="srsCfgTargetRecallVal">${Math.round((confData.fsrs_params?.target_retrievability || 0.9) * 100)}%</span>
            </div>
            <small>越高→复习越频繁，推荐 85-95%</small>
          </div>
          <div class="srs-config-row">
            <label>每日新卡上限</label>
            <input type="number" id="srsCfgNewLimit" value="${config.daily_new_limit || 20}"
                   min="1" max="100" class="srs-input-num" />
          </div>
          <div class="srs-config-row">
            <label>每日复习上限</label>
            <input type="number" id="srsCfgReviewLimit" value="${config.daily_review_limit || 200}"
                   min="10" max="500" class="srs-input-num" />
          </div>
          <div class="srs-config-row">
            <label>复习顺序</label>
            <select id="srsCfgOrder" class="srs-select">
              <option value="mixed" ${config.review_order === 'mixed' ? 'selected' : ''}>混合（新卡+复习）</option>
              <option value="new_first" ${config.review_order === 'new_first' ? 'selected' : ''}>新卡优先</option>
              <option value="review_first" ${config.review_order === 'review_first' ? 'selected' : ''}>复习优先</option>
            </select>
          </div>
        </div>

        <div class="srs-config-section">
          <h4>🧪 FSRS 参数优化</h4>
          <div class="srs-params-status">
            ${paramData.is_default
              ? '<span class="srs-param-badge default">使用默认参数</span>'
              : '<span class="srs-param-badge optimized">已个性化优化</span>'}
            ${confData.fsrs_params?.optimized_at
              ? `<small>上次优化: ${new Date(confData.fsrs_params.optimized_at * 1000).toLocaleString()}</small>`
              : ''}
          </div>
          <button class="srs-btn srs-btn-primary" onclick="SRS.optimizeParams()">
            <i class="bi bi-magic"></i> 优化参数（梯度下降）
          </button>
          <small>需要至少 50 条复习记录才能优化</small>
        </div>

        <button class="srs-btn srs-btn-primary srs-btn-save" onclick="SRS.saveConfig()">
          <i class="bi bi-check-lg"></i> 保存设置
        </button>
      </div>
    `;

    // Range 联动
    const rangeEl = document.getElementById('srsCfgTargetRecall');
    const valEl = document.getElementById('srsCfgTargetRecallVal');
    if (rangeEl && valEl) {
      rangeEl.addEventListener('input', () => {
        valEl.textContent = rangeEl.value + '%';
      });
    }
  }

  async function saveConfig() {
    const body = {
      daily_new_limit: parseInt(document.getElementById('srsCfgNewLimit')?.value || '20'),
      daily_review_limit: parseInt(document.getElementById('srsCfgReviewLimit')?.value || '200'),
      review_order: document.getElementById('srsCfgOrder')?.value || 'mixed',
      target_retrievability: parseInt(document.getElementById('srsCfgTargetRecall')?.value || '90') / 100,
    };

    const resp = await fetch(`${API_BASE}/config`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await resp.json();
    if (data.ok) {
      alert('✅ 设置已保存');
    }
  }

  async function optimizeParams() {
    const resp = await fetch(`${API_BASE}/optimize`, { method: 'POST' });
    const data = await resp.json();
    if (data.ok) {
      alert(`✅ ${data.message}\n使用了 ${data.records_used} 条记录`);
      // 刷新配置视图
      switchView('config');
    } else {
      alert(`⚠️ ${data.message}`);
    }
  }

  // ==============================================================
  // 评分交互
  // ==============================================================

  function flip() {
    const flipper = document.getElementById('srsFlipper');
    if (!flipper) return;
    S.isFlipped = !S.isFlipped;
    flipper.classList.toggle('is-flipped', S.isFlipped);
  }

  async function rate(rating) {
    if (!S.currentCard) return;

    const cardId = S.currentCard.id;
    const reviewTimeMs = Date.now() - S.reviewStartTime;

    // 累计 session 统计
    S.sessionStats.reviewed++;
    if (rating >= 3) S.sessionStats.remembered++;

    updateSessionStats(
      S.sessionStats.reviewed,
      S.dueCards.length,
      Math.round(S.sessionStats.remembered / S.sessionStats.reviewed * 100)
    );

    // 提交评分（异步，不阻塞翻页）
    fetch(`${API_BASE}/rate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ card_id: cardId, rating, review_time_ms: reviewTimeMs }),
    }).catch(e => console.warn('[SRS] 评分提交失败:', e));

    // 动画反馈
    const ratingEl = document.querySelector(`.srs-rate-${['again','hard','good','easy'][rating-1]}`);
    if (ratingEl) {
      ratingEl.classList.add('srs-rate-flash');
      setTimeout(() => ratingEl.classList.remove('srs-rate-flash'), 400);
    }

    // 下一张
    setTimeout(() => {
      S.currentIndex++;
      S.isFlipped = false;
      const container = document.getElementById('srsContent');
      if (container) renderCard(container);
    }, rating < 3 ? 600 : 300);
  }

  function handleKeyboard(e) {
    if (S.view !== 'review') return;
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

    switch (e.key) {
      case ' ':
      case 'Spacebar':
        e.preventDefault();
        flip();
        break;
      case '1': rate(1); break;
      case '2': rate(2); break;
      case '3': rate(3); break;
      case '4': rate(4); break;
      case 'ArrowLeft':
        if (S.currentIndex > 0) {
          S.currentIndex--;
          S.isFlipped = false;
          const container = document.getElementById('srsContent');
          if (container) renderCard(container);
        }
        break;
      case 'ArrowRight':
        if (S.currentIndex < S.dueCards.length - 1) {
          S.currentIndex++;
          S.isFlipped = false;
          const container = document.getElementById('srsContent');
          if (container) renderCard(container);
        }
        break;
    }
  }

  // ==============================================================
  // 工具函数
  // ==============================================================

  function E(s) {
    if (!s) return '';
    const div = document.createElement('div');
    div.textContent = String(s);
    return div.innerHTML;
  }

  async function loadDueCount() {
    try {
      const resp = await fetch(`${API_BASE}/due-count`);
      const data = await resp.json();
      if (data.ok && data.total_due > 0) {
        // 更新导航栏上的角标
        const navBtn = document.getElementById('navSRSReview');
        if (navBtn) {
          const existing = navBtn.querySelector('.srs-nav-badge');
          if (existing) existing.remove();
          if (data.total_due > 0) {
            const badge = document.createElement('span');
            badge.className = 'srs-nav-badge';
            badge.textContent = data.total_due;
            navBtn.appendChild(badge);
          }
        }
      }
    } catch (e) { /* 忽略 */ }
  }

  // ==============================================================
  // 注册
  // ==============================================================

  window.SRS = {
    render,
    switchView,
    flip,
    rate,
    enrollOne,
    enrollSelected,
    enrollAllVisible,
    saveConfig,
    optimizeParams,
  };

  // 注册到插件视图
  if (window.__PK_VIEW_REGISTRY__) {
    window.__PK_VIEW_REGISTRY__.register('srs_review', function (container) {
      render(container);
    });
  }

  if (window.__PK_PLUGINS__) {
    window.__PK_PLUGINS__._views = window.__PK_PLUGINS__._views || {};
    window.__PK_PLUGINS__._views.srs_review = function () {
      const container = document.getElementById('mainContent');
      if (container) render(container);
    };
  }

  console.log('[SRS] ✅ 间隔复习插件已加载');
})();
