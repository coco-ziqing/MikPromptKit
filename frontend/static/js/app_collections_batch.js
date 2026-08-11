/**
 * PromptKit — app_collections 模块分片 (batch)
 * 自 app_collections.js 拆分（Phase 3.5-P2），方法经 this 互访，片间共享 App 状态
 */
(function() {
'use strict';
Object.assign(App, {

    async batchTrash() {
        const ids = [...this.state.batchSelected];
        if (ids.length === 0) { this.showToast(App._t('auto.please_选择词条', '请先选择词条'), 'error'); return; }
        if (!confirm(App._t('common.confirm', '确认将选中的 ') + ids.length + ' 个词条移入回收站？')) return;
        const data = await this.fetchJSON('/api/v2/trash/batch-trash', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt_ids: ids })
        });
        if (data) {
            this.showToast('已移入回收站 ' + data.trashed + ' 条', 'success');
            var isCollView = this.state.currentView === 'collections' && !!this.state.currentCollection;
            this._afterBatchOp();
            if (isCollView) {
                this.loadCollections();
                this.loadCollectionItems();
            } else {
                this.loadPrompts();
            }
        }
    },

    async batchGenerateThumbnails() {
        var ids = [...this.state.batchSelected];
        if (ids.length === 0) { this.showToast(App._t('auto.please_选择词条', '请先选择词条'), 'error'); return; }
        this._batchIds = ids;
        this._openBatchGenDialog();
    },

    // ============ AI 批量生成配置弹窗 ============

    _openBatchGenDialog() {
        var self = this;
        var overlay = document.getElementById('batchGenDialog');
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.id = 'batchGenDialog';
            overlay.className = 'modal-overlay';
            overlay.style.cssText = 'display:none;z-index:760;';
            overlay.onclick = function(e) { if (e.target === overlay) overlay.style.display = 'none'; };
            overlay.innerHTML =
            '<style>' +
              '.bgen-btn{font-size:11px;padding:4px 10px;border:1px solid var(--border-color);border-radius:6px;background:transparent;color:var(--text-muted);cursor:pointer;}' +
              '.bgen-btn:hover{border-color:var(--primary);color:var(--primary);}' +
              '.bgen-item{display:flex;align-items:center;gap:8px;padding:5px 8px;border-radius:6px;font-size:11px;border:1px solid var(--border-color);}' +
            '</style>' +
            '<div class="modal-content" onclick="event.stopPropagation()" style="max-width:720px;max-height:88vh;display:flex;flex-direction:column;border-radius:14px;padding:0;overflow:hidden;">' +
              '<div class="modal-header" style="padding:12px 16px;border-bottom:1px solid var(--border-color);display:flex;justify-content:space-between;align-items:center;flex-shrink:0;">' +
                '<h5 style="margin:0;font-size:14px;"><i class="bi bi-magic"></i> AI 批量生成缩略图 <span id="bgenCount" style="font-size:11px;color:var(--text-muted);"></span></h5>' +
                '<button class="header-btn-sm" onclick="document.getElementById(\'batchGenDialog\').style.display=\'none\'">&times;</button>' +
              '</div>' +
              '<div class="modal-body" style="flex:1;overflow-y:auto;padding:12px 16px;display:flex;flex-direction:column;gap:12px;">' +
                // 处理范围（2026-08-10 全词库一键流水线）
                '<div style="display:flex;align-items:center;gap:8px;">' +
                  '<span style="font-size:12px;font-weight:600;">处理范围</span>' +
                  '<span style="display:flex;gap:2px;border:1px solid var(--border-color);border-radius:8px;padding:2px;">' +
                    '<button id="bgenScopeGroup" class="cwl-logview-btn active" onclick="App._batchScopeSet(\'group\')" title="仅处理当前分组勾选的词卡">当前分组</button>' +
                    '<button id="bgenScopeAll" class="cwl-logview-btn" onclick="App._batchScopeSet(\'all\')" title="自动检测全词库，跳过已优化/已 AI 生成，一次提交剩余">全部词库</button>' +
                  '</span>' +
                  '<span id="bgenScopeHint" style="font-size:10px;color:var(--text-muted);flex:1;"></span>' +
                '</div>' +
                // 选中卡预览：本次处理词卡清单（Ollama 优化 + 缩略图生成）
                // flex-shrink:0 防止弹窗内容多时被 flex 压缩导致清单显示不全
                '<div id="bgenPreview" style="border:1px solid #6366f1;border-radius:10px;padding:0;overflow:hidden;flex-shrink:0;">' +
                  '<div style="display:flex;align-items:center;gap:8px;padding:7px 10px;background:rgba(99,102,241,0.08);border-bottom:1px solid var(--border-color);flex-shrink:0;">' +
                    '<span style="font-size:12px;font-weight:600;color:#6366f1;"><i class="bi bi-check2-square"></i> 本次处理词卡</span>' +
                    '<span id="bgenSelCount" style="font-size:10px;background:#6366f1;color:#fff;border-radius:10px;padding:1px 8px;font-weight:600;"></span>' +
                    '<span id="bgenSelOptimized" style="font-size:10px;color:#10b981;margin-left:auto;flex-shrink:0;"></span>' +
                  '</div>' +
                  // 优化结果批量操作栏（有优化结果时显示）
                  '<div id="bgenPreviewBatchBar" style="display:none;align-items:center;gap:4px;padding:5px 8px;border-bottom:1px solid var(--border-color);flex-wrap:wrap;">' +
                    '<span id="bgenSavedHint" style="font-size:10px;color:var(--text-muted);margin-right:auto;"></span>' +
                    '<button type="button" class="bgen-btn" id="bgenReoptAllBtn" onclick="App._ollamaReoptimizeAll()" style="padding:1px 8px;font-size:10px;border-color:#8b5cf6;color:#8b5cf6;" title="重新优化勾选的词条（未勾选则全部）">🔄 全部重新优化</button>' +
                    '<button type="button" class="bgen-btn" id="bgenSaveAllBtn" onclick="App._ollamaSaveAll()" style="padding:1px 8px;font-size:10px;border-color:#10b981;color:#10b981;" title="所有优化结果一键存入对应词卡详细档">💾 全部存词卡</button>' +
                    '<button type="button" class="bgen-btn" onclick="App._ollamaRevertAll()" style="padding:1px 8px;font-size:10px;border-color:var(--border-color);color:var(--text-muted);" title="丢弃全部优化结果，恢复原始提示词">↩ 全部恢复</button>' +
                  '</div>' +
                  '<div id="bgenPreviewList" style="max-height:300px;overflow-y:auto;padding:4px 6px;"></div>' +
                '</div>' +
                // 生成引擎切换
                '<div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;">' +
                  '<span style="font-size:12px;font-weight:600;">生成引擎</span>' +
                  '<span style="display:flex;gap:2px;border:1px solid var(--border-color);border-radius:8px;padding:2px;">' +
                    '<button id="bgenEngineComfy" class="cwl-logview-btn active" onclick="App._batchEngine(\'comfyui\')" title="本地 ComfyUI 工作流生成"><i class="bi bi-cpu"></i> ComfyUI</button>' +
                    '<button id="bgenEngineDreamina" class="cwl-logview-btn" onclick="App._batchEngine(\'dreamina\')" title="即梦 AI 在线生成"><i class="bi bi-stars"></i> 即梦</button>' +
                    '<button id="bgenEngineLibtv" class="cwl-logview-btn" onclick="App._batchEngine(\'libtv\')" title="LibTV 在线生成"><i class="bi bi-collection"></i> LibTV</button>' +
                  '</span>' +
                  '<span id="bgenDreaminaStatus" style="font-size:10px;color:var(--text-muted);"></span>' +
                  '<button class="bgen-btn" onclick="App.openEngineAuth()" title="管理即梦/LibTV 授权账号" style="margin-left:auto;border-color:var(--primary);color:var(--primary);"><i class="bi bi-key"></i> 授权中心</button>' +
                '</div>' +
                // 即梦参数区
                '<div id="bgenDreaminaArea" style="display:none;border:1px solid #6366f1;border-radius:10px;padding:8px 10px;margin-bottom:10px;">' +
                  '<div style="font-size:12px;font-weight:600;margin-bottom:6px;"><i class="bi bi-stars"></i> 即梦参数 <span style="font-size:10px;color:var(--text-muted);font-weight:400;">在线生成，秒级出图</span></div>' +
                  '<div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;">' +
                    '<label style="font-size:10px;color:var(--text-muted);">模型版本 <select id="bgenDreaminaModel" style="font-size:11px;padding:4px 6px;border:1px solid var(--border-color);border-radius:6px;background:var(--bg-card);color:var(--text-main);">' +
                      '<option value="3.0">3.0</option><option value="3.1">3.1</option><option value="4.0">4.0</option><option value="4.1">4.1</option><option value="4.5">4.5</option><option value="4.6">4.6</option><option value="4.7">4.7</option><option value="5.0" selected>5.0</option><option value="5.0Pro">5.0Pro</option>' +
                    '</select></label>' +
                    '<label style="font-size:10px;color:var(--text-muted);">比例 <select id="bgenDreaminaRatio" style="font-size:11px;padding:4px 6px;border:1px solid var(--border-color);border-radius:6px;background:var(--bg-card);color:var(--text-main);">' +
                      '<option value="21:9">21:9</option><option value="16:9">16:9</option><option value="3:2">3:2</option><option value="4:3">4:3</option><option value="1:1" selected>1:1</option><option value="3:4">3:4</option><option value="2:3">2:3</option><option value="9:16">9:16</option>' +
                    '</select></label>' +
                    '<label style="font-size:10px;color:var(--text-muted);">分辨率 <select id="bgenDreaminaRes" style="font-size:11px;padding:4px 6px;border:1px solid var(--border-color);border-radius:6px;background:var(--bg-card);color:var(--text-main);">' +
                      '<option value="1k">1k</option><option value="2k" selected>2k</option><option value="4k">4k</option>' +
                    '</select></label>' +
                  '</div>' +
                '</div>' +
                // LibTV 参数区
                '<div id="bgenLibtvArea" style="display:none;border:1px solid #8b5cf6;border-radius:10px;padding:8px 10px;margin-bottom:10px;">' +
                  '<div style="font-size:12px;font-weight:600;margin-bottom:6px;"><i class="bi bi-collection"></i> LibTV 参数 <span style="font-size:10px;color:var(--text-muted);font-weight:400;">在线生成，免费模型免积分</span></div>' +
                  '<div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;">' +
                    '<label style="font-size:10px;color:var(--text-muted);">画布 <select id="bgenLibtvProject" style="font-size:11px;padding:4px 6px;border:1px solid var(--border-color);border-radius:6px;background:var(--bg-card);color:var(--text-main);min-width:140px;"><option value="">加载中...</option></select></label>' +
                    '<label style="font-size:10px;color:var(--text-muted);">模型 <select id="bgenLibtvModel" style="font-size:11px;padding:4px 6px;border:1px solid var(--border-color);border-radius:6px;background:var(--bg-card);color:var(--text-main);min-width:160px;"><option value="">加载中...</option></select></label>' +
                    '<label style="font-size:10px;color:var(--text-muted);">比例 <select id="bgenLibtvRatio" style="font-size:11px;padding:4px 6px;border:1px solid var(--border-color);border-radius:6px;background:var(--bg-card);color:var(--text-main);">' +
                      '<option value="1:1" selected>1:1</option><option value="16:9">16:9</option><option value="9:16">9:16</option><option value="4:3">4:3</option><option value="3:4">3:4</option><option value="21:9">21:9</option>' +
                    '</select></label>' +
                  '</div>' +
                  '<div id="bgenLibtvStatus" style="font-size:10px;color:var(--text-muted);margin-top:6px;"></div>' +
                '</div>' +
                // ComfyUI 模式区域（工作流选择 + 参数预设）
                '<div id="bgenComfyArea">' +
                // 工作流选择（可视化双视图：缩略图卡片 / 详细信息）
                '<div style="font-size:12px;font-weight:600;display:flex;align-items:center;gap:6px;"><i class="bi bi-diagram-3"></i> 生成工作流 <span id="bgenWfHint" style="font-size:10px;color:var(--text-muted);font-weight:400;"></span>' +
                  '<span style="margin-left:auto;display:flex;gap:2px;border:1px solid var(--border-color);border-radius:8px;padding:2px;">' +
                    '<button id="bgenWfViewGrid" class="cwl-logview-btn" onclick="App._batchWfView(\'grid\')" title="缩略图卡片模式"><i class="bi bi-grid-3x3-gap"></i> 卡片</button>' +
                    '<button id="bgenWfViewList" class="cwl-logview-btn" onclick="App._batchWfView(\'list\')" title="详细信息模式"><i class="bi bi-list-ul"></i> 详情</button>' +
                  '</span>' +
                '</div>' +
                '<div id="bgenWfGrid" style="display:none;grid-template-columns:repeat(auto-fill,minmax(132px,1fr));gap:8px;"></div>' +
                '<div id="bgenWfList" style="display:none;flex-direction:column;gap:5px;"></div>' +
                // 工作流信息卡
                '<div id="bgenWfInfo" style="border:1px dashed var(--border-color);border-radius:10px;padding:8px 10px;display:none;font-size:10px;color:var(--text-muted);line-height:1.7;"></div>' +
                // 参数预设
                '<div id="bgenPresetArea" style="display:none;">' +
                  '<div style="font-size:12px;font-weight:600;margin-bottom:4px;"><i class="bi bi-sliders"></i> 参数预设</div>' +
                  '<div id="bgenPresetBar" style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px;"></div>' +
                  '<div id="bgenSizeQuick" style="display:none;border:1px dashed #6366f1;border-radius:8px;padding:8px 10px;margin-bottom:8px;"></div>' +
                  '<div id="bgenPresetForm" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:8px;"></div>' +
                '</div>' +
                '</div>' +   // bgenComfyArea 结束

                // 提示词组合
                '<div id="bgenCompose" style="border:1px solid var(--border-color);border-radius:10px;padding:8px 10px;">' +
                  '<div style="font-size:12px;font-weight:600;margin-bottom:6px;"><i class="bi bi-fonts"></i> 提示词组合 <span style="font-size:10px;color:var(--text-muted);font-weight:400;">词卡内容 + 模块预设 + 品质后缀 → 注入工作流正面提示词</span></div>' +
                  // Ollama 优化工具条
                  '<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:6px;padding:6px 8px;border:1px dashed #10b981;border-radius:8px;background:rgba(16,185,129,0.04);">' +
                    '<span style="font-size:11px;font-weight:600;">✨ Ollama 优化</span>' +
                    '<span id="bgenOllamaStatus" style="font-size:10px;color:var(--text-muted);">检测中...</span>' +
                    '<select id="bgenOllamaModel" onchange="App._saveOllamaBar()" style="font-size:11px;padding:3px 6px;border:1px solid var(--border-color);border-radius:6px;background:var(--bg-card);color:var(--text-main);min-width:120px;"><option value="">选择模型</option></select>' +
                    '<select id="bgenOllamaLang" onchange="App._saveOllamaBar()" style="font-size:11px;padding:3px 6px;border:1px solid var(--border-color);border-radius:6px;background:var(--bg-card);color:var(--text-main);">' +
                      '<option value="en">English</option>' +
                      '<option value="zh">中文</option>' +
                    '</select>' +
                    '<input id="bgenOllamaMaxChars" type="number" min="50" max="3000" step="10" placeholder="字数不限" onchange="App._saveOllamaBar()" title="优化后目标字数（50-3000，留空不限）" style="width:80px;font-size:11px;padding:3px 6px;border:1px solid var(--border-color);border-radius:6px;background:var(--bg-card);color:var(--text-main);">' +
                    '<button type="button" class="bgen-btn" id="bgenOllamaBtn" onclick="App._enhanceBatchPrompts()" style="border-color:#10b981;color:#10b981;"><i class="bi bi-magic"></i> 优化选中卡提示词</button>' +
                    '<button type="button" class="bgen-btn" id="bgenUseDetailBtn" onclick="App._batchUseTier(\'detailed\')" style="border-color:#8b5cf6;color:#8b5cf6;" title="全部词条生成时使用详细档内容（含已存优化结果）">📚 全部使用详细</button>' +
                    '<button type="button" class="bgen-btn" id="bgenUseStdBtn" onclick="App._batchUseTier(\'standard\')" style="border-color:#64748b;color:#64748b;" title="全部词条生成时使用标准档内容（原始）">📋 全部使用标准</button>' +
                    '<span id="bgenOllamaHint" style="font-size:10px;color:var(--text-muted);"></span>' +
                  '</div>' +
                  // Ollama 优化结果（可编辑）—— 已融合进「本次处理词卡」清单（2026-08-08）
                  '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:6px;">' +
                    '<label style="font-size:10px;color:var(--text-muted);">品质后缀 <input id="bgenSuffix" value="cinematic lighting, high quality, 4k, detailed" oninput="App._renderBatchComposePreview()" style="width:220px;font-size:11px;padding:3px 6px;border:1px solid var(--border-color);border-radius:5px;background:var(--bg-card);color:var(--text-main);" title="留空则不添加后缀"></label>' +
                    '<label style="font-size:10px;color:var(--text-muted);display:flex;align-items:center;gap:4px;"><input type="checkbox" id="bgenUsePreset" checked onchange="App._renderBatchComposePreview()" style="width:14px;height:14px;"> 叠加模块主体预设</label>' +
                  '</div>' +
                  '<div style="margin-bottom:6px;">' +
                    '<label style="font-size:10px;color:var(--text-muted);display:block;margin-bottom:3px;">手动附加文本 <span style="color:#94a3b8;">（追加到每条组合提示词末尾，如风格/视角/负面词）</span></label>' +
                    '<textarea id="bgenManualText" rows="2" placeholder="例如：low-angle upward view, volumetric lighting, masterpiece" oninput="App._renderBatchComposePreview()" style="width:100%;font-size:11px;padding:5px 8px;border:1px solid var(--border-color);border-radius:6px;background:var(--bg-card);color:var(--text-main);resize:vertical;"></textarea>' +
                  '</div>' +
                  '<div id="bgenComposePreview" style="font-size:10px;color:var(--text-muted);background:var(--bg-card);border:1px dashed var(--border-color);border-radius:6px;padding:6px 8px;max-height:64px;overflow-y:auto;white-space:pre-wrap;word-break:break-all;"></div>' +
                '</div>' +
                // 一键流水线阶段状态（2026-08-10）
                '<div id="bgenPipelineStatus" style="display:none;font-size:11px;color:#8b5cf6;padding:6px 10px;border:1px dashed #8b5cf6;border-radius:8px;background:rgba(139,92,246,0.04);"></div>' +
                // 进度与明细
                '<div id="bgenProgressArea" style="display:none;">' +
                  '<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">' +
                    '<span style="font-size:11px;color:var(--text-muted);" id="bgenProgressText">准备中...</span>' +
                    '<span style="margin-left:auto;display:flex;gap:6px;">' +
                      '<button class="bgen-btn" id="bgenRetryBtn" onclick="App._retryBatchFailed()" style="border-color:#f59e0b;color:#f59e0b;display:none;"><i class="bi bi-arrow-repeat"></i> 重试失败</button>' +
                      '<button class="bgen-btn" id="bgenCancelBtn" onclick="App._cancelBatchGen()" style="border-color:#ef4444;color:#ef4444;"><i class="bi bi-x-circle"></i> 取消</button>' +
                    '</span>' +
                  '</div>' +
                  '<div style="height:8px;background:var(--border-color);border-radius:4px;overflow:hidden;margin-bottom:8px;">' +
                    '<div id="bgenProgressBar" style="height:100%;width:0%;background:linear-gradient(90deg,#6366f1,#8b5cf6);transition:width .3s;"></div>' +
                  '</div>' +
                  '<div id="bgenDetail" style="display:flex;flex-direction:column;gap:4px;max-height:160px;overflow-y:auto;"></div>' +
                  // 完成缩略图网格
                  '<div id="bgenGrid" style="display:none;margin-top:8px;">' +
                    '<div style="font-size:10px;color:var(--text-muted);margin-bottom:4px;">生成结果（点击放大）：</div>' +
                    '<div id="bgenGridItems" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(84px,1fr));gap:6px;"></div>' +
                  '</div>' +
                '</div>' +
              '</div>' +
              '<div class="modal-footer" style="padding:10px 16px;border-top:1px solid var(--border-color);display:flex;gap:8px;justify-content:flex-end;align-items:center;flex-shrink:0;">' +
                '<span id="bgenFooterHint" style="margin-right:auto;font-size:10px;color:var(--text-muted);"></span>' +
                // 批次控制（2026-08-10：在线引擎防限流/降单批失败面）
                '<span style="display:flex;align-items:center;gap:4px;font-size:10px;color:var(--text-muted);white-space:nowrap;">每批' +
                  '<select id="bgenBatchSize" onchange="App._batchSizeChanged()" title="每批自动提交张数：批次小则单任务失败影响面小；在线引擎建议 ≤20" style="font-size:11px;padding:2px 4px;border:1px solid var(--border-color);border-radius:5px;background:var(--bg-card);color:var(--text-main);">' +
                    '<option value="10">10</option><option value="20" selected>20</option><option value="50">50</option><option value="100">100</option><option value="200">200</option><option value="0">不限</option>' +
                  '</select>张</span>' +
                // 一键完整流水线（2026-08-10：仅全词库模式显示）
                '<button class="btn btn-sm" id="bgenPipelineBtn" onclick="App._batchRunPipeline()" style="display:none;border:1px solid #8b5cf6;color:#8b5cf6;background:rgba(139,92,246,0.06);font-size:12px;" title="自动执行：① Ollama 优化未优化的卡 → ② 保存到词卡详细档 → ③ 提交生成任务（按批次）"><i class="bi bi-rocket-takeoff"></i> 🚀 一键完整处理</button>' +
                '<button class="btn btn-secondary btn-sm" onclick="document.getElementById(\'batchGenDialog\').style.display=\'none\'">关闭</button>' +
                '<button class="btn btn-primary btn-sm" id="bgenStartBtn" onclick="App._startBatchGen()"><i class="bi bi-play-fill"></i> 开始生成</button>' +
              '</div>' +
            '</div>';
            document.body.appendChild(overlay);
        }
        overlay.style.display = 'flex';
        // 多任务队列：恢复所有未完成任务追踪（各自独立轮询，互不影响）
        this._batchTaskIds = this._batchTaskIds || [];
        if (this._batchTaskIds.length === 0) {
            this._batchGenRunning = false;
        } else {
            for (var _br = 0; _br < this._batchTaskIds.length; _br++) {
                this._pollBatchTask(this._batchTaskIds[_br]);
            }
        }
        // 弹窗当前显示任务：队列中最后提交的任务（完成后自动切换到下一个）
        this._batchTaskId = this._batchTaskIds.length > 0 ? this._batchTaskIds[this._batchTaskIds.length - 1] : null;
        // 选中卡预览：本次处理词卡清单（Ollama 优化 + 缩略图生成）
        var cnt = document.getElementById('bgenCount');
        // 2026-08-10: 恢复处理范围（group=当前分组 / all=全词库扫描）
        this._batchScope = this._batchScope || 'group';
        this._batchPreviewTab = this._batchPreviewTab || 'all';
        this._batchScopeSet(this._batchScope, true);
        if (cnt) cnt.textContent = '（' + (this._batchIds || []).length + ' 张）';
        this._ollamaUpdateHint();
        // 加载工作流库（先恢复上次参数设置）
        this._restoreBatchSettings();
        this._loadBatchWorkflows();
        // 加载模块主体预设（供提示词组合预览）
        var self = this;
        this.fetchJSON('/api/v2/comfyui/module-presets').then(function(d) {
            if (d && d.ok) self._modulePresets = d.presets || {};
            self._renderBatchComposePreview();
        }).catch(function() { self._modulePresets = {}; self._renderBatchComposePreview(); });
        // Ollama 状态检测（模型列表/语言恢复）
        this._initOllamaBar();
        // 初始化当前引擎授权状态（弹窗重开时避免状态文本空白导致误判未授权）
        var _curEngine = this._batchEngineMode || 'comfyui';
        if (_curEngine === 'dreamina' && typeof this._initDreaminaStatus === 'function') this._initDreaminaStatus();
        else if (_curEngine === 'libtv' && typeof this._initLibtv === 'function') this._initLibtv();
        this._batchPromptOverrides = this._batchPromptOverrides || {};
        // 恢复临时存储的优化结果（自动识别已优化词条）
        var hadRestored = this._loadOllamaOverrides();
        // 重置优化结果区（新打开弹窗不带旧结果，但恢复的除外）
        if (!hadRestored) {
            var resBox = document.getElementById('bgenOllamaResults');
            if (resBox) { resBox.style.display = 'none'; resBox.innerHTML = ''; }
        }
        // 2026-08-11: 断点任务自主识别 + 询问提醒（启动恢复报告）
        this._checkResumeReport();
    },

    // ============ 启动恢复报告检查（2026-08-11 断点任务提醒） ============
    _checkResumeReport() {
        var self = this;
        this.fetchJSON('/api/v2/comfyui/batch-tasks/resume-report').then(function(d) {
            if (!d || !d.ok || !d.report) return;
            var rep = d.report;
            if (!rep.resumed && !rep.error_count) return;
            // 同一报告只询问一次（localStorage 按报告时间戳去重）
            var lastAck = localStorage.getItem('bgenResumeAck') || '';
            if (lastAck === rep.created_at) return;
            var parts = [];
            if (rep.resumed > 0) {
                parts.push('已自动恢复 ' + rep.resumed + ' 个中断任务（断点续跑，共 ' + rep.total_cards + ' 张词卡，正在后台继续执行）');
            }
            if (rep.error_count > 0) {
                parts.push(rep.error_count + ' 个异常任务待处理（可在任务列表查看/重试）');
            }
            var msg = '检测到上次中断的批量生成任务：\n\n' + parts.join('\n') + '\n\n已恢复任务正在后台继续执行，请勿重复提交相同词卡（任务进度见下方列表）。';
            if (confirm(msg + '\n\n[确定] 知道了（本次不再提醒）    [取消] 稍后再说')) {
                localStorage.setItem('bgenResumeAck', rep.created_at);
            }
        }).catch(function() {});
    },

    // ============ 处理范围（2026-08-10 全词库一键流水线） ============

    // 切换处理范围：group=当前分组勾选 / all=全词库自动检测
    _batchScopeSet(mode, silent) {
        this._batchScope = mode;
        var bg = document.getElementById('bgenScopeGroup');
        var ba = document.getElementById('bgenScopeAll');
        if (bg) bg.className = 'cwl-logview-btn' + (mode === 'group' ? ' active' : '');
        if (ba) ba.className = 'cwl-logview-btn' + (mode === 'all' ? ' active' : '');
        // 2026-08-10: 一键流水线按钮/状态条仅全词库模式显示
        var pb = document.getElementById('bgenPipelineBtn');
        if (pb) pb.style.display = (mode === 'all') ? '' : 'none';
        var ps = document.getElementById('bgenPipelineStatus');
        if (ps) ps.style.display = (mode === 'all') ? '' : 'none';
        if (mode === 'group') {
            var hint = document.getElementById('bgenScopeHint');
            if (hint) hint.textContent = '仅处理当前分组勾选的 ' + (this._batchIds || []).length + ' 张';
            this._renderBatchPreview();
        } else {
            var h2 = document.getElementById('bgenScopeHint');
            if (h2) h2.textContent = '正在扫描全词库...';
            this._batchScopeApply();
        }
        if (!silent) this._saveBatchSettings();
    },

    // 拉取全词库完成态扫描（batch-scan 后端判定，前端不猜；带当前引擎维度）
    async _batchScopeApply() {
        var self = this;
        try {
            var d = await this.fetchJSON('/api/v2/comfyui/batch-scan', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ scope: 'all', engine: this._batchEngineMode || 'comfyui' })
            });
            if (!d || !d.ok) throw new Error((d && d.error) || '扫描失败');
            this._batchScanResult = d;
            this._renderBatchPreview();
            var cnt = document.getElementById('bgenCount');
            if (cnt) cnt.textContent = '（全词库 ' + d.stats.total + ' 张）';
            var hint = document.getElementById('bgenScopeHint');
            var st = this._batchScanStats();
            if (hint) hint.textContent = '已扫描 ' + d.stats.total + ' 张，按当前引擎判定完成';
        } catch(e) {
            var hint = document.getElementById('bgenScopeHint');
            if (hint) hint.textContent = '扫描失败: ' + e.message;
            this._batchScope = 'group';
            var bg = document.getElementById('bgenScopeGroup');
            var ba = document.getElementById('bgenScopeAll');
            if (bg) bg.className = 'cwl-logview-btn active';
            if (ba) ba.className = 'cwl-logview-btn';
            this._renderBatchPreview();
        }
    },

    // 全词库扫描统计：本次处理数 = 待处理 + 仅生成 + 手动图 + 未知 + 其他引擎（跳过当前引擎完成/队列）
    _batchScanStats() {
        var d = this._batchScanResult;
        if (!d || !d.stats) return null;
        var st = d.stats;
        var todo = st.pending + st.opt_only + st.manual + st.unknown + st.other_engine;
        return {
            todo: todo,
            text: '待处理 ' + st.pending + ' · 仅生成 ' + st.opt_only + ' · 其他引擎 ' + st.other_engine + ' · 手动图 ' + st.manual + ' · 未知 ' + st.unknown + ' · 本引擎完成 ' + st.ai_generated + ' · 队列 ' + st.queued
        };
    },

    // 引擎显示名
    _engineName(eng) {
        if (eng === 'comfyui') return 'ComfyUI';
        if (eng === 'dreamina') return '即梦';
        if (eng === 'libtv') return 'LibTV';
        return '未知';
    },

    // 全词库扫描清单渲染（分类 Tab + 状态徽章 + 底部本次处理提示；引擎维度）
    _renderScanPreview() {
        var self = this;
        var d = this._batchScanResult;
        var list = document.getElementById('bgenPreviewList');
        if (!list || !d) return;
        var prevScrollTop = list.scrollTop;
        var st = this._batchScanStats();
        var items = d.items || [];
        var tab = this._batchPreviewTab || 'all';
        var curEngine = this._batchEngineMode || 'comfyui';
        // 引擎匹配：ai 图且引擎与当前一致；引擎未知（旧链路）默认视为完成（二喵决策 2026-08-10）
        var isSameEngine = function(it) {
            return it.thumb_state === 'ai' && (it.thumb_engine === curEngine || !it.thumb_engine || it.thumb_engine === 'unknown');
        };
        var filtered = [];
        for (var i = 0; i < items.length; i++) {
            var it = items[i];
            if (tab === 'all') { filtered.push(it); continue; }
            if (tab === 'todo' && it.thumb_state === 'none' && !it.optimized && !it.queued) { filtered.push(it); continue; }
            if (tab === 'gen' && it.thumb_state === 'none' && it.optimized && !it.queued) { filtered.push(it); continue; }
            if (tab === 'other' && it.thumb_state === 'ai' && !isSameEngine(it) && !it.queued) { filtered.push(it); continue; }
            if (tab === 'manual' && it.thumb_state === 'manual') { filtered.push(it); continue; }
            if (tab === 'done' && (it.queued || isSameEngine(it))) { filtered.push(it); continue; }
        }
        var selCnt = document.getElementById('bgenSelCount');
        if (selCnt) selCnt.textContent = filtered.length + ' 张';
        var opt = document.getElementById('bgenSelOptimized');
        if (opt) opt.textContent = st ? st.text : '';
        // 2026-08-10: 全词库模式操作栏随优化结果显示（全部存词卡/重新优化等作用于 overrides 全集）
        var bar = document.getElementById('bgenPreviewBatchBar');
        var ovCount = Object.keys(this._batchPromptOverrides || {}).length;
        if (bar) bar.style.display = ovCount > 0 ? 'flex' : 'none';
        // 2026-08-10: 优化按钮文案跟随范围（全词库=优化全部待优化卡）
        var ollamaBtn = document.getElementById('bgenOllamaBtn');
        if (ollamaBtn) ollamaBtn.innerHTML = '<i class="bi bi-magic"></i> 优化全部待优化 (' + d.stats.pending + ')';
        var html = '';
        // 分类 Tab 栏（其他引擎 = 非当前引擎生成的 AI 图，纳入待处理）
        html += '<div style="display:flex;gap:3px;padding:2px 0 6px;border-bottom:1px dashed var(--border-color);margin-bottom:4px;flex-wrap:wrap;">';
        var tabs = [['all', '全部 ' + items.length], ['todo', '待处理 ' + d.stats.pending], ['gen', '仅生成 ' + d.stats.opt_only], ['other', '其他引擎 ' + d.stats.other_engine], ['manual', '手动图 ' + d.stats.manual], ['done', '已完成 ' + (d.stats.ai_generated + d.stats.queued)]];
        for (var t = 0; t < tabs.length; t++) {
            var active = tab === tabs[t][0];
            html += '<button type="button" onclick="App._batchPreviewTabSet(\'' + tabs[t][0] + '\')" style="font-size:10px;padding:2px 8px;border-radius:10px;border:1px solid ' + (active ? 'var(--primary)' : 'var(--border-color)') + ';color:' + (active ? 'var(--primary)' : 'var(--text-muted)') + ';background:transparent;cursor:pointer;">' + tabs[t][1] + '</button>';
        }
        html += '</div>';
        if (filtered.length === 0) {
            html += '<div style="font-size:11px;color:var(--text-muted);padding:8px 6px;">该分类无词卡</div>';
            list.innerHTML = html;
            return;
        }
        for (var j = 0; j < filtered.length; j++) {
            var it2 = filtered[j];
            var thumb = it2.thumbnail
                ? '<img src="/api/thumbnails/file/' + it2.thumbnail + '" style="width:34px;height:24px;object-fit:cover;border-radius:4px;flex-shrink:0;" loading="lazy" onerror="this.style.display=\'none\'">'
                : '<span style="width:34px;text-align:center;flex-shrink:0;font-size:13px;">🖼️</span>';
            var label = ((it2.group_name ? it2.group_name + ' · ' : '') + (it2.name || ('词卡 #' + it2.id))).slice(0, 40);
            var badges = '';
            if (it2.queued) badges += '<span style="font-size:9px;color:#d97706;background:rgba(217,119,6,0.1);border:1px solid rgba(217,119,6,0.3);border-radius:4px;padding:0 5px;flex-shrink:0;">⏳ 队列中</span>';
            if (it2.optimized) badges += '<span style="font-size:9px;color:#10b981;flex-shrink:0;font-weight:600;">✨ 已优化</span>';
            if (it2.thumb_state === 'ai') {
                if (isSameEngine(it2)) {
                    if (it2.thumb_engine === 'unknown' || !it2.thumb_engine) {
                        badges += '<span style="font-size:9px;color:#059669;background:rgba(5,150,105,0.1);border:1px solid rgba(5,150,105,0.25);border-radius:4px;padding:0 5px;flex-shrink:0;" title="引擎未知（旧链路），默认视为完成跳过">✅ 已生成（引擎未知）</span>';
                    } else {
                        badges += '<span style="font-size:9px;color:#059669;background:rgba(5,150,105,0.1);border:1px solid rgba(5,150,105,0.25);border-radius:4px;padding:0 5px;flex-shrink:0;">✅ 本引擎已生成</span>';
                    }
                } else {
                    var engName = this._engineName(it2.thumb_engine);
                    badges += '<span style="font-size:9px;color:#8b5cf6;background:rgba(139,92,246,0.08);border:1px solid rgba(139,92,246,0.3);border-radius:4px;padding:0 5px;flex-shrink:0;" title="由 ' + engName + ' 生成，非当前引擎，将用当前引擎重新生成">⚙️ ' + engName + ' 已生成</span>';
                }
            } else if (it2.thumb_state === 'manual') {
                badges += '<span style="font-size:9px;color:#f59e0b;background:rgba(245,158,11,0.1);border:1px solid rgba(245,158,11,0.3);border-radius:4px;padding:0 5px;flex-shrink:0;" title="手动指定的预览图，本次将 AI 生成覆盖">🖼️ 手动图</span>';
            } else if (it2.thumb_state === 'unknown') {
                badges += '<span style="font-size:9px;color:#94a3b8;border:1px dashed var(--border-color);border-radius:4px;padding:0 5px;flex-shrink:0;" title="缩略图来源无法判定（文件丢失），保守纳入生成">❓ 未知</span>';
            }
            html += '<div style="border:1px solid var(--border-color);border-radius:8px;padding:5px 8px;margin-bottom:4px;background:var(--bg-card);">' +
                '<div style="display:flex;align-items:center;gap:6px;">' +
                '<span style="font-size:10px;color:var(--text-muted);width:26px;flex-shrink:0;text-align:right;">' + (j + 1) + '</span>' +
                thumb +
                '<span style="flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:11px;color:var(--text-main);" title="' + App._escape(it2.name || '') + '">' + App._escape(label) + '</span>' +
                badges +
                '</div></div>';
        }
        list.innerHTML = html;
        if (prevScrollTop > 0 && list.scrollHeight > prevScrollTop) list.scrollTop = prevScrollTop;
        var sh = document.createElement('div');
        sh.style.cssText = 'position:sticky;bottom:0;font-size:10px;color:var(--primary);text-align:center;padding:4px 0 5px;background:linear-gradient(transparent,var(--bg-card) 40%);pointer-events:none;';
        sh.textContent = '本次将处理 ' + st.todo + ' 张（其他引擎生成/手动图/未知将用当前引擎 ' + this._engineName(curEngine) + ' 重新生成）';
        list.appendChild(sh);
    },

    // 分类 Tab 切换
    _batchPreviewTabSet(tab) {
        this._batchPreviewTab = tab;
        this._renderBatchPreview();
    },

    // ============ 全词库流程编排（2026-08-10 一键流水线） ============

    // 待处理集合：optimize=待优化（无图无详细档非队列）；generate=待生成（非本引擎完成）
    _batchPendingIds(mode) {
        if (this._batchScope === 'all' && this._batchScanResult) {
            var curEngine = this._batchEngineMode || 'comfyui';
            var out = [];
            var items = this._batchScanResult.items || [];
            for (var i = 0; i < items.length; i++) {
                var it = items[i];
                if (it.queued) continue;
                if (mode === 'optimize') {
                    if (it.thumb_state === 'none' && !it.optimized) out.push(it.id);
                } else {
                    // generate：跳过本引擎完成/未知引擎（默认视为完成）
                    if (it.thumb_state === 'ai' && (it.thumb_engine === curEngine || !it.thumb_engine || it.thumb_engine === 'unknown')) continue;
                    out.push(it.id);
                }
            }
            return out;
        }
        return (this._batchIds || []).slice();
    },

    // 批量取词卡内容（batch-cards 接口，缓存供全词库 Ollama 优化使用）
    async _batchLoadCardTexts(ids) {
        var need = [];
        this._batchCardTexts = this._batchCardTexts || {};
        for (var i = 0; i < ids.length; i++) {
            if (!this._batchCardTexts[ids[i]]) need.push(ids[i]);
        }
        if (need.length === 0) return this._batchCardTexts;
        var d = await this.fetchJSON('/api/v2/comfyui/batch-cards', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ids: need, card_type_map: {} })
        });
        if (d && d.ok) {
            for (var j = 0; j < d.cards.length; j++) {
                this._batchCardTexts[d.cards[j].id] = d.cards[j];
            }
        }
        return this._batchCardTexts;
    },

    // 等待 Ollama 优化队列排空（流水线串联用）
    _batchWaitOllamaQueue() {
        var self = this;
        return new Promise(function(resolve) {
            var timer = setInterval(function() {
                if (!self._ollamaQueueRunning && (!self._ollamaQueue || self._ollamaQueue.length === 0)) {
                    clearInterval(timer);
                    resolve();
                }
            }, 500);
        });
    },

    // 一键完整流水线（全词库模式）：① 优化未优化 → ② 全部存词卡 → ③ 提交生成（按批次）
    async _batchRunPipeline() {
        if (this._batchScope !== 'all') {
            this.showToast('一键完整处理仅在全词库模式可用', 'warning');
            return;
        }
        if (this._pipelineRunning) { this.showToast('流水线执行中，请稍候', 'warning'); return; }
        var model = (document.getElementById('bgenOllamaModel') || {}).value;
        if (!model) { this.showToast('请先选择 Ollama 模型（流水线第一步是提示词优化）', 'warning'); return; }
        this._pipelineRunning = true;
        var btn = document.getElementById('bgenPipelineBtn');
        if (btn) { btn.disabled = true; btn.innerHTML = '⏳ 流水线执行中...'; }
        var stEl = document.getElementById('bgenPipelineStatus');
        try {
            // ① 优化未优化的卡（串行队列，自动跳过已有优化）
            var optIds = this._batchPendingIds('optimize');
            if (optIds.length > 0) {
                if (stEl) stEl.textContent = '① 优化提示词 ' + optIds.length + ' 张...';
                await this._batchLoadCardTexts(optIds);
                this._enhanceBatchPrompts();
                await this._batchWaitOllamaQueue();
            } else if (stEl) {
                stEl.textContent = '① 无待优化词卡，跳过';
            }
            // ② 保存全部优化结果到词卡详细档（生成时使用详细档提示词）
            var ovKeys = Object.keys(this._batchPromptOverrides || {});
            var unsaved = 0;
            for (var k = 0; k < ovKeys.length; k++) {
                if (!(this._ollamaSaved && this._ollamaSaved[ovKeys[k]] === true)) unsaved++;
            }
            if (unsaved > 0) {
                if (stEl) stEl.textContent = '② 保存优化结果 ' + unsaved + ' 条到词卡...';
                await this._ollamaSaveAll();
            } else if (stEl) {
                stEl.textContent = '② 优化结果均已保存，跳过';
            }
            // ③ 提交生成任务（后端按批次切片；本引擎完成/队列自动跳过）
            var genIds = this._batchPendingIds('generate');
            if (genIds.length === 0) {
                if (stEl) stEl.textContent = '③ 无待生成词卡（已全部提交/完成），跳过生成';
                this.showToast('流水线完成：优化 + 保存完成，无待生成词卡（均已提交或已完成）', 'info');
            } else {
                if (stEl) stEl.textContent = '③ 提交生成任务 ' + genIds.length + ' 张...';
                var ok = await this._startBatchGen();
                if (ok === false) {
                    if (stEl) stEl.textContent = '③ 生成未提交：' + ((document.getElementById('bgenProgressText') || {}).textContent || '见上方提示');
                } else {
                    if (stEl) stEl.textContent = '✅ 流水线完成：优化 → 保存 → 生成已提交，后台执行中';
                    this.showToast('一键流水线完成：优化 → 保存 → 生成已提交（后台执行）', 'success');
                }
            }
        } catch(e) {
            this.showToast('流水线异常: ' + e.message, 'error');
            if (stEl) stEl.textContent = '❌ 流水线异常: ' + e.message;
        } finally {
            this._pipelineRunning = false;
            if (btn) { btn.disabled = false; btn.innerHTML = '🚀 一键完整处理'; }
        }
    },

    // 本次处理词卡清单渲染：完整列出选中词卡（缩略图/名称/优化状态），
    // 与 Ollama 优化结果联动（overrides 变化时徽章自动刷新）
    _renderBatchPreview() {
        var list = document.getElementById('bgenPreviewList');
        if (!list) return;
        // 记录滚动位置：存词卡/恢复等操作后重绘不跳回顶部
        var prevScrollTop = list.scrollTop;
        // 2026-08-10: 全词库模式 → 扫描结果渲染（分类 Tab/状态徽章/统计）
        if (this._batchScope === 'all' && this._batchScanResult) {
            this._renderScanPreview();
            return;
        }
        var ids = this._batchIds || [];
        // 2026-08-10: 分组模式恢复优化按钮文案
        var ollamaBtn = document.getElementById('bgenOllamaBtn');
        if (ollamaBtn) ollamaBtn.innerHTML = '<i class="bi bi-magic"></i> 优化选中卡提示词';
        var cnt = document.getElementById('bgenSelCount');
        if (cnt) cnt.textContent = ids.length + ' 张';
        var overrides = this._batchPromptOverrides || {};
        var saved = this._ollamaSaved || {};
        var optCnt = 0, queuedCnt = 0, savedCnt = 0;
        for (var _oi = 0; _oi < ids.length; _oi++) {
            if (overrides[ids[_oi]]) { optCnt++; if (saved[ids[_oi]] === true) savedCnt++; }
            if (this._batchQueuedPids && this._batchQueuedPids[ids[_oi]]) queuedCnt++;
        }
        var opt = document.getElementById('bgenSelOptimized');
        if (opt) {
            var stParts = [];
            if (optCnt > 0) stParts.push('✨ 已优化 ' + optCnt);
            if (queuedCnt > 0) stParts.push('⏳ 队列 ' + queuedCnt);
            opt.textContent = stParts.length > 0 ? stParts.join(' · ') : '（Ollama 优化 + 缩略图生成）';
        }
        // 批量操作栏：有优化结果时显示（含保存进度提示）
        var bar = document.getElementById('bgenPreviewBatchBar');
        var sHint = document.getElementById('bgenSavedHint');
        if (bar) bar.style.display = optCnt > 0 ? 'flex' : 'none';
        if (sHint) sHint.textContent = optCnt > 0 ? ('已存 ' + savedCnt + ' / ' + optCnt + ' 条') : '';
        if (ids.length === 0) {
            list.innerHTML = '<div style="font-size:11px;color:var(--text-muted);padding:8px 6px;">未选择词卡 — 返回页面勾选后重新打开本弹窗</div>';
            return;
        }
        var html = '';
        for (var i = 0; i < ids.length; i++) {
            var pid = ids[i];
            var card = this._findCardForPreview(pid);
            var thumb = (card && card.thumbnail)
                ? '<img src="/api/thumbnails/file/' + card.thumbnail + '" style="width:34px;height:24px;object-fit:cover;border-radius:4px;flex-shrink:0;" loading="lazy" onerror="this.style.display=\'none\'">'
                : '<span style="width:34px;text-align:center;flex-shrink:0;font-size:13px;">🖼️</span>';
            var name = card ? (card.name || card.category || '') : '';
            var content = card ? (card.content || '') : '';
            var label = ((name ? name + ' · ' : '') + (content || ('词卡 #' + pid))).slice(0, 44);
            var optBadge = overrides[pid]
                ? '<span style="font-size:9px;color:#10b981;flex-shrink:0;font-weight:600;">✨ 已优化</span>'
                : '<span style="font-size:9px;color:#94a3b8;flex-shrink:0;">待优化</span>';
            // 缩略图状态徽章：已生成 / 队列中（自动跳过依据）
            var thumbBadge = '';
            if (card && card.thumbnail) {
                thumbBadge = '<span style="font-size:9px;color:#059669;background:rgba(5,150,105,0.1);border:1px solid rgba(5,150,105,0.25);border-radius:4px;padding:0 5px;flex-shrink:0;white-space:nowrap;">✅ 已生成</span>';
            } else if (this._batchQueuedPids && this._batchQueuedPids[pid]) {
                thumbBadge = '<span style="font-size:9px;color:#d97706;background:rgba(217,119,6,0.1);border:1px solid rgba(217,119,6,0.3);border-radius:4px;padding:0 5px;flex-shrink:0;white-space:nowrap;">⏳ 队列中</span>';
            }
            // 分组标记：用于判别是否选错词卡
            var groupBadge = '';
            if (card && card.group_name) {
                groupBadge = '<span style="font-size:9px;color:#6366f1;background:rgba(99,102,241,0.08);border:1px solid rgba(99,102,241,0.25);border-radius:4px;padding:0 5px;flex-shrink:0;white-space:nowrap;">📁 ' + App._escape(card.group_name) + '</span>';
            }
            // 优化结果区（仅该卡有优化结果时显示，内嵌在词卡行内）
            var optArea = '';
            if (overrides[pid]) {
                var st = saved[pid];
                var stHtml = st === true ? '<span style="font-size:9px;color:#10b981;">✓ 已存</span>'
                    : (st === false ? '<span style="font-size:9px;color:#ef4444;">✗ 失败</span>' : '');
                var saveBtn = st === true
                    ? '<button type="button" class="bgen-btn" disabled style="padding:1px 6px;font-size:10px;border-color:#10b981;color:#10b981;opacity:0.7;" title="已存入词卡详细档">✓ 已存</button>'
                    : '<button type="button" class="bgen-btn" style="padding:1px 6px;font-size:10px;border-color:#10b981;color:#10b981;" onclick="App._ollamaSaveToCard(' + pid + ')" title="优化结果存入词卡详细档">💾 存词卡</button>';
                optArea = '<div style="margin-top:4px;padding-left:62px;">' +
                    '<textarea data-pid="' + pid + '" rows="2" oninput="App._ollamaEdit(this)" placeholder="优化结果（可直接编辑后存词卡）..." style="width:100%;box-sizing:border-box;font-size:11px;padding:4px 6px;border:1px solid var(--border-color);border-radius:6px;background:var(--bg-card);color:var(--text-main);resize:vertical;">' + App._escape(overrides[pid] || '') + '</textarea>' +
                    '<div style="display:flex;align-items:center;gap:4px;margin-top:3px;">' +
                    stHtml +
                    saveBtn +
                    '<button type="button" class="bgen-btn" style="padding:1px 6px;font-size:10px;border-color:#8b5cf6;color:#8b5cf6;" onclick="App._ollamaReoptimize(' + pid + ', this)" title="用当前模型/语言/字数重新优化本条">🔄 重新优化</button>' +
                    '<button type="button" class="bgen-btn" style="padding:1px 6px;font-size:10px;border-color:var(--border-color);color:var(--text-muted);" onclick="App._ollamaRevert(' + pid + ')">↩ 恢复原词</button>' +
                    '</div>' +
                    '</div>';
            }
            html += '<div style="border:1px solid var(--border-color);border-radius:8px;padding:5px 8px;margin-bottom:4px;background:var(--bg-card);">' +
                '<div style="display:flex;align-items:center;gap:6px;">' +
                '<input type="checkbox" class="ollama-reopt-check" data-pid="' + pid + '" title="勾选参与「全部重新优化」" style="width:13px;height:13px;flex-shrink:0;">' +
                '<span style="font-size:10px;color:var(--text-muted);width:22px;flex-shrink:0;text-align:right;">' + (i + 1) + '</span>' +
                thumb +
                '<span style="flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:11px;color:var(--text-main);" title="' + App._escape((card ? (card.group_name ? '【' + card.group_name + '】' : '') + (name ? name + '\n' : '') + content : ('词卡 #' + pid))) + '">' + App._escape(label) + '</span>' +
                groupBadge +
                thumbBadge +
                optBadge +
                '</div>' +
                optArea +
                '</div>';
        }
        list.innerHTML = html;
        // 保留滚动位置（重绘后不跳回顶部，避免用户丢失操作行）
        if (prevScrollTop > 0 && list.scrollHeight > prevScrollTop) list.scrollTop = prevScrollTop;
        // 滚动提示：清单超出可视区时在底部显示提示条（sticky 贴底，始终可见）
        if (list.scrollHeight > list.clientHeight + 4) {
            var sh = document.createElement('div');
            sh.style.cssText = 'position:sticky;bottom:0;font-size:9px;color:#94a3b8;text-align:center;padding:3px 0 4px;background:linear-gradient(transparent,var(--bg-card) 40%);pointer-events:none;';
            sh.textContent = '▼ 共 ' + ids.length + ' 张，滚动查看全部';
            list.appendChild(sh);
        }
    },

    // 跨数据源查找词卡（prompts 列表 / 收藏夹列表），返回 null 表示不在当前数据源
    _findCardForPreview(pid) {
        var sources = [this.state.prompts, this.state.collectionItems];
        for (var s = 0; s < sources.length; s++) {
            var arr = sources[s] || [];
            for (var i = 0; i < arr.length; i++) {
                if (String(arr[i].id) === String(pid)) return arr[i];
            }
        }
        return null;
    },

    // 提示词组合预览：模块预设 + 词卡 + 品质后缀 + 手动附加文本（复刻后端组合规则）
    _renderBatchComposePreview() {
        var el = document.getElementById('bgenComposePreview');
        if (!el) return;
        var self = this;
        var suffix = ((document.getElementById('bgenSuffix') || {}).value || '').trim();
        var manual = ((document.getElementById('bgenManualText') || {}).value || '').trim();
        var usePreset = !!(document.getElementById('bgenUsePreset') || {}).checked;
        var cards = [];
        // 跨数据源查找（prompts 列表 / 收藏夹列表），最多预览 3 张
        var ids = this._batchIds || [];
        for (var _cp = 0; _cp < ids.length && cards.length < 3; _cp++) {
            var _cd = this._findCardForPreview(ids[_cp]);
            if (_cd) cards.push(_cd);
        }
        var lines = cards.map(function(p) {
            var preset = '';
            if (usePreset && self._modulePresets) {
                var pm = self._modulePresets[p.module] || {};
                if (pm.enabled && pm.preset) preset = pm.preset;
            }
            var cardText = p.content || '';
            var isOpt = false;
            if (self._batchPromptOverrides && self._batchPromptOverrides[p.id]) {
                cardText = self._batchPromptOverrides[p.id];
                isOpt = true;
            }
            var composed = App._composePromptPreview(preset, cardText, suffix);
            if (manual) composed = (composed ? composed.replace(/,\s*$/, '') + ', ' + manual : manual);
            return (isOpt ? '✨ ' : '') + composed;
        });
        if (lines.length === 0) {
            el.innerHTML = '<span style="color:var(--text-muted);">（无法预览，请确认已选中词条）</span>';
            return;
        }
        var html = lines.map(function(l) { return '· ' + App._escape(l); }).join('<br>');
        if ((self._batchIds || []).length > 3) html += '<br><span style="color:var(--text-muted);">…等共 ' + self._batchIds.length + ' 条（每条按各自模块预设组合）</span>';
        el.innerHTML = html;
    },

    // 生成引擎切换（ComfyUI / 即梦 / LibTV）
    _batchEngine(mode) {
        this._batchEngineMode = mode;
        var cb = document.getElementById('bgenEngineComfy');
        var db2 = document.getElementById('bgenEngineDreamina');
        var lb = document.getElementById('bgenEngineLibtv');
        if (cb) cb.className = 'cwl-logview-btn' + (mode === 'comfyui' ? ' active' : '');
        if (db2) db2.className = 'cwl-logview-btn' + (mode === 'dreamina' ? ' active' : '');
        if (lb) lb.className = 'cwl-logview-btn' + (mode === 'libtv' ? ' active' : '');
        // 2026-08-10: 批次默认值引擎自适应（用户未手动改过时）：在线引擎 20 / 本地 ComfyUI 50
        if (!this._batchSizeTouched) {
            var bsEl = document.getElementById('bgenBatchSize');
            if (bsEl) bsEl.value = (mode === 'comfyui') ? '50' : '20';
        }
        // 2026-08-10: 引擎切换 → 全词库模式重新扫描（完成判定随引擎变化：其他引擎生成的卡会被纳入）
        if (this._batchScope === 'all' && this._batchScanResult) {
            var h2 = document.getElementById('bgenScopeHint');
            if (h2) h2.textContent = '正在按 ' + this._engineName(mode) + ' 重新扫描...';
            this._batchScopeApply();
        }
        this._saveBatchSettings();
        var comfyArea = document.getElementById('bgenComfyArea');
        var dreaminaArea = document.getElementById('bgenDreaminaArea');
        var libtvArea = document.getElementById('bgenLibtvArea');
        if (comfyArea) comfyArea.style.display = mode === 'comfyui' ? 'block' : 'none';
        if (dreaminaArea) dreaminaArea.style.display = mode === 'dreamina' ? 'block' : 'none';
        if (libtvArea) libtvArea.style.display = mode === 'libtv' ? 'block' : 'none';
        if (mode === 'dreamina') this._initDreaminaStatus();
        if (mode === 'libtv') this._initLibtv();
        // 保存设置
        this._saveBatchSettings();
    },

    // ============ Ollama 批量优化（队列化） ============
    // 任务可连续提交（互不影响），批次串行执行避免并发打爆本地模型；
    // 关闭弹窗/切换页面不中断（异步循环 + 应用级状态），逐条成功即时持久化。
    _ollamaQueue: [],
    _ollamaQueueRunning: false,
    _ollamaQueueSeq: 0,
    _ollamaCurrentBatch: null,

    // 优化选中卡提示词：提交批次入队
    async _enhanceBatchPrompts() {
        var model = (document.getElementById('bgenOllamaModel') || {}).value;
        if (!model) { this.showToast('请先选择 Ollama 模型', 'warning'); return; }
        var lang = (document.getElementById('bgenOllamaLang') || {}).value || 'en';
        var mcEl = document.getElementById('bgenOllamaMaxChars');
        var maxChars = 0;
        if (mcEl && mcEl.value) {
            var n = parseInt(mcEl.value, 10);
            if (!isNaN(n) && n > 0) maxChars = Math.min(Math.max(n, 50), 3000);
        }
        // 2026-08-10: 目标集合 = 全词库模式取扫描结果中的待优化卡（修复分组勾选断裂），分组模式沿用勾选集
        var ids = this._batchPendingIds('optimize');
        if (ids.length === 0) {
            this.showToast(this._batchScope === 'all' ? '全词库待优化词卡为 0（均已优化或已有图）' : '请先选择要优化的词卡', 'warning');
            return;
        }
        // 全词库模式：预拉取词卡原文（批量接口，避免逐条请求）
        if (this._batchScope === 'all') {
            try { await this._batchLoadCardTexts(ids); } catch(e) {}
        }
        var seq = ++this._ollamaQueueSeq;
        // 快照参数与词卡集合，后续操作不影响本批次
        var batch = { seq: seq, ids: ids.slice(), model: model, lang: lang, maxChars: maxChars, done: 0, err: 0, skipped: 0, total: ids.length };
        this._ollamaQueue = this._ollamaQueue || [];
        this._ollamaQueue.push(batch);
        var waiting = this._ollamaQueueRunning ? this._ollamaQueue.length : Math.max(0, this._ollamaQueue.length - 1);
        this.showToast('优化任务 #' + seq + ' 已入队（' + batch.total + ' 条）' + (waiting > 0 ? '，前面还有 ' + waiting + ' 个任务' : ''), 'info');
        this._ollamaUpdateHint();
        this._ollamaRunNext();
    },

    // 队列调度：一次执行一个批次，完成后自动执行下一个
    _ollamaRunNext() {
        var self = this;
        this._ollamaQueue = this._ollamaQueue || [];
        if (this._ollamaQueueRunning) return;
        if (this._ollamaQueue.length === 0) { this._ollamaUpdateHint(); return; }
        var batch = this._ollamaQueue.shift();
        this._ollamaQueueRunning = true;
        this._ollamaCurrentBatch = batch;
        this._ollamaRunBatch(batch).then(function() {
            self._ollamaQueueRunning = false;
            self._ollamaCurrentBatch = null;
            self._ollamaUpdateHint();
            self._ollamaRunNext();
        });
    },

    // 执行单个批次（逐条 Ollama 优化，串行避免并发打爆本地模型）
    async _ollamaRunBatch(batch) {
        var self = this;
        var hint = document.getElementById('bgenOllamaHint');
        var resultsBox = document.getElementById('bgenOllamaResults');
        if (resultsBox) { resultsBox.style.display = 'none'; resultsBox.innerHTML = ''; }
        this._batchPromptOverrides = this._batchPromptOverrides || {};
        for (var i = 0; i < batch.ids.length; i++) {
            var pid = batch.ids[i];
            // 已有优化结果 → 自动跳过（不重复调用 Ollama）
            if (this._batchPromptOverrides[pid]) {
                batch.skipped++;
                continue;
            }
            // 2026-08-10: 全词库模式 → 已保存详细档（content_detailed 非空）的卡自动跳过优化
            if (this._batchScope === 'all' && this._batchScanResult && this._batchScanResult.items) {
                var _scanItems = this._batchScanResult.items;
                var _skipOpt = false;
                for (var _so = 0; _so < _scanItems.length; _so++) {
                    if (_scanItems[_so].id === pid && _scanItems[_so].optimized) { _skipOpt = true; break; }
                }
                if (_skipOpt) { batch.skipped++; continue; }
            }
            var card = null;
            // 2026-08-10: 全词库模式内容源 = batch-cards 批量缓存（state.prompts 不含全库）
            if (this._batchCardTexts && this._batchCardTexts[pid]) {
                card = this._batchCardTexts[pid];
            } else {
                (this.state.prompts || []).forEach(function(p) { if (p.id === pid && !card) card = p; });
            }
            var text = card ? (card.content || '') : '';
            if (!text) { batch.done++; continue; }
            var skipTxt = batch.skipped > 0 ? '（已跳过 ' + batch.skipped + ' 张已有优化）' : '';
            if (hint) hint.textContent = '任务 #' + batch.seq + ' 优化中 ' + (batch.done + batch.err + 1) + '/' + batch.total + skipTxt + this._ollamaQueueText();
            try {
                var d = await this.fetchJSON('/api/v2/comfyui/ollama/enhance', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ text: text, model: batch.model, language: batch.lang, max_chars: batch.maxChars })
                });
                if (d && d.ok && d.text) {
                    this._batchPromptOverrides[pid] = d.text;
                    batch.done++;
                    // 每条成功即时持久化（关闭弹窗/刷新不丢已完成条目）
                    this._saveOllamaOverrides();
                } else {
                    batch.err++;
                }
            } catch(e) {
                batch.err++;
            }
        }
        if (hint) hint.textContent = '';
        // 渲染可编辑优化结果（多批次按词卡合并）+ 组合预览 + 保存设置
        this._renderOllamaResults();
        this._renderBatchComposePreview();
        this._saveBatchSettings();
        this.showToast('优化任务 #' + batch.seq + ' 完成：' + batch.done + ' 条成功 / ' + batch.err + ' 条失败' + (batch.skipped > 0 ? ' / ' + batch.skipped + ' 条已跳过（已有优化结果）' : '') + (batch.err ? '（生成将使用优化后提示词）' : ''), batch.err > 0 ? 'warning' : 'success');
    },

    _ollamaQueueText() {
        var rest = (this._ollamaQueue || []).length;
        return rest > 0 ? ' · 队列中还有 ' + rest + ' 个任务' : '';
    },

    // 更新队列状态提示（当前批次进行中时由批次循环更新，空闲时显示排队状态/引导文案）
    _ollamaUpdateHint() {
        var hint = document.getElementById('bgenOllamaHint');
        if (!hint) return;
        if (this._ollamaQueueRunning) return;
        var rest = (this._ollamaQueue || []).length;
        if (rest > 0) { hint.textContent = '队列中还有 ' + rest + ' 个优化任务等待执行...'; return; }
        var ids = this._batchIds || [];
        hint.textContent = ids.length > 0 ? '已选 ' + ids.length + ' 张，点击「优化选中卡提示词」进行 Ollama 优化' : '';
    },

    // 渲染 Ollama 优化结果列表（可编辑，生成时使用修改后文本）
    _ollamaEdit(ta) {
        var pid = ta.getAttribute('data-pid');
        if (!pid) return;
        this._batchPromptOverrides = this._batchPromptOverrides || {};
        this._batchPromptOverrides[pid] = ta.value;
        this._saveOllamaOverrides();
        this._renderBatchComposePreview();
    },

    // 恢复原词：丢弃该条优化结果
    _ollamaRevert(pid) {
        if (!confirm('恢复该词条为原始提示词（丢弃优化结果）？')) return;
        if (this._batchPromptOverrides) delete this._batchPromptOverrides[pid];
        if (this._ollamaSaved) delete this._ollamaSaved[pid];
        this._saveOllamaOverrides();
        this._renderOllamaResults();
        this._renderBatchComposePreview();
    },

    // 全部恢复原词：丢弃所有优化结果（二次确认）
    _ollamaRevertAll() {
        var keys = Object.keys(this._batchPromptOverrides || {});
        if (!keys.length) return;
        if (!confirm('恢复全部 ' + keys.length + ' 条为原始提示词（丢弃所有优化结果）？')) return;
        this._batchPromptOverrides = {};
        this._ollamaSaved = {};
        this._saveOllamaOverrides();
        this._renderOllamaResults();
        this._renderBatchComposePreview();
    },

    // 全部存词卡：只处理当前选中的词卡（不关联其他分组/历史批次的优化结果），串行逐条 PUT content_detailed（避免并发写锁）
    async _ollamaSaveAll() {
        var overrides = this._batchPromptOverrides || {};
        // 2026-08-10: 全词库模式保存全部优化结果；分组模式限定当前选中词卡
        var keys = [];
        if (this._batchScope === 'all') {
            keys = Object.keys(overrides);
        } else {
            var ids = this._batchIds || [];
            for (var _ki = 0; _ki < ids.length; _ki++) {
                var _kpid = ids[_ki];
                if (overrides[_kpid] || overrides[String(_kpid)]) keys.push(_kpid);
            }
        }
        if (!keys.length) { this.showToast('当前没有可保存的优化结果', 'warning'); return; }
        this._ollamaSaved = this._ollamaSaved || {};
        var btn = document.getElementById('bgenSaveAllBtn');
        var hint = document.getElementById('bgenSavedHint');
        if (btn) { btn.disabled = true; btn.innerHTML = '⏳ 保存中...'; }
        var ok = 0, fail = 0;
        for (var i = 0; i < keys.length; i++) {
            var pid = keys[i];
            var text = overrides[pid];
            if (!text) { this._ollamaSaved[pid] = false; fail++; continue; }
            if (hint) hint.textContent = '正在保存 ' + (i + 1) + ' / ' + keys.length + '...';
            try {
                var d = await this.fetchJSON('/api/v4/word-cards/' + pid, {
                    method: 'PUT', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ content_detailed: text })
                });
                if (d && d.ok) { this._ollamaSaved[pid] = true; ok++; }
                else { this._ollamaSaved[pid] = false; fail++; }
            } catch(e) { this._ollamaSaved[pid] = false; fail++; }
        }
        if (btn) { btn.disabled = false; btn.innerHTML = '💾 全部存词卡'; }
        this._saveOllamaOverrides();
        this._renderOllamaResults();
        // 刷新词卡列表：详细档内容即时可见（当前档位为详细时直接显示新内容）
        if (typeof this.loadPrompts === 'function') this.loadPrompts();
        this.showToast('全部存词卡完成：' + ok + ' 条成功 / ' + fail + ' 条失败' + (fail > 0 ? '（失败的可单条重试）' : '（已存词卡详细档）'), fail > 0 ? 'warning' : 'success');
    },

    // 优化结果存入词卡详细档（content_detailed），可在编辑弹窗切换简易/普通/详细
    async _ollamaSaveToCard(pid) {
        var ov = this._batchPromptOverrides || {};
        var text = ov[pid] || ov[String(pid)];
        if (!text) { this.showToast('该条没有优化结果', 'warning'); return; }
        this._ollamaSaved = this._ollamaSaved || {};
        try {
            var d = await this.fetchJSON('/api/v4/word-cards/' + pid, {
                method: 'PUT', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ content_detailed: text })
            });
            if (d && d.ok) {
                this._ollamaSaved[pid] = true;
                this._saveOllamaOverrides();
                this._renderOllamaResults();
                // 刷新词卡列表：该卡详细档内容即时更新
                if (typeof this.loadPrompts === 'function') this.loadPrompts();
                this.showToast('已存入词卡 #' + pid + ' 详细档', 'success');
            } else {
                this._ollamaSaved[pid] = false;
                this._renderOllamaResults();
                this.showToast('保存失败: ' + ((d && (d.detail || d.error)) || '未知错误'), 'error');
            }
        } catch(e) {
            this._ollamaSaved[pid] = false;
            this._renderOllamaResults();
            this.showToast('保存异常: ' + e.message, 'error');
        }
    },

    // ============ 优化结果批处理（全部使用档位 / 临时存储 / 重新优化） ============

    // 全部使用详细/标准：详细=overrides 填充详细档内容，标准=清空 overrides
    _batchUseTier(tier) {
        // 2026-08-10: 全词库模式作用于全部待优化卡（修复分组勾选断裂）
        var ids = this._batchPendingIds('optimize');
        if (!ids.length) { this.showToast('请先选中词卡', 'warning'); return; }
        this._batchPromptOverrides = this._batchPromptOverrides || {};
        var self = this;
        if (tier === 'detailed') {
            var cnt = 0;
            ids.forEach(function(pid) {
                var card = null;
                (self.state.prompts || []).forEach(function(p) { if (p.id === pid && !card) card = p; });
                if (!card) return;
                if (card.content_detailed) { self._batchPromptOverrides[pid] = card.content_detailed; cnt++; }
                else if (!self._batchPromptOverrides[pid]) { self._batchPromptOverrides[pid] = card.content || ''; }
            });
            this.showToast('已切换全部使用详细档（' + cnt + ' 条有详细档内容）', 'success');
        } else {
            this._batchPromptOverrides = {};
            this.showToast('已切换全部使用标准档（原始内容）', 'success');
        }
        this._saveOllamaOverrides();
        this._renderOllamaResults();
        this._renderBatchComposePreview();
    },

    // 优化结果临时存储（localStorage，弹窗重开自动恢复）
    _ollamaSelectedPids() {
        var out = [];
        document.querySelectorAll('.ollama-reopt-check:checked').forEach(function(c) {
            var pid = c.getAttribute('data-pid');
            if (pid) out.push(parseInt(pid, 10));
        });
        return out;
    },

    // 单条重新优化（用当前模型/语言/字数，基于词卡原文）
    async _ollamaReoptimize(pid, btn) {
        var res = await this._ollamaReoptimizeInner(pid, btn);
        if (res) {
            this._saveOllamaOverrides();
            this._renderOllamaResults();
            this._renderBatchComposePreview();
            this.showToast('词条 #' + pid + ' 重新优化完成', 'success');
        } else if (btn) {
            this.showToast('重新优化失败（模型未选或接口异常）', 'error');
        }
    },

    // 全部重新优化（勾选的优先，无勾选则全部）
    async _ollamaReoptimizeAll() {
        var overrides = this._batchPromptOverrides || {};
        // 仅当前选中词卡中有优化结果的条目（不关联其他分组/历史批次）
        var ids = this._batchIds || [];
        var keys = [];
        for (var _rk = 0; _rk < ids.length; _rk++) {
            var _rpid = ids[_rk];
            if (overrides[_rpid] || overrides[String(_rpid)]) keys.push(_rpid);
        }
        if (!keys.length) { this.showToast('当前选中的词卡没有可重新优化的结果', 'warning'); return; }
        var sel = this._ollamaSelectedPids();
        var targets = sel.length ? sel.filter(function(p) { return overrides[p]; }) : keys;
        if (!targets.length) { this.showToast('勾选的词条没有优化结果', 'warning'); return; }
        if (!confirm('重新优化 ' + targets.length + ' 条词条？（使用当前模型/语言/字数设置）')) return;
        var btn = document.getElementById('bgenReoptAllBtn');
        var hint = document.getElementById('bgenSavedHint');
        if (btn) { btn.disabled = true; btn.innerHTML = '⏳ 优化中...'; }
        var ok = 0, fail = 0;
        for (var i = 0; i < targets.length; i++) {
            if (hint) hint.textContent = '正在重新优化 ' + (i + 1) + ' / ' + targets.length + '...';
            if (await this._ollamaReoptimizeInner(targets[i])) ok++; else fail++;
        }
        if (btn) { btn.disabled = false; btn.innerHTML = '🔄 全部重新优化'; }
        this._saveOllamaOverrides();
        this._renderOllamaResults();
        this._renderBatchComposePreview();
        this.showToast('重新优化完成：' + ok + ' 条成功 / ' + fail + ' 条失败', fail > 0 ? 'warning' : 'success');
    },

    // 内部单条重新优化（共享给单条/全部，基于词卡原文重新生成）
    async _ollamaReoptimizeInner(pid, btn) {
        var model = (document.getElementById('bgenOllamaModel') || {}).value;
        if (!model) { this.showToast('请先选择 Ollama 模型', 'warning'); return false; }
        var lang = (document.getElementById('bgenOllamaLang') || {}).value || 'en';
        var mcEl = document.getElementById('bgenOllamaMaxChars');
        var maxChars = 0;
        if (mcEl && mcEl.value) { var n = parseInt(mcEl.value, 10); if (!isNaN(n) && n > 0) maxChars = Math.min(Math.max(n, 50), 3000); }
        var card = null;
        (this.state.prompts || []).forEach(function(p) { if (p.id === pid && !card) card = p; });
        var text = card ? (card.content || '') : '';
        if (!text) return false;
        var origHtml = btn ? btn.innerHTML : '';
        if (btn) { btn.disabled = true; btn.innerHTML = '⏳'; }
        try {
            var d = await this.fetchJSON('/api/v2/comfyui/ollama/enhance', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text: text, model: model, language: lang, max_chars: maxChars })
            });
            if (d && d.ok && d.text) {
                this._batchPromptOverrides = this._batchPromptOverrides || {};
                this._batchPromptOverrides[pid] = d.text;
                if (this._ollamaSaved) delete this._ollamaSaved[pid];
                return true;
            }
            return false;
        } catch(e) {
            return false;
        } finally {
            if (btn) { btn.disabled = false; btn.innerHTML = origHtml; }
        }
    },

    // 组合规则（简化复刻后端 _compose_prompt）：预设 + 卡片，尾部加后缀，逗号拼接
    _composePromptPreview(preset, card, suffix) {
        preset = (preset || '').trim().replace(/,\s*$/, '');
        card = (card || '').trim().replace(/,\s*$/, '');
        suffix = (suffix || '').trim().replace(/,\s*$/, '');
        var parts = [];
        if (preset) { parts.push(preset); if (card) parts.push(card); }
        else if (card) parts.push(card);
        if (suffix) parts.push(suffix);
        return parts.join(', ');
    },

    async _loadBatchWorkflows() {
        try {
            var d = await this.fetchJSON('/api/v2/comfyui/workflows?sort=recent');
            this._batchWorkflows = (d && d.items) || [];
            if (this._batchWorkflows.length === 0) {
                var grid = document.getElementById('bgenWfGrid');
                if (grid) grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:16px;color:var(--text-muted);font-size:11px;">工作流库为空，请先在「工作流库」导入或同步</div>';
                return;
            }
            this._renderBatchWfViews();
            // 恢复上次选择的工作流（记住参数设置）
            var saved = this._batchSavedSettings();
            var targetId = saved && saved.workflow_id;
            var found = false;
            (this._batchWorkflows || []).forEach(function(w) { if (w.id === targetId) found = true; });
            if (!found && this._batchWorkflows.length > 0) targetId = this._batchWorkflows[0].id;
            this._batchWfId = targetId;
            this._renderBatchWfViews();
            this._batchWfSelected(targetId);
        } catch(e) {
            var grid = document.getElementById('bgenWfGrid');
            if (grid) grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:16px;color:#ef4444;font-size:11px;">加载失败: ' + App._escape(e.message) + '</div>';
        }
    },

    // 工作流双视图渲染（卡片/详情）
    _renderBatchWfViews() {
        var self = this;
        var grid = document.getElementById('bgenWfGrid');
        var list = document.getElementById('bgenWfList');
        if (!grid || !list) return;
        var wfs = this._batchWorkflows || [];
        var srcMap = { png_import: 'PNG导入', comfyui_sync: 'Comfy同步', manual: '手动', generate: '生成' };
        // 卡片视图
        var gh = '';
        wfs.forEach(function(w) {
            var isSel = self._batchWfId === w.id;
            var cover = w.thumbnail ? '/api/thumbnails/file/' + w.thumbnail : '';
            var src = srcMap[w.source] || w.source || '';
            gh += '<div onclick="App._batchPickWf(\'' + App._escape(w.id) + '\')" title="' + App._escape((w.name || '') + (w.prompt_text ? '\n📝 ' + w.prompt_text : '')) + '" style="border:1px solid ' + (isSel ? 'var(--primary)' : 'var(--border-color)') + ';border-radius:10px;overflow:hidden;cursor:pointer;background:var(--bg-card);transition:border-color .12s;">' +
              '<div style="height:64px;background:linear-gradient(135deg,#1e293b,#334155);display:flex;align-items:center;justify-content:center;position:relative;">' +
                (cover ? '<img src="' + cover + '" style="width:100%;height:100%;object-fit:cover;">' : '<span style="font-size:22px;opacity:0.5;">🎨</span>') +
                (src ? '<span style="position:absolute;top:4px;right:4px;font-size:8px;padding:1px 6px;border-radius:8px;background:rgba(0,0,0,0.55);color:#e2e8f0;">' + App._escape(src) + '</span>' : '') +
              '</div>' +
              '<div style="padding:5px 7px;">' +
                '<div style="font-size:11px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + App._escape(w.name || '未命名') + '</div>' +
                '<div style="font-size:9px;color:var(--text-muted);">' + (w.node_count || 0) + ' 节点 · 使用 ' + (w.usage_count || 0) + ' 次</div>' +
              '</div>' +
            '</div>';
        });
        grid.innerHTML = gh;
        // 详情视图
        var lh = '';
        wfs.forEach(function(w) {
            var isSel = self._batchWfId === w.id;
            var cover = w.thumbnail ? '/api/thumbnails/file/' + w.thumbnail : '';
            var src = srcMap[w.source] || w.source || '';
            lh += '<div onclick="App._batchPickWf(\'' + App._escape(w.id) + '\')" style="display:flex;align-items:center;gap:8px;padding:6px 9px;border:1px solid ' + (isSel ? 'var(--primary)' : 'var(--border-color)') + ';border-radius:8px;cursor:pointer;background:' + (isSel ? 'rgba(99,102,241,0.06)' : 'var(--bg-card)') + ';">' +
              (cover ? '<img src="' + cover + '" style="width:44px;height:30px;object-fit:cover;border-radius:5px;flex-shrink:0;">' : '<span style="width:44px;height:30px;display:flex;align-items:center;justify-content:center;font-size:16px;background:#1e293b;border-radius:5px;flex-shrink:0;">🎨</span>') +
              '<div style="flex:1;min-width:0;">' +
                '<div style="font-size:12px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + App._escape(w.name || '未命名') + '</div>' +
                '<div style="font-size:9px;color:var(--text-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + (w.node_count || 0) + ' 节点 · 使用 ' + (w.usage_count || 0) + ' 次' + (src ? ' · ' + src : '') + (w.last_used_at ? ' · ' + App._escape(String(w.last_used_at).slice(5, 16)) : '') + '</div>' +
              '</div>' +
              (isSel ? '<span style="color:var(--primary);font-size:13px;">✓</span>' : '') +
            '</div>';
        });
        list.innerHTML = lh;
        // 应用视图模式
        this._batchWfView(this._batchViewMode || 'grid');
    },

    // 视图模式切换（卡片/详情），记住选择
    _batchWfView(mode) {
        this._batchViewMode = mode;
        try { localStorage.setItem('cwl_batch_wf_view', mode); } catch(e) {}
        var grid = document.getElementById('bgenWfGrid');
        var list = document.getElementById('bgenWfList');
        if (grid) { grid.style.display = mode === 'grid' ? 'grid' : 'none'; }
        if (list) { list.style.display = mode === 'list' ? 'flex' : 'none'; }
        var gb = document.getElementById('bgenWfViewGrid');
        var lb = document.getElementById('bgenWfViewList');
        if (gb) gb.className = 'cwl-logview-btn' + (mode === 'grid' ? ' active' : '');
        if (lb) lb.className = 'cwl-logview-btn' + (mode === 'list' ? ' active' : '');
    },

    // 选择工作流（卡片/列表项点击）
    async _batchPickWf(wfId) {
        this._batchWfId = wfId;
        this._renderBatchWfViews();
        await this._batchWfSelected(wfId);
        this._saveBatchSettings();
    },

    // 读取上次批量设置
    _batchSavedSettings() {
        try { return JSON.parse(localStorage.getItem('cwl_batch_settings') || 'null') || null; } catch(e) { return null; }
    },

    // 2026-08-10: 用户手动改过批次 → 不再被引擎切换覆盖
    _batchSizeChanged() {
        this._batchSizeTouched = true;
        this._saveBatchSettings();
    },

    // 保存批量设置（引擎/工作流/参数预设/后缀/开关/参数值/即梦参数/范围/批次）
    _saveBatchSettings() {
        try {
            var s = {
                engine: this._batchEngineMode || 'comfyui',
                workflow_id: this._batchWfId || '',
                preset_id: this._batchPresetId || 0,
                suffix: (document.getElementById('bgenSuffix') || {}).value || '',
                manual_text: (document.getElementById('bgenManualText') || {}).value || '',
                use_module_preset: (document.getElementById('bgenUsePreset') || {}).checked ? 1 : 0,
                param_values: this._collectBatchParams(),
                dreamina_model: (document.getElementById('bgenDreaminaModel') || {}).value || '5.0',
                dreamina_ratio: (document.getElementById('bgenDreaminaRatio') || {}).value || '1:1',
                dreamina_res: (document.getElementById('bgenDreaminaRes') || {}).value || '2k',
                libtv_project: (document.getElementById('bgenLibtvProject') || {}).value || '',
                libtv_model: (document.getElementById('bgenLibtvModel') || {}).value || 'Z-image Turbo',
                libtv_ratio: (document.getElementById('bgenLibtvRatio') || {}).value || '1:1',
                scope: this._batchScope || 'group',
                batch_size: (document.getElementById('bgenBatchSize') || {}).value || '20'
            };
            localStorage.setItem('cwl_batch_settings', JSON.stringify(s));
        } catch(e) {}
    },

    // 恢复上次批量设置
    _restoreBatchSettings() {
        var s = this._batchSavedSettings();
        if (!s) return;
        var suffixEl = document.getElementById('bgenSuffix');
        if (suffixEl && s.suffix !== undefined) suffixEl.value = s.suffix;
        var mtEl = document.getElementById('bgenManualText');
        if (mtEl && s.manual_text !== undefined) mtEl.value = s.manual_text;
        var upEl = document.getElementById('bgenUsePreset');
        if (upEl && s.use_module_preset !== undefined) upEl.checked = !!s.use_module_preset;
        if (s.workflow_id) this._batchWfId = s.workflow_id;
        this._batchSavedParams = s.param_values || null;
        if (s.preset_id) this._batchRestorePresetId = s.preset_id;
        if (s.dreamina_model) document.getElementById('bgenDreaminaModel').value = s.dreamina_model;
        if (s.dreamina_ratio) document.getElementById('bgenDreaminaRatio').value = s.dreamina_ratio;
        if (s.dreamina_res) document.getElementById('bgenDreaminaRes').value = s.dreamina_res;
        if (s.libtv_project) document.getElementById('bgenLibtvProject').value = s.libtv_project;
        if (s.libtv_model) document.getElementById('bgenLibtvModel').value = s.libtv_model;
        if (s.libtv_ratio) document.getElementById('bgenLibtvRatio').value = s.libtv_ratio;
        // 2026-08-10: 恢复范围与批次（批次恢复后视为用户已定，不再被引擎切换覆盖）
        if (s.scope === 'all') this._batchScope = 'all';
        if (s.batch_size) {
            this._batchSizeTouched = true;
            var bsEl = document.getElementById('bgenBatchSize');
            if (bsEl) bsEl.value = s.batch_size;
        }
        var vm = null;
        try { vm = localStorage.getItem('cwl_batch_wf_view'); } catch(e) {}
        this._batchViewMode = vm === 'list' ? 'list' : 'grid';
        // 恢复引擎选择
        if (s.engine === 'dreamina') {
            this._batchEngineMode = 'dreamina';
            setTimeout(function() { App._batchEngine('dreamina'); }, 50);
        } else if (s.engine === 'libtv') {
            this._batchEngineMode = 'libtv';
            setTimeout(function() { App._batchEngine('libtv'); }, 50);
        } else {
            this._batchEngineMode = 'comfyui';
        }
    },

    async _batchWfSelected(wfId) {
        if (!wfId) return;
        var badge = document.getElementById('bgenModelBadge');
        var presetArea = document.getElementById('bgenPresetArea');
        var hint = document.getElementById('bgenWfHint');
        var infoEl = document.getElementById('bgenWfInfo');
        try {
            var d = await this.fetchJSON('/api/v2/comfyui/workflows/' + encodeURIComponent(wfId) + '/params/analyze');
            if (!d || !d.ok) throw new Error(d && d.error || '分析失败');
            var mtMap = { flux: 'FLUX', sdxl: 'SDXL', sd15: 'SD1.5', unknown: '通用' };
            var mtLabel = mtMap[d.model_type] || d.model_type || '通用';
            this._batchModelType = d.model_type || 'unknown';
            if (badge) {
                badge.textContent = mtLabel;
                badge.style.display = 'inline-block';
            }
            if (hint) hint.textContent = d.model_type === 'sd15' ? '（SD1.5 默认 512×512）' : '';
            // 工作流信息卡
            var wfItem = null;
            (this._batchWorkflows || []).forEach(function(w) { if (w.id === wfId) wfItem = w; });
            if (infoEl) {
                var parts = ['<b style="color:var(--text-main);">' + App._escape((wfItem && wfItem.name) || '') + '</b>'];
                parts.push('模型: <b style="color:var(--primary);">' + App._escape(mtLabel) + '</b>');
                if (wfItem) {
                    parts.push('节点: ' + (wfItem.node_count || 0));
                    if (wfItem.usage_count) parts.push('使用: ' + wfItem.usage_count + ' 次');
                    if (wfItem.last_used_at) parts.push('上次使用: ' + App._escape(String(wfItem.last_used_at).slice(5, 16)));
                }
                if (d.candidates && d.candidates.length) parts.push('可调参数: ' + d.candidates.length + ' 项');
                infoEl.innerHTML = parts.join(' · ');
                infoEl.style.display = 'block';
            }
            // 参数预设：支持多配置切换
            this._batchPresets = d.presets || [];
            var userPreset = null;
            this._batchPresets.forEach(function(p) { if (p.mode === 'user' && !userPreset) userPreset = p; });
            // 恢复上次选择的参数预设
            if (this._batchRestorePresetId) {
                var foundP = null;
                this._batchPresets.forEach(function(p) { if (p.id === this._batchRestorePresetId) foundP = p; }, this);
                if (foundP) userPreset = foundP;
                this._batchRestorePresetId = null;
            }
            this._batchPreset = userPreset || null;
            this._batchPresetId = userPreset ? userPreset.id : 0;
            if (presetArea) {
                presetArea.style.display = 'block';
                this._renderBatchPresetBar();
            }
        } catch(e) {
            if (badge) badge.style.display = 'none';
            if (infoEl) infoEl.style.display = 'none';
            if (presetArea) presetArea.style.display = 'none';
        }
    },

    // 参数预设切换条（多配置）
    _renderBatchPresetBar() {
        var bar = document.getElementById('bgenPresetBar');
        if (!bar) return;
        var presets = this._batchPresets || [];
        var self = this;
        if (presets.length === 0) {
            bar.innerHTML = '<span style="font-size:11px;color:var(--text-muted);">该工作流无已存参数配置，将使用模板默认值（可在「工作流库 → 参数配置」中预设）</span>';
            this._renderBatchParamsForm(null);
            return;
        }
        var html = '';
        presets.forEach(function(p) {
            var isAct = self._batchPreset && self._batchPreset.id === p.id;
            html += '<span onclick="App._batchActivatePreset(' + p.id + ')" style="cursor:pointer;font-size:10px;padding:3px 10px;border-radius:14px;border:1px solid ' + (isAct ? 'var(--primary)' : 'var(--border-color)') + ';color:' + (isAct ? 'var(--primary)' : 'var(--text-muted)') + ';background:' + (isAct ? 'rgba(99,102,241,0.08)' : 'transparent') + ';">' +
              App._escape(p.name || '参数配置') + (p.mode === 'user' ? ' 🔒' : ' (编辑中)') +
            '</span>';
        });
        bar.innerHTML = html;
        this._renderBatchParamsForm(this._batchPreset);
    },

    _batchActivatePreset(pid) {
        (this._batchPresets || []).forEach(function(p) { if (p.id === pid) { this._batchPreset = p; this._batchPresetId = p.id; } }, this);
        this._renderBatchPresetBar();
    },

    // 简化参数表单（滑块+数字/下拉/开关/文本），用于批量预设；preset 为空时用模板默认
    _renderBatchParamsForm(preset) {
        var form = document.getElementById('bgenPresetForm');
        if (!form) return;
        var params = [];
        if (preset) {
            try { params = JSON.parse(preset.params_json || '[]'); } catch(e) {}
        }
        if (!preset || params.length === 0) {
            form.innerHTML = '<div style="font-size:11px;color:var(--text-muted);">使用模板默认值生成（未应用参数配置）</div>';
            var sq = document.getElementById('bgenSizeQuick');
            if (sq) sq.style.display = 'none';
            return;
        }
        var FILE_FIELDS = ['ckpt_name', 'lora_name', 'unet_name', 'vae_name', 'clip_name1', 'clip_name2'];
        params.forEach(function(p) {
            if (!p) return;
            if ((p.options || []).length > 0) p.type = (FILE_FIELDS.indexOf(p.field) > -1) ? 'select_file' : 'select';
        });
        // 尺寸快捷：含 width+height 时显示横竖/比例/分辨率
        var self = this;
        var wP = null, hP = null;
        params.forEach(function(p) { if (p.field === 'width') wP = p; if (p.field === 'height') hP = p; });
        this._renderBatchSizeQuick(wP, hP);
        var html = '';
        params.forEach(function(p) {
            var val = p.default;
            html += '<div style="border:1px solid var(--border-color);border-radius:8px;padding:7px 9px;">' +
              '<div style="font-size:10px;font-weight:600;margin-bottom:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="' + App._escape((p.label || p.key) + ' (' + p.key + ')') + '">' + App._escape(p.label || p.key) + '</div>';
            if (p.type === 'slider') {
                var min = p.min === undefined ? 0 : p.min, max = p.max === undefined ? 100 : p.max, step = p.step === undefined ? 1 : p.step;
                html += '<div style="display:flex;align-items:center;gap:5px;">' +
                  '<input type="range" class="bgen-pv" data-key="' + App._escape(p.key) + '" min="' + min + '" max="' + max + '" step="' + step + '" value="' + val + '" style="flex:1;" oninput="App._bgenSliderSync(this)">' +
                  '<input type="number" class="bgen-pv-num" data-key="' + App._escape(p.key) + '" min="' + min + '" max="' + max + '" step="' + step + '" value="' + val + '" onchange="App._bgenNumSync(this)" style="width:56px;font-size:10px;padding:2px 4px;border:1px solid var(--border-color);border-radius:4px;background:var(--bg-card);color:var(--text-main);" title="可手动输入">' +
                '</div>';
            } else if (p.type === 'number') {
                html += '<input type="number" class="bgen-pv" data-key="' + App._escape(p.key) + '" value="' + App._escape(String(val === undefined ? '' : val)) + '" step="any" style="width:100%;font-size:11px;padding:3px 6px;border:1px solid var(--border-color);border-radius:5px;background:var(--bg-card);color:var(--text-main);">';
            } else if (p.type === 'checkbox') {
                html += '<input type="checkbox" class="bgen-pv" data-key="' + App._escape(p.key) + '" ' + (val ? 'checked' : '') + ' style="width:16px;height:16px;">';
            } else if (p.type === 'select' || p.type === 'select_file' || (p.options || []).length > 0) {
                var opts = p.options || [];
                if (opts.length === 0) opts = [String(val === undefined ? '' : val)];
                html += '<select class="bgen-pv" data-key="' + App._escape(p.key) + '" style="width:100%;font-size:11px;padding:3px 6px;border:1px solid var(--border-color);border-radius:5px;background:var(--bg-card);color:var(--text-main);">';
                opts.forEach(function(o) {
                    html += '<option value="' + App._escape(o) + '"' + (String(val) === String(o) ? ' selected' : '') + '>' + App._escape(o) + '</option>';
                });
                html += '</select>';
            } else {
                html += '<textarea class="bgen-pv" data-key="' + App._escape(p.key) + '" rows="' + (p.key.indexOf('.text') > -1 ? 2 : 1) + '" style="width:100%;font-size:11px;padding:3px 6px;border:1px solid var(--border-color);border-radius:5px;background:var(--bg-card);color:var(--text-main);resize:vertical;">' + App._escape(String(val === undefined ? '' : val)) + '</textarea>';
            }
            html += '</div>';
        });
        form.innerHTML = html;
        // 恢复上次保存的参数值（记住参数设置）
        if (this._batchSavedParams) {
            var self = this;
            Object.keys(this._batchSavedParams).forEach(function(k) {
                var el = document.querySelector('#bgenPresetForm .bgen-pv[data-key="' + k + '"]');
                if (!el) return;
                var v = self._batchSavedParams[k];
                if (el.type === 'checkbox') el.checked = !!v;
                else el.value = (v === undefined || v === null) ? '' : v;
                var num = document.querySelector('#bgenPresetForm .bgen-pv-num[data-key="' + k + '"]');
                if (num && num.type !== 'checkbox') num.value = (v === undefined || v === null) ? '' : v;
            });
            this._batchSavedParams = null; // 仅恢复一次
        }
    },

    // 批量弹窗尺寸快捷条（复用工作流库尺寸预设）
    _renderBatchSizeQuick(wP, hP) {
        var sq = document.getElementById('bgenSizeQuick');
        if (!sq) return;
        if (!wP || !hP || !App.CWL_SIZE_PRESETS) { sq.style.display = 'none'; return; }
        var mt = App.CWL_SIZE_PRESETS[this._batchModelType || 'unknown'] || App.CWL_SIZE_PRESETS.unknown;
        var base = mt.base;
        var html = '<div style="font-size:10px;color:var(--text-muted);margin-bottom:5px;"><b style="color:var(--text-main);">📐 尺寸快捷</b>（' + App._escape(mt.label) + ' · 长边 ' + base + 'px）</div>' +
          '<div style="display:flex;gap:5px;flex-wrap:wrap;margin-bottom:5px;">' +
            '<button type="button" class="bgen-btn" style="border-color:#6366f1;color:var(--primary);" onclick="App._batchSetSize(1,1)">□ 方形</button>' +
            '<button type="button" class="bgen-btn" style="border-color:#6366f1;color:var(--primary);" onclick="App._batchSetSize(4,3)">▭ 横屏</button>' +
            '<button type="button" class="bgen-btn" style="border-color:#6366f1;color:var(--primary);" onclick="App._batchSetSize(3,4)">▯ 竖屏</button>' +
          '</div>';
        html += '<div style="display:flex;gap:4px;flex-wrap:wrap;margin-bottom:5px;">';
        (App.CWL_RATIOS || []).forEach(function(r) {
            html += '<button type="button" class="bgen-btn" onclick="App._batchSetSize(' + r.w + ',' + r.h + ')">' + r.label + '</button>';
        });
        html += '</div><div style="display:flex;gap:4px;flex-wrap:wrap;">';
        mt.presets.forEach(function(sz) {
            html += '<button type="button" class="bgen-btn" onclick="App._batchSetSize(' + sz[0] + ',' + sz[1] + ',true)">' + sz[0] + '×' + sz[1] + '</button>';
        });
        html += '</div>';
        sq.innerHTML = html;
        sq.style.display = 'block';
    },

    // 应用尺寸到批量表单的 width/height 参数
    _batchSetSize(rw, rh, absolute) {
        var w, h;
        if (absolute) { w = rw; h = rh; }
        else {
            var mt = (App.CWL_SIZE_PRESETS && (App.CWL_SIZE_PRESETS[this._batchModelType] || App.CWL_SIZE_PRESETS.unknown)) || { base: 768 };
            var base = mt.base;
            if (rw >= rh) { w = base; h = Math.round(base * rh / rw); }
            else { h = base; w = Math.round(base * rw / rh); }
            var snap = function(n) { return Math.max(64, Math.round(n / 8) * 8); };
            w = snap(w); h = snap(h);
        }
        ['width', 'height'].forEach(function(f) {
            var rng = document.querySelector('#bgenPresetForm .bgen-pv[data-key$=".' + f + '"]');
            var num = document.querySelector('#bgenPresetForm .bgen-pv-num[data-key$=".' + f + '"]');
            if (rng) rng.value = (f === 'width' ? w : h);
            if (num) num.value = (f === 'width' ? w : h);
        });
        App.showToast('已设置尺寸 ' + w + '×' + h, 'success');
    },

    // 滑块 → 数字框同步
    _bgenSliderSync(input) {
        var key = input.getAttribute('data-key');
        var num = document.querySelector('.bgen-pv-num[data-key="' + key + '"]');
        if (num) num.value = input.value;
    },

    // 数字框 → 滑块同步
    _bgenNumSync(input) {
        var key = input.getAttribute('data-key');
        var rng = document.querySelector('.bgen-pv[data-key="' + key + '"]');
        if (rng) {
            var v = parseFloat(input.value);
            if (isNaN(v)) { input.value = rng.value; return; }
            var mn = parseFloat(rng.min), mx = parseFloat(rng.max);
            if (!isNaN(mn) && !isNaN(mx)) v = Math.max(mn, Math.min(mx, v));
            input.value = v;
            rng.value = v;
        }
    },

    _collectBatchParams() {
        var values = {};
        document.querySelectorAll('#bgenPresetForm .bgen-pv').forEach(function(el) {
            var key = el.getAttribute('data-key');
            var v = el.value;
            if (el.type === 'checkbox') v = el.checked;
            else if (el.type === 'range' || el.type === 'number') v = parseFloat(v);
            values[key] = v;
        });
        return values;
    },

    async _startBatchGen() {
        var self = this;
        var startBtn = document.getElementById('bgenStartBtn');
        if (!startBtn) return;
        // 防重复提交：请求进行中忽略再次点击（含 30s 超时保护，异常路径不会永久卡死）
        if (this._batchSubmitting) {
            if (this._batchSubmittingAt && Date.now() - this._batchSubmittingAt > 30000) {
                this._batchSubmitting = false;
                this._batchSubmittingAt = null;
            } else {
                this.showToast('正在提交任务，请稍候', 'warning');
                return;
            }
        }
        var engine = this._batchEngineMode || 'comfyui';
        var wfId = this._batchWfId || '';
        // 多任务队列：允许在旧任务未完成时继续提交新任务，互不影响
        if (engine === 'comfyui') {
            if (!wfId) { this.showToast('请先选择生成工作流', 'warning'); return; }
            var cfg = await this.fetchJSON('/api/v2/comfyui/config');
            if (!cfg || !cfg.config || !cfg.config.enabled) {
                this.showToast('ComfyUI 未启用，请先在「工作流库」中启用', 'warning');
                return;
            }
        }
        if (engine === 'dreamina') {
            // 实时查询授权状态（不依赖弹窗状态文本，弹窗重开未检测时不会误判未授权）
            var dStatus = null;
            try { dStatus = await this.fetchJSON('/api/v2/dreamina/status'); } catch(e) { dStatus = null; }
            var needAuth = !dStatus || !dStatus.ok || !dStatus.logged_in;
            if (needAuth) {
                if (confirm('即梦引擎未授权。\n点击「确定」打开授权中心完成登录，或「取消」返回。')) {
                    this.openEngineAuth();
                }
                return;
            }
        }
        if (engine === 'libtv') {
            // 实时查询授权状态（同上）
            var ltStatus = null;
            try { ltStatus = await this.fetchJSON('/api/v2/libtv/status'); } catch(e) { ltStatus = null; }
            var ltNeedAuth = !ltStatus || !ltStatus.ok || !ltStatus.logged_in;
            if (ltNeedAuth) {
                if (confirm('LibTV 引擎未授权。\n点击「确定」打开授权中心完成登录，或「取消」返回。')) {
                    this.openEngineAuth();
                }
                return;
            }
            var ltProj = (document.getElementById('bgenLibtvProject') || {}).value || '';
            if (!ltProj) { this.showToast('请先选择 LibTV 画布', 'warning'); return; }
            var ltModel = (document.getElementById('bgenLibtvModel') || {}).value || '';
            if (!ltModel) { this.showToast('请先选择 LibTV 模型', 'warning'); return; }
            // 积分保护：付费模型提示（免费模型跳过）
            var ltOpt = document.querySelector('#bgenLibtvModel option:checked');
            var isPaid = ltOpt && /💎/.test(ltOpt.textContent);
            if (isPaid && !confirm('「' + ltModel + '」为付费模型（消耗积分）。\n当前账号基础 VIP 未生效，可能报「算力不足」导致整批失败。\n\n确认继续？')) {
                return;
            }
        }
        // 展示进度区
        var pa = document.getElementById('bgenProgressArea');
        if (pa) pa.style.display = 'block';
        var det = document.getElementById('bgenDetail');
        if (det) det.innerHTML = '';
        var grid = document.getElementById('bgenGrid');
        if (grid) grid.style.display = 'none';
        var retryBtn = document.getElementById('bgenRetryBtn');
        if (retryBtn) retryBtn.style.display = 'none';
        var bar = document.getElementById('bgenProgressBar');
        var txt = document.getElementById('bgenProgressText');
        if (bar) bar.style.width = '0%';
        if (txt) txt.textContent = '正在创建生成任务...';
        this._batchGenRunning = true;
        // 开始按钮保持可用：任务队列模式下可继续顺序提交新任务
        // 自动跳过：已在生成队列中的词卡（避免重复入队）
        // 已有缩略图判定交由后端按库内最新数据过滤（返回 skipped），避免前端 state 旧数据误拦截
        var pendingIds = [];
        var skipQueued = 0;
        var scopeIsAll = this._batchScope === 'all' && this._batchScanResult;
        var curEngine = this._batchEngineMode || 'comfyui';
        if (scopeIsAll) {
            // 全词库模式：以 batch-scan 结果为准（后端多维判定，前端不猜）
            // 跳过条件：当前引擎生成 + 引擎未知（默认视为完成）；其他引擎/手动/未知状态/无图全部纳入
            // 2026-08-10 修复：队列占用不再前端拦截——后端 _active_queued_pids 权威防重（返回 queued_skip 统计）
            var scanItems = this._batchScanResult.items || [];
            for (var _si = 0; _si < scanItems.length; _si++) {
                var _sit = scanItems[_si];
                if (_sit.thumb_state === 'ai' && (_sit.thumb_engine === curEngine || !_sit.thumb_engine || _sit.thumb_engine === 'unknown')) continue;  // 本引擎/未知引擎 → 跳过
                pendingIds.push(_sit.id);
            }
        } else {
            for (var _fi = 0; _fi < this._batchIds.length; _fi++) {
                pendingIds.push(this._batchIds[_fi]);
            }
        }
        if (pendingIds.length === 0) {
            if (txt) txt.textContent = '无待生成词卡（均已本引擎完成）';
            this.showToast('全库词卡均已由当前引擎生成（或视为完成），无需重复生成', 'info');
            return false;
        }
        this._batchSubmitting = true;
        this._batchSubmittingAt = Date.now();
        var paramValues = this._collectBatchParams();
        // 构建卡片类型映射（{prompt_id: 'word_card'|'prompts'}）
        // 2026-08-06 修复：id 在 prompts/word_card 两表可能重叠（旧数据），
        // 必须按当前列表数据源显式标注，避免后端猜表把词卡图写进 prompts 链路
        var cardTypeMap = {};
        if (scopeIsAll) {
            // 全词库均为 word_card（batch-scan 只含词卡表）
            for (var _ai = 0; _ai < pendingIds.length; _ai++) cardTypeMap[pendingIds[_ai]] = 'word_card';
        } else {
            var typeSrc = this.state.prompts || [];
            if ((this.state.currentView === 'collections' || this.state.currentCollection) && (this.state.collectionItems || []).length > 0) {
                typeSrc = this.state.collectionItems;
            }
            for (var _ti = 0; _ti < typeSrc.length; _ti++) {
                var _it = typeSrc[_ti];
                if (pendingIds.indexOf(_it.id) > -1) {
                    cardTypeMap[_it.id] = (_it._source === 'word_card') ? 'word_card' : 'prompts';
                }
            }
        }
        // 批次控制：每批自动提交张数（0=不切片；在线引擎防限流/降单批失败面）
        var bsEl = document.getElementById('bgenBatchSize');
        var batchSize = 0;
        if (bsEl && bsEl.value) {
            batchSize = parseInt(bsEl.value, 10);
            if (isNaN(batchSize) || batchSize < 0) batchSize = 0;
        }
        var body = {
            prompt_ids: pendingIds,
            workflow_id: wfId,
            preset_id: this._batchPresetId || 0,
            param_values: paramValues,
            style_suffix: (document.getElementById('bgenSuffix') || {}).value,
            use_module_preset: (document.getElementById('bgenUsePreset') || {}).checked ? 1 : 0,
            prompt_overrides: this._batchPromptOverrides || {},
            card_type_map: cardTypeMap,
            engine: engine,
            batch_size: batchSize,
            manual_text: (document.getElementById('bgenManualText') || {}).value || '',
            model_version: (document.getElementById('bgenDreaminaModel') || {}).value || '5.0',
            ratio: (document.getElementById('bgenDreaminaRatio') || {}).value || '1:1',
            resolution_type: (document.getElementById('bgenDreaminaRes') || {}).value || '2k',
            project_uuid: (document.getElementById('bgenLibtvProject') || {}).value || '',
            libtv_model: (document.getElementById('bgenLibtvModel') || {}).value || 'Z-image Turbo',
            libtv_ratio: (document.getElementById('bgenLibtvRatio') || {}).value || '1:1'
        };
        try {
            var d = await this.fetchJSON('/api/v2/comfyui/batch-tasks', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
                _timeoutMs: 60000   // 2026-08-10: 大批量（200+/批）提交给足超时，防 30s 误杀
            });
            if (!d || !d.ok) {
                // 2026-08-10: 后端权威防重信息（queued_skip）优先展示
                var _errMsg = (d && (d.error || '')) || '创建失败';
                if (d && d.stats && d.stats.queued_skip > 0) {
                    _errMsg = '所选 ' + d.stats.queued_skip + ' 张词卡均在生成队列中，无需重复提交';
                }
                this.showToast('任务创建失败: ' + _errMsg, 'error');
                if (txt) txt.textContent = '❌ ' + _errMsg;
                this._batchSubmitting = false;
                this._batchSubmittingAt = null;
                return false;
            }
            var taskIds = d.task_ids || (d.task_id ? [d.task_id] : []);
            if (!taskIds.length) {
                this.showToast('任务创建失败: 无任务 ID', 'error');
                if (txt) txt.textContent = '❌ 任务创建失败';
                this._batchSubmitting = false;
                this._batchSubmittingAt = null;
                return false;
            }
            this._batchTaskId = taskIds[taskIds.length - 1];
            this._batchTaskTotal = d.total || pendingIds.length;
            // 后端按库内最新数据过滤（AI 已生成的词卡）
            if (d.skipped > 0) {
                this.showToast('已跳过 ' + d.skipped + ' 张（AI 已生成），任务将生成 ' + (d.total || pendingIds.length) + ' 张' + (d.batches > 1 ? '，分 ' + d.batches + ' 批' : ''), 'info');
            }
            // 记录本次任务的词卡 → 队列占用（避免重复提交同一批词卡）
            this._batchQueuedPids = this._batchQueuedPids || {};
            this._batchTaskPids = this._batchTaskPids || {};
            for (var _qq = 0; _qq < pendingIds.length; _qq++) this._batchQueuedPids[pendingIds[_qq]] = true;
            // 任务入队：多任务并行追踪（各自独立轮询，互不影响）
            // 2026-08-10: _batchTaskPids 按 batch_size 切片精确对应后端任务（终态释放精确，服务端活跃任务防重兜底）
            this._batchTaskIds = this._batchTaskIds || [];
            var _chunked = [];
            if (d.batches > 1 && batchSize > 0) {
                for (var _ci = 0; _ci < pendingIds.length; _ci += batchSize) {
                    _chunked.push(pendingIds.slice(_ci, _ci + batchSize));
                }
            } else {
                _chunked.push(pendingIds.slice());
            }
            for (var _tid = 0; _tid < taskIds.length; _tid++) {
                if (this._batchTaskIds.indexOf(taskIds[_tid]) === -1) this._batchTaskIds.push(taskIds[_tid]);
                this._batchTaskPids[taskIds[_tid]] = _chunked[_tid] || [];
                this._pollBatchTask(taskIds[_tid]);
            }
            // 持久化任务队列：刷新页面/重开浏览器后自动恢复轮询（任务在服务端继续执行）
            try { localStorage.setItem('wc_batch_task_ids', JSON.stringify(this._batchTaskIds)); } catch(e) {}
            // 记住本次参数设置（下次打开恢复）
            this._saveBatchSettings();
            if (txt) txt.textContent = '任务 #' + taskIds.join(', #') + ' 已创建（' + (d.workflow_name || '') + '）' + (d.batches > 1 ? '，共 ' + d.batches + ' 批' : '') + '，等待执行...';
            this.showToast('生成任务 ' + taskIds.length + ' 个已入队（' + this._batchTaskTotal + ' 张' + (d.batches > 1 ? '，每批 ' + (bsEl && bsEl.value || '') + ' 张' : '') + '）', 'info');
            // 2026-08-10 修复：return 前必须重置提交锁（否则 30s 内再次提交被误拦）
            this._batchSubmitting = false;
            this._batchSubmittingAt = null;
            return true;
        } catch(e) {
            this.showToast('任务创建异常: ' + e.message, 'error');
            if (txt) txt.textContent = '❌ ' + e.message;
            startBtn.disabled = false;
            this._batchGenRunning = false;
            this._batchSubmitting = false;
            this._batchSubmittingAt = null;
            return false;
        }
        this._batchSubmitting = false;
        this._batchSubmittingAt = null;
    },

    // 轮询任务进度（2s 间隔；任务在后台线程执行，前端刷新/断线不影响）
    // 多任务队列：每个任务独立轮询互不影响；弹窗 UI 始终显示最近提交任务的进度
    _pollBatchTask(taskId) {
        var self = this;
        var tid = taskId || this._batchTaskId;
        if (!tid) return;
        this._batchPolls = this._batchPolls || {};
        if (this._batchPolls[tid]) return;  // 该任务已有轮询在跑
        this._batchPolls[tid] = true;
        // 弹窗打开时确保进度区可见（关窗重开/刷新恢复场景）
        var pa = document.getElementById('bgenProgressArea');
        if (pa) pa.style.display = 'block';
        var interval = setInterval(async function() {
            // 动态判断当前任务（最近任务结束后会切换到队列下一个，接管弹窗 UI）
            var isCurrent = (tid === self._batchTaskId);
            try {
                var d = await self.fetchJSON('/api/v2/comfyui/batch-tasks/' + tid);
                if (!d || !d.ok || !d.task) {
                    // 任务不存在（已被服务端清理）→ 从队列移除
                    clearInterval(interval);
                    self._batchPolls[tid] = false;
                    self._dropBatchTask(tid);
                    return;
                }
                var t = d.task;
                var stMap = { queued: '排队中', running: '生成中', done: '已完成', cancelled: '已取消', error: '失败' };
                // 刷新页面后恢复：从任务详情重建词卡占用（避免重复提交同批词卡）
                if ((t.status === 'queued' || t.status === 'running') && (!self._batchTaskPids || !self._batchTaskPids[tid])) {
                    self._batchTaskPids = self._batchTaskPids || {};
                    self._batchQueuedPids = self._batchQueuedPids || {};
                    self._batchTaskPids[tid] = (t.prompt_ids || []).slice();
                    for (var _qp = 0; _qp < (t.prompt_ids || []).length; _qp++) self._batchQueuedPids[t.prompt_ids[_qp]] = true;
                }
                // 仅当前任务更新弹窗进度 UI
                if (isCurrent) {
                    var pct = t.total > 0 ? Math.round(t.current_index / t.total * 100) : 0;
                    var bar = document.getElementById('bgenProgressBar');
                    if (bar) bar.style.width = pct + '%';
                    var txt = document.getElementById('bgenProgressText');
                    if (txt) {
                        var eta = '';
                        if (t.status === 'running') eta = self._batchEtaText(t);
                        var queueRest = (self._batchTaskIds || []).filter(function(x) { return x !== tid; }).length;
                        txt.textContent = (stMap[t.status] || t.status) + '：' + t.current_index + '/' + t.total + '（成功 ' + t.success + ' / 失败 ' + t.failed + '）' + eta + (queueRest > 0 ? ' · 队列中还有 ' + queueRest + ' 个任务' : '');
                    }
                    // 明细（全量渲染，最后一项高亮为当前项）
                    self._renderBatchResults(t.results || [], t.status);
                }
                if (t.status === 'done' || t.status === 'cancelled' || t.status === 'error') {
                    clearInterval(interval);
                    self._batchPolls[tid] = false;
                    // 2026-08-10 修复：任务终态后释放词卡占用（允许失败项/后续批次重新提交；后端按完成态过滤兜底）
                    if (self._batchTaskPids && self._batchTaskPids[tid] && self._batchQueuedPids) {
                        var _rel = self._batchTaskPids[tid];
                        for (var _ri = 0; _ri < _rel.length; _ri++) delete self._batchQueuedPids[_rel[_ri]];
                    }
                    self._dropBatchTask(tid);
                    if (t.status === 'done') {
                        self.showToast('任务 #' + tid + ' 完成：' + t.success + ' 成功 / ' + t.failed + ' 失败', t.failed > 0 ? 'warning' : 'success');
                        // 任务完成：自动取消词卡选择（清空编辑模式勾选，保留编辑模式状态）
                        if (self.state && self.state.batchSelected) {
                            self.state.batchSelected.clear();
                            if (typeof self.updateBatchCount === 'function') self.updateBatchCount();
                        }
                        if (isCurrent) {
                            self._batchFailedIds = (t.results || []).filter(function(r) { return !r.ok; }).map(function(r) { return r.prompt_id; });
                            self._batchSuccess = (t.results || []).filter(function(r) { return r.ok && r.thumbnail_url; }).map(function(r) { return { thumb: r.thumbnail_url, text: r.prompt_text || '' }; });
                            self._renderBatchGrid();
                            if (t.failed > 0) {
                                var retryBtn2 = document.getElementById('bgenRetryBtn');
                                if (retryBtn2) retryBtn2.style.display = 'inline-flex';
                            }
                            var startBtn = document.getElementById('bgenStartBtn');
                            if (startBtn) startBtn.disabled = false;
                        }
                        // 完成后自动刷新当前列表 + 预览区（弹窗关闭/切页后依然生效，新缩略图立即可见）
                        if (typeof self.loadPrompts === 'function') {
                            var _lp = self.loadPrompts();
                            if (_lp && typeof _lp.then === 'function') {
                                _lp.then(function() {
                                    // 数据刷新后再重绘预览区：缩略图 + ✅已生成徽章实时更新
                                    if (typeof self._renderBatchPreview === 'function') self._renderBatchPreview();
                                });
                            } else if (typeof self._renderBatchPreview === 'function') {
                                self._renderBatchPreview();
                            }
                        } else if (typeof self._renderBatchPreview === 'function') {
                            self._renderBatchPreview();
                        }
                    } else if (t.status === 'cancelled') {
                        self.showToast('任务 #' + tid + ' 已取消' + (t.current_index > 0 ? '（已完成 ' + t.current_index + '/' + t.total + '）' : ''), 'info');
                    } else {
                        self.showToast('任务 #' + tid + ' 异常: ' + (t.error || ''), 'error');
                    }
                }
            } catch(e) { /* 网络抖动忽略，下轮重试 */ }
        }, 2000);
    },

    // 从队列移除已完成/失败/取消的任务（更新内存 + localStorage）
    _dropBatchTask(tid) {
        // 任务终态：释放该任务占用的词卡（成功者已有缩略图被自动过滤，失败者可重新提交）
        var tps = this._batchTaskPids || {};
        var tPids = tps[tid] || [];
        if (this._batchQueuedPids) {
            for (var _rp = 0; _rp < tPids.length; _rp++) delete this._batchQueuedPids[tPids[_rp]];
        }
        delete tps[tid];
        this._batchTaskIds = (this._batchTaskIds || []).filter(function(x) { return x !== tid; });
        try { localStorage.setItem('wc_batch_task_ids', JSON.stringify(this._batchTaskIds)); } catch(e) {}
        if (tid === this._batchTaskId) {
            // 最近任务结束：若队列还有任务，弹窗当前任务切换到队列中最后一个；否则清空
            if (this._batchTaskIds.length > 0) {
                this._batchTaskId = this._batchTaskIds[this._batchTaskIds.length - 1];
            } else {
                this._batchTaskId = null;
            }
            this._batchGenRunning = this._batchTaskIds.length > 0;
        }
    },

    // ETA 估算文本（基于任务进度与已耗时）
    _batchEtaText(t) {
        try {
            var elapsed = (Date.now() - new Date((t.started_at || '').replace(' ', 'T')).getTime()) / 1000;
            if (elapsed < 5 || t.current_index <= 0) return '';
            var avg = elapsed / t.current_index;
            var remain = Math.max(0, t.total - t.current_index);
            var eta = Math.round(avg * remain);
            if (eta <= 0) return '';
            return ' · 预计剩余 ' + (eta < 60 ? eta + 's' : Math.floor(eta / 60) + '分' + (eta % 60) + 's');
        } catch(e) { return ''; }
    },

    // 从任务结果渲染明细列表
    _renderBatchResults(results, status) {
        var det = document.getElementById('bgenDetail');
        if (!det) return;
        if (!results || results.length === 0) {
            if (status === 'queued') det.innerHTML = '<div style="font-size:11px;color:var(--text-muted);">任务排队中，等待执行...</div>';
            return;
        }
        var html = '';
        for (var i = 0; i < results.length; i++) {
            var r = results[i];
            var isCur = (status === 'running') && (i === results.length - 1);
            var color = r.ok ? '#10b981' : '#ef4444';
            html += '<div class="bgen-item' + (isCur ? ' bgen-active" style="border-left:3px solid ' + color + ';"' : '"') + ' style="border-color:' + color + '33;">' +
              (r.thumbnail_url ? '<img src="' + r.thumbnail_url + '" style="width:42px;height:28px;object-fit:cover;border-radius:4px;flex-shrink:0;" loading="lazy">' : '<span style="width:42px;text-align:center;flex-shrink:0;">' + (r.ok ? '✅' : '❌') + '</span>') +
              '<span style="flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="' + App._escape(r.prompt_text || '') + '">' + App._escape((r.prompt_text || '').slice(0, 40)) + '</span>' +
              '<span style="font-size:10px;color:' + color + ';flex-shrink:0;">' + (r.ok ? '成功' : (r.error || '失败')) + '</span>' +
            '</div>';
        }
        det.innerHTML = html;
        det.scrollTop = det.scrollHeight;
    },

    _appendBatchDetail(ev) {
        var det = document.getElementById('bgenDetail');
        if (!det) return;
        // 移除上一项高亮
        var prev = det.querySelector('.bgen-item.bgen-active');
        if (prev) prev.classList.remove('bgen-active');
        var st = ev.ok ? '✅' : '❌';
        var color = ev.ok ? '#10b981' : '#ef4444';
        var html = '<div class="bgen-item bgen-active" style="border-color:' + color + '33;border-left:3px solid ' + color + ';">' +
          (ev.thumbnail_url ? '<img src="' + ev.thumbnail_url + '" style="width:42px;height:28px;object-fit:cover;border-radius:4px;flex-shrink:0;" loading="lazy">' : '<span style="width:42px;text-align:center;flex-shrink:0;">' + st + '</span>') +
          '<span style="flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="' + App._escape(ev.prompt_text || '') + '">' + App._escape((ev.prompt_text || '').slice(0, 40)) + '</span>' +
          '<span style="font-size:10px;color:' + color + ';flex-shrink:0;">' + (ev.ok ? '成功' : (ev.error || '失败')) + '</span>' +
        '</div>';
        det.insertAdjacentHTML('beforeend', html);
        det.scrollTop = det.scrollHeight;
    },

    // 成功后缩略图网格总览（点击放大）
    _renderBatchGrid() {
        var grid = document.getElementById('bgenGrid');
        var items = document.getElementById('bgenGridItems');
        if (!grid || !items) return;
        var success = this._batchSuccess || [];
        if (success.length === 0) { grid.style.display = 'none'; return; }
        var html = '';
        success.forEach(function(s) {
            var fname = s.thumb.split('/').pop();
            html += '<img src="' + s.thumb + '" style="width:100%;aspect-ratio:3/2;object-fit:cover;border-radius:6px;cursor:zoom-in;border:1px solid var(--border-color);" title="' + App._escape(s.text || '') + '" '
              + 'onmouseenter="App._bgenHoverShow(this,\'' + fname + '\')" onmousemove="App._bgenHoverMove(event)" onmouseleave="App._bgenHoverHide()" '
              + 'onclick="App.openImageViewer(\'' + fname + '\')" loading="lazy">';
        });
        items.innerHTML = html;
        grid.style.display = 'block';
    },

    // 悬停大图预览：跟随鼠标显示原图（不阻塞点击）
    _bgenHoverShow(el, fname) {
        var hp = document.getElementById('bgenHoverImg');
        if (!hp) {
            hp = document.createElement('img');
            hp.id = 'bgenHoverImg';
            hp.style.cssText = 'position:fixed;z-index:2000;pointer-events:none;max-width:360px;max-height:280px;object-fit:contain;border-radius:10px;box-shadow:0 12px 40px rgba(0,0,0,0.45);border:2px solid rgba(99,102,241,0.6);background:#0f172a;display:none;';
            document.body.appendChild(hp);
        }
        if (!fname) { hp.style.display = 'none'; return; }
        if (hp.dataset.fname !== fname) {
            hp.dataset.fname = fname;
            hp.src = '/api/media/original/' + fname;
        }
        hp.style.display = 'block';
    },

    // 悬停跟随：原图左上角偏移鼠标 14px，越界时翻转到另一侧
    _bgenHoverMove(e) {
        var hp = document.getElementById('bgenHoverImg');
        if (!hp || hp.style.display === 'none') return;
        var off = 14;
        var x = e.clientX + off;
        var y = e.clientY + off;
        if (x + 360 > window.innerWidth - 8) x = e.clientX - 360 - off;
        if (y + 280 > window.innerHeight - 8) y = e.clientY - 280 - off;
        hp.style.left = Math.max(4, x) + 'px';
        hp.style.top = Math.max(4, y) + 'px';
    },

    // 隐藏悬停大图
    _bgenHoverHide() {
        var hp = document.getElementById('bgenHoverImg');
        if (hp) hp.style.display = 'none';
    },

    // 重试失败项：创建新任务（仅失败词条）
    async _retryBatchFailed() {
        if (!this._batchTaskId) return;
        try {
            var d = await this.fetchJSON('/api/v2/comfyui/batch-tasks/' + this._batchTaskId + '/retry-failed', {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}'
            });
            if (!d || !d.ok) { this.showToast('重试失败: ' + (d && d.error || ''), 'error'); return; }
            var retryBtn = document.getElementById('bgenRetryBtn');
            if (retryBtn) retryBtn.style.display = 'none';
            var det = document.getElementById('bgenDetail');
            if (det) det.innerHTML = '';
            this._batchTaskId = d.task_id;
            this._batchTaskTotal = d.total;
            // 重试任务入队（多任务队列）
            this._batchTaskIds = this._batchTaskIds || [];
            if (this._batchTaskIds.indexOf(d.task_id) === -1) this._batchTaskIds.push(d.task_id);
            try { localStorage.setItem('wc_batch_task_ids', JSON.stringify(this._batchTaskIds)); } catch(e) {}
            this._batchGenRunning = true;
            var startBtn = document.getElementById('bgenStartBtn');
            if (startBtn) startBtn.disabled = false;
            var txt = document.getElementById('bgenProgressText');
            if (txt) txt.textContent = '重试任务 #' + d.task_id + '（' + d.total + ' 张）...';
            this._pollBatchTask(d.task_id);
        } catch(e) {
            this.showToast('重试异常: ' + e.message, 'error');
        }
    },

    async _cancelBatchGen() {
        if (!this._batchTaskId) { this.showToast('无进行中的任务', 'info'); return; }
        try {
            var d = await this.fetchJSON('/api/v2/comfyui/batch-tasks/' + this._batchTaskId + '/cancel', {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}'
            });
            this.showToast('已请求取消任务 #' + this._batchTaskId, 'info');
        } catch(e) {
            this.showToast('取消失败: ' + e.message, 'error');
        }
    },

    // ============ 收藏夹 ============
    async batchRemoveFromCollection() {
        var ids = [...this.state.batchSelected];
        var cid = this.state.currentCollection;
        if (ids.length === 0) { this.showToast('请先选择词条', 'error'); return; }
        if (!confirm('确认将选中的 ' + ids.length + ' 条移出本收藏分组？')) return;
        var data = await this.fetchJSON('/api/v2/collections/' + cid + '/items/batch-remove', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt_ids: ids })
        });
        if (data && data.ok) {
            this.showToast('已移出 ' + data.removed + ' 条', 'success');
            this._afterBatchOp();
            await this.loadCollections();
            await this.loadCollectionItems();
        } else {
            this.showToast('操作未完成，稍后再试: ' + (data ? data.error : '遇到意外情况，请稍后再试'), 'error');
        }
    },


    _engineAuthTrackTimer(timer) {
        if (!this._engineAuthTimers) this._engineAuthTimers = [];
        this._engineAuthTimers.push(timer);
    },

    // 清理所有授权轮询
    _engineAuthClearTimers() {
        (this._engineAuthTimers || []).forEach(function(t) { clearInterval(t); });
        this._engineAuthTimers = [];
    },

    // 取消当前等待（engine: dreamina | libtv）
    _engineAuthCancelWait(engine) {
        this._engineAuthClearTimers();
        var flow = document.getElementById(engine === 'dreamina' ? 'engineAuthDreaminaFlow' : 'engineAuthLibtvFlow');
        if (flow) flow.innerHTML = '<span style="color:var(--text-muted);">已取消等待，可重新发起</span>';
        if (engine === 'dreamina') this._engineAuthDreamina(); else this._engineAuthLibtv();
    },

    // 复制文本（clipboard API，HTTP 环境降级 execCommand）
    _engineAuthCopy(text) {
        var done = function() { App.showToast('已复制', 'success'); };
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(done).catch(function() { App._engineAuthCopyFallback(text); done(); });
        } else { this._engineAuthCopyFallback(text); done(); }
    },

    _engineAuthCopyFallback(text) {
        var ta = document.createElement('textarea');
        ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
        document.body.appendChild(ta); ta.select();
        try { document.execCommand('copy'); } catch(e) {}
        document.body.removeChild(ta);
    },

    // 刷新授权中心状态
    async _engineAuthRefresh() {
        this._engineAuthDreamina();
        this._engineAuthLibtv();
    },

    // 按钮 loading 辅助
    _engineAuthBtnBusy(btn, busy, busyText) {
        if (!btn) return;
        if (busy) {
            btn._origHtml = btn.innerHTML;
            btn.disabled = true;
            btn.style.opacity = '0.6';
            btn.innerHTML = '<span class="spinner-border spinner-border-sm" style="width:10px;height:10px;"></span> ' + (busyText || '处理中...');
        } else {
            btn.disabled = false;
            btn.style.opacity = '';
            if (btn._origHtml) btn.innerHTML = btn._origHtml;
        }
    },

    // ---- 即梦 ----
    async _engineAuthDreamina() {
        var st = document.getElementById('engineAuthDreaminaStatus');
        var body = document.getElementById('engineAuthDreaminaBody');
        var btns = document.getElementById('engineAuthDreaminaBtns');
        if (!st) return;
        if (btns) btns.innerHTML = '';
        try {
            var d = await this.fetchJSON('/api/v2/dreamina/status');
            if (!d || !d.ok) throw new Error('查询失败');
            if (!d.cli_available) {
                st.textContent = '○ CLI 未安装';
                st.style.color = '#ef4444';
                if (body) body.innerHTML = '未找到即梦 CLI：<code>' + App._escape(d.bin || '~/bin/dreamina.exe') + '</code><br><span style="font-size:11px;color:var(--text-muted);">请将 dreamina.exe 放入应用目录 bin/ 后点「重新检测」</span>';
                if (btns) btns.innerHTML = '<button class="btn btn-sm" style="border:1px solid #6366f1;color:#6366f1;" onclick="App._engineAuthDreamina()"><i class="bi bi-arrow-clockwise"></i> 重新检测</button>';
                return;
            }
            if (d.logged_in) {
                st.textContent = '● 已登录' + (d.vip_level ? ' · ' + d.vip_level : '');
                st.style.color = '#10b981';
                if (body) body.innerHTML = '即梦 CLI 可用，可直接生成图片';
                if (btns) btns.innerHTML = '<button class="btn btn-sm" style="border:1px solid #ef4444;color:#ef4444;" onclick="App._engineAuthDreaminaLogout(this)">退出登录</button>';
            } else {
                st.textContent = '○ 未登录';
                st.style.color = '#f59e0b';
                if (body) body.innerHTML = '点击「授权登录」完成 OAuth 授权（浏览器打开链接 + 输入验证码）';
                if (btns) btns.innerHTML = '<button class="btn btn-sm" style="border:1px solid #6366f1;color:#6366f1;" onclick="App._engineAuthDreaminaLogin(this)">授权登录</button>';
            }
        } catch(e) {
            st.textContent = '○ 检测失败';
            st.style.color = '#94a3b8';
            if (body) body.innerHTML = '无法连接即梦 CLI，请确认服务与网络正常';
            if (btns) btns.innerHTML = '<button class="btn btn-sm" style="border:1px solid #6366f1;color:#6366f1;" onclick="App._engineAuthDreamina()">重新检测</button>';
        }
    },

    // 即梦授权登录：Device Flow，展示链接+验证码+复制，自动轮询可取消
    async _engineAuthDreaminaLogin(btn) {
        var flow = document.getElementById('engineAuthDreaminaFlow');
        if (!flow) return;
        this._engineAuthClearTimers();
        this._engineAuthBtnBusy(btn, true, '获取中...');
        flow.style.display = 'block';
        flow.innerHTML = '<span style="color:var(--text-muted);">正在获取授权材料...</span>';
        try {
            var d = await this.fetchJSON('/api/v2/dreamina/auth/login-start', {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}'
            });
            this._engineAuthBtnBusy(btn, false);
            if (!d || !d.ok) {
                flow.innerHTML = '<span style="color:#ef4444;">' + App._escape(d && d.error || '发起失败') + '</span>';
                return;
            }
            if (d.already_logged_in) {
                flow.innerHTML = '<span style="color:#10b981;">已登录，无需重复授权</span>';
                this._engineAuthDreamina();
                return;
            }
            flow.innerHTML =
                '<div style="margin-bottom:6px;"><b>步骤 1/2</b> 打开链接并输入验证码：</div>' +
                '<div style="word-break:break-all;margin-bottom:6px;"><a href="' + App._escape(d.verification_uri) + '" target="_blank" rel="noopener" style="color:#6366f1;">' + App._escape(d.verification_uri) + '</a></div>' +
                '<div style="margin-bottom:6px;"><b>步骤 2/2</b> 验证码：<b style="font-family:monospace;font-size:16px;color:#6366f1;letter-spacing:2px;">' + App._escape(d.user_code) + '</b> <button class="btn btn-sm" style="margin-left:4px;border:1px solid #6366f1;color:#6366f1;" onclick="App._engineAuthCopy(\'' + d.user_code + '\')">复制</button></div>' +
                '<div style="font-size:11px;color:var(--text-muted);">有效期至 ' + App._escape(d.expires_at || '') + ' · 完成授权后自动检测</div>' +
                '<div id="engineAuthDreaminaPolling" style="margin-top:8px;font-size:11px;color:var(--text-muted);"></div>' +
                '<div style="margin-top:8px;"><button class="btn btn-sm btn-secondary" onclick="App._engineAuthCancelWait(\'dreamina\')">取消等待</button></div>';
            var self = this;
            var dev = d.device_code;
            var pollTxt = document.getElementById('engineAuthDreaminaPolling');
            var tries = 0;
            var timer = setInterval(async function() {
                tries++;
                try {
                    var r = await self.fetchJSON('/api/v2/dreamina/auth/login-poll', {
                        method: 'POST', headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ device_code: dev, poll: 5 })
                    });
                    if (r && r.ok && r.logged_in) {
                        clearInterval(timer);
                        self._engineAuthClearTimers();
                        if (pollTxt) pollTxt.innerHTML = '<span style="color:#10b981;">✓ 授权成功！</span>';
                        self._engineAuthDreamina();
                        self.showToast('即梦授权成功', 'success');
                    } else if (tries > 60) {
                        clearInterval(timer);
                        if (pollTxt) pollTxt.innerHTML = '<span style="color:#f59e0b;">授权超时（5 分钟），请重新发起</span>';
                    } else if (pollTxt) {
                        pollTxt.innerHTML = '<span class="spinner-border spinner-border-sm" style="width:10px;height:10px;"></span> 等待授权完成...（' + (tries * 5) + 's）' + (r && r.error ? ' ' + App._escape(r.error) : '');
                    }
                } catch(e) {
                    if (pollTxt) pollTxt.innerHTML = '<span style="color:#ef4444;">轮询异常: ' + App._escape(e.message) + '</span>';
                }
            }, 5000);
            this._engineAuthTrackTimer(timer);
        } catch(e) {
            this._engineAuthBtnBusy(btn, false);
            flow.innerHTML = '<span style="color:#ef4444;">发起失败: ' + App._escape(e.message) + '</span>';
        }
    },

    // 即梦退出登录
    async _engineAuthDreaminaLogout(btn) {
        if (!confirm('确认退出即梦登录？')) return;
        this._engineAuthBtnBusy(btn, true, '退出中...');
        try {
            await this.fetchJSON('/api/v2/dreamina/auth/logout', {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}'
            });
            this._engineAuthBtnBusy(btn, false);
            this.showToast('已退出即梦登录', 'success');
            this._engineAuthDreamina();
        } catch(e) {
            this._engineAuthBtnBusy(btn, false);
            this.showToast('退出失败: ' + e.message, 'error');
        }
    },

    // ---- LibTV ----
    async _engineAuthLibtv() {
        var st = document.getElementById('engineAuthLibtvStatus');
        var body = document.getElementById('engineAuthLibtvBody');
        var btns = document.getElementById('engineAuthLibtvBtns');
        if (!st) return;
        if (btns) btns.innerHTML = '';
        try {
            var d = await this.fetchJSON('/api/v2/libtv/status');
            if (!d || !d.ok) throw new Error('查询失败');
            if (!d.cli_available) {
                st.textContent = '○ CLI 未安装';
                st.style.color = '#ef4444';
                if (body) body.innerHTML = '未找到 libtv CLI：<code>' + App._escape(d.bin || '~/.libtv/libtv.exe') + '</code><br><span style="font-size:11px;color:var(--text-muted);">请将 libtv.exe 放入应用目录 bin/ 后点「重新检测」</span>';
                if (btns) btns.innerHTML = '<button class="btn btn-sm" style="border:1px solid #8b5cf6;color:#8b5cf6;" onclick="App._engineAuthLibtv()"><i class="bi bi-arrow-clockwise"></i> 重新检测</button>';
                return;
            }
            if (d.logged_in) {
                st.textContent = '● 已登录';
                st.style.color = '#10b981';
                if (body) body.innerHTML = 'LibTV CLI 可用 · ' + (d.projects || []).length + ' 张画布可用';
                if (btns) btns.innerHTML =
                    '<button class="btn btn-sm" style="border:1px solid #8b5cf6;color:#8b5cf6;" onclick="App._engineAuthLibtvLogin(this)">切换账号</button>' +
                    '<button class="btn btn-sm" style="border:1px solid #ef4444;color:#ef4444;" onclick="App._engineAuthLibtvLogout(this)">退出登录</button>';
                // 账号列表
                var acc = await this.fetchJSON('/api/v2/libtv/auth/account-list', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}'
                });
                var accBox = document.getElementById('engineAuthLibtvAccounts');
                if (accBox && acc && acc.accounts && acc.accounts.length > 1) {
                    var html = '<div style="margin-bottom:4px;color:var(--text-muted);">账号列表：</div>';
                    acc.accounts.forEach(function(a) {
                        html += '<button class="bgen-btn" style="margin:2px;' + (a.isActive ? 'border-color:#8b5cf6;color:#8b5cf6;' : '') + '" onclick="App._engineAuthLibtvUse(' + (a.accountId || 0) + ')">' + App._escape(a.accountName || ('#' + a.accountId)) + (a.isActive ? ' ✓' : '') + '</button>';
                    });
                    accBox.innerHTML = html;
                    accBox.style.display = 'block';
                } else if (accBox) {
                    accBox.style.display = 'none';
                }
            } else {
                st.textContent = '○ 未登录';
                st.style.color = '#f59e0b';
                if (body) body.innerHTML = '选择一种方式登录：';
                if (btns) btns.innerHTML =
                    '<button class="btn btn-sm" style="border:1px solid #8b5cf6;color:#8b5cf6;" onclick="App._engineAuthLibtvLogin(this)">浏览器授权</button>' +
                    '<button class="btn btn-sm" style="border:1px solid #8b5cf6;color:#8b5cf6;" onclick="App._engineAuthLibtvPhone()">手机验证码</button>';
                var accBox2 = document.getElementById('engineAuthLibtvAccounts');
                if (accBox2) accBox2.style.display = 'none';
            }
        } catch(e) {
            st.textContent = '○ 检测失败';
            st.style.color = '#94a3b8';
            if (body) body.innerHTML = '无法连接 libtv CLI，请确认服务与网络正常';
            if (btns) btns.innerHTML = '<button class="btn btn-sm" style="border:1px solid #8b5cf6;color:#8b5cf6;" onclick="App._engineAuthLibtv()">重新检测</button>';
        }
    },

    // LibTV 浏览器授权
    async _engineAuthLibtvLogin(btn) {
        var flow = document.getElementById('engineAuthLibtvFlow');
        if (!flow) return;
        this._engineAuthClearTimers();
        this._engineAuthBtnBusy(btn, true, '启动中...');
        flow.style.display = 'block';
        flow.innerHTML = '<span style="color:var(--text-muted);">正在启动浏览器授权...</span>';
        try {
            var d = await this.fetchJSON('/api/v2/libtv/auth/login-web-start', {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}'
            });
            this._engineAuthBtnBusy(btn, false);
            if (!d || !d.ok) {
                flow.innerHTML = '<span style="color:#ef4444;">' + App._escape(d && d.error || '发起失败') + '</span>';
                return;
            }
            var urlHtml = d.url
                ? '<div style="word-break:break-all;margin:6px 0;"><a href="' + App._escape(d.url) + '" target="_blank" rel="noopener" style="color:#8b5cf6;">' + App._escape(d.url) + '</a> <button class="btn btn-sm" style="margin-left:4px;border:1px solid #8b5cf6;color:#8b5cf6;" onclick="App._engineAuthCopy(\'' + d.url + '\')">复制</button></div>'
                : '<div style="color:#f59e0b;margin:6px 0;">未能获取授权链接，请关闭后重试</div>';
            flow.innerHTML =
                '<div style="margin-bottom:6px;"><b>请在浏览器中打开以下链接完成 LibTV 登录</b>（建议用运行本服务的电脑浏览器）：</div>' +
                urlHtml +
                '<div style="font-size:11px;color:var(--text-muted);">完成登录后本页会自动检测，无需手动操作</div>' +
                '<div id="engineAuthLibtvPolling" style="margin-top:4px;font-size:11px;color:var(--text-muted);"></div>' +
                '<div style="margin-top:8px;"><button class="btn btn-sm btn-secondary" onclick="App._engineAuthCancelWait(\'libtv\')">取消等待</button></div>';
            var self = this;
            var tries = 0;
            var timer = setInterval(async function() {
                tries++;
                try {
                    var r = await self.fetchJSON('/api/v2/libtv/auth/login-web-status', {
                        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}'
                    });
                    if (r && r.ok && r.logged_in) {
                        clearInterval(timer);
                        self._engineAuthClearTimers();
                        flow.innerHTML = '<span style="color:#10b981;">✓ 授权成功！</span>';
                        self._engineAuthLibtv();
                        self.showToast('LibTV 授权成功', 'success');
                    } else if (tries > 60) {
                        clearInterval(timer);
                        flow.innerHTML = '<span style="color:#f59e0b;">授权超时（5 分钟），请重新发起</span>';
                    } else {
                        var pt = document.getElementById('engineAuthLibtvPolling');
                        if (pt) pt.innerHTML = '<span class="spinner-border spinner-border-sm" style="width:10px;height:10px;"></span> 等待浏览器授权...（' + (tries * 5) + 's）';
                    }
                } catch(e) {
                    if (tries > 60) { clearInterval(timer); flow.innerHTML = '<span style="color:#ef4444;">检测异常</span>'; }
                }
            }, 5000);
            this._engineAuthTrackTimer(timer);
        } catch(e) {
            this._engineAuthBtnBusy(btn, false);
            flow.innerHTML = '<span style="color:#ef4444;">发起失败: ' + App._escape(e.message) + '</span>';
        }
    },

    // LibTV 手机验证码：内嵌表单（手机号 → 验证码），替代原生 prompt
    _engineAuthLibtvPhone() {
        var flow = document.getElementById('engineAuthLibtvFlow');
        if (!flow) return;
        this._engineAuthClearTimers();
        flow.style.display = 'block';
        flow.innerHTML =
            '<div style="margin-bottom:6px;"><b>手机验证码登录</b></div>' +
            '<div style="display:flex;gap:6px;margin-bottom:6px;">' +
            '<input id="ltvPhoneInput" type="tel" maxlength="11" placeholder="11 位手机号" class="modal-input" style="flex:1;min-width:0;" value="' + App._escape(this._ltvPhone || '') + '">' +
            '<button class="btn btn-sm" id="ltvSendBtn" style="border:1px solid #8b5cf6;color:#8b5cf6;white-space:nowrap;" onclick="App._engineAuthLibtvSendCode(this)">发送验证码</button>' +
            '</div>' +
            '<div id="ltvPhoneMsg" style="font-size:11px;color:var(--text-muted);"></div>';
        var input = document.getElementById('ltvPhoneInput');
        if (input) { input.focus(); input.select(); }
    },

    // 发送验证码
    async _engineAuthLibtvSendCode(btn) {
        var input = document.getElementById('ltvPhoneInput');
        var msg = document.getElementById('ltvPhoneMsg');
        var phone = input ? input.value.trim() : '';
        if (!/^\d{11}$/.test(phone)) { if (msg) msg.innerHTML = '<span style="color:#ef4444;">请输入 11 位手机号</span>'; return; }
        this._ltvPhone = phone;
        this._engineAuthBtnBusy(btn, true, '发送中...');
        if (msg) msg.innerHTML = '<span style="color:var(--text-muted);">正在发送验证码...</span>';
        try {
            var d = await this.fetchJSON('/api/v2/libtv/auth/login-phone', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ phone: phone })
            });
            this._engineAuthBtnBusy(btn, false);
            if (d && d.ok && d.logged_in) {
                if (msg) msg.innerHTML = '<span style="color:#10b981;">✓ 登录成功！</span>';
                this._engineAuthLibtv();
                this.showToast('LibTV 登录成功', 'success');
                return;
            }
            if (d && d.need_captcha) {
                if (msg) msg.innerHTML = '<span style="color:#f59e0b;">需要人机验证，请在浏览器弹出页完成验证后重试</span>';
                return;
            }
            if (!d || !d.ok) {
                // send 步骤：CLI 提示"已发送"视为成功，否则报错
                var sendErr = (d && d.error) || '';
                if (!/已发送|发送成功|验证码已|sent|success/i.test(sendErr)) {
                    if (msg) msg.innerHTML = '<span style="color:#ef4444;">' + App._escape(sendErr || '发送失败') + '</span>';
                    return;
                }
            }
            if (msg) msg.innerHTML = '<span style="color:#10b981;">验证码已发送，请输入：</span>';
            var flow = document.getElementById('engineAuthLibtvFlow');
            if (flow) flow.innerHTML +=
                '<div style="display:flex;gap:6px;margin-top:6px;">' +
                '<input id="ltvCodeInput" type="text" maxlength="6" inputmode="numeric" placeholder="6 位验证码" class="modal-input" style="flex:1;min-width:0;">' +
                '<button class="btn btn-sm" style="border:1px solid #8b5cf6;color:#8b5cf6;white-space:nowrap;" onclick="App._engineAuthLibtvVerifyCode(this)">完成登录</button>' +
                '</div>';
            var ci = document.getElementById('ltvCodeInput');
            if (ci) ci.focus();
        } catch(e) {
            this._engineAuthBtnBusy(btn, false);
            if (msg) msg.innerHTML = '<span style="color:#ef4444;">发送失败: ' + App._escape(e.message) + '</span>';
        }
    },

    // 验证验证码
    async _engineAuthLibtvVerifyCode(btn) {
        var ci = document.getElementById('ltvCodeInput');
        var msg = document.getElementById('ltvPhoneMsg');
        var code = ci ? ci.value.trim() : '';
        if (!code) { if (msg) msg.innerHTML = '<span style="color:#ef4444;">请输入验证码</span>'; return; }
        this._engineAuthBtnBusy(btn, true, '验证中...');
        if (msg) msg.innerHTML = '<span style="color:var(--text-muted);">正在验证...</span>';
        try {
            var d = await this.fetchJSON('/api/v2/libtv/auth/login-phone', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ phone: this._ltvPhone || '', code: code })
            });
            this._engineAuthBtnBusy(btn, false);
            if (d && d.ok && d.logged_in) {
                if (msg) msg.innerHTML = '<span style="color:#10b981;">✓ 登录成功！</span>';
                this._engineAuthLibtv();
                this.showToast('LibTV 登录成功', 'success');
            } else {
                if (msg) msg.innerHTML = '<span style="color:#ef4444;">登录失败: ' + App._escape(d && d.error || '未知错误') + '</span>';
            }
        } catch(e) {
            this._engineAuthBtnBusy(btn, false);
            if (msg) msg.innerHTML = '<span style="color:#ef4444;">验证失败: ' + App._escape(e.message) + '</span>';
        }
    },

    // LibTV 切换账号
    async _engineAuthLibtvUse(accountId) {
        try {
            var d = await this.fetchJSON('/api/v2/libtv/auth/account-use', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ account_id: accountId })
            });
            if (d && d.ok) {
                this.showToast('已切换账号: ' + (d.accountName || accountId), 'success');
                this._engineAuthLibtv();
            } else {
                this.showToast('切换失败: ' + (d && d.error || ''), 'error');
            }
        } catch(e) {
            this.showToast('切换异常: ' + e.message, 'error');
        }
    },

    // LibTV 退出登录
    async _engineAuthLibtvLogout(btn) {
        if (!confirm('确认退出 LibTV 登录？')) return;
        this._engineAuthBtnBusy(btn, true, '退出中...');
        try {
            await this.fetchJSON('/api/v2/libtv/auth/logout', {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}'
            });
            this._engineAuthBtnBusy(btn, false);
            this.showToast('已退出 LibTV 登录', 'success');
            this._engineAuthLibtv();
        } catch(e) {
            this._engineAuthBtnBusy(btn, false);
            this.showToast('退出失败: ' + e.message, 'error');
        }
    },
});

// ============ 批量生成任务后台恢复 ============
// 页面刷新/重开浏览器后，若存在未完成的批量生成任务（localStorage 持久化任务ID），
// 自动恢复轮询：任务在服务端线程继续执行，前端重新接管进度，
// 完成后自动刷新列表输出结果 —— 关闭弹窗/切换页面/刷新页面均不中断生成。
(function _hookBatchTaskResume() {
    try { if (!App || !App.init) { setTimeout(_hookBatchTaskResume, 200); return; } }
    catch(e) { setTimeout(_hookBatchTaskResume, 200); return; }
    var _origInit = App.init;
    App.init = function() {
        if (_origInit) _origInit.apply(this);
        setTimeout(function() {
            try {
                var raw = localStorage.getItem('wc_batch_task_ids');
                if (!raw) raw = localStorage.getItem('wc_batch_task_id');  // 兼容旧版单任务 key
                var list = [];
                if (raw) { try { list = JSON.parse(raw) || []; } catch(e2) { list = []; } }
                App._batchTaskIds = list;
                App._batchTaskId = list.length > 0 ? list[list.length - 1] : null;
                App._batchGenRunning = list.length > 0;
                if (typeof App._pollBatchTask === 'function') {
                    for (var bi = 0; bi < list.length; bi++) App._pollBatchTask(list[bi]);
                }
            } catch(e) {}
        }, 2000);
    };
})();
})();
