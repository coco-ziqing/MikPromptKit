/**
 * seedance_pickers.js - Seedance V2 词库选取器（从 seedance_v2_composer.js 拆出）
 */
(function() {
'use strict';
if (!App.seedanceV2 || App.seedanceV2.openStylePicker) return;
    // ============ 画风词库选取器 ============
    App.seedanceV2._stylesData = null;
    App.seedanceV2.openStylePicker = async function() {
        if (!this._stylesData) {
            var d = await App.fetchJSON('/api/seedance/styles');
            if (d && d.categories) this._stylesData = d.categories;
        }
        var categories = this._stylesData || [];
        var overlay = document.createElement('div');
        overlay.id = 's2StylePicker';
        overlay.className = 'modal-overlay';
        overlay.style.cssText = 'display:flex;z-index:800;background:rgba(0,0,0,0.5);align-items:center;justify-content:center;';
        overlay.onclick = function(e) { if (e.target === this) this.remove(); };
        var h = '<div class="modal-content" style="max-width:700px;max-height:80vh;overflow-y:auto;">';
        h += '<div class="modal-header"><h5>📚 画风词库</h5><button class="header-btn-sm" onclick="this.closest(\'#s2StylePicker\').remove()">&times;</button></div>';
        h += '<div class="modal-body">';
        for (var ci = 0; ci < categories.length; ci++) {
            var cat = categories[ci];
            h += '<div class="s2-style-category" style="margin-bottom:16px;">';
            h += '<div class="s2-style-cat-title" style="font-weight:600;font-size:14px;margin-bottom:8px;">' + cat.icon + ' ' + cat.name + '</div>';
            h += '<div style="display:flex;flex-wrap:wrap;gap:6px;">';
            for (var si = 0; si < cat.styles.length; si++) {
                var st = cat.styles[si];
                h += '<span class="s2-style-chip" data-prompt="' + App._escape(st.prompt) + '" onclick="App.seedanceV2._selectStyle(\'' + App._escape(st.prompt) + '&quot;,&quot;' + App._escape(st.name) + '\')" style="cursor:pointer;padding:4px 10px;border-radius:12px;border:1px solid var(--border-color,#d1d5db);font-size:12px;background:var(--bg-card,#fff);">' + st.name + '</span>';
            }
            h += '</div></div>';
        }
        h += '</div></div>';
        overlay.innerHTML = h;
        document.body.appendChild(overlay);
    };

    App.seedanceV2._selectStyle = function(prompt, name) {
        var inp = document.getElementById('s2_global_style');
        if (inp) {
            inp.value = prompt;
            App.seedanceV2.setDirty();
            App.seedanceV2.compose();
        }
        var picker = document.getElementById('s2StylePicker');
        if (picker) picker.remove();
        App.showToast('已选择画风: ' + name, 'success');
    };

    // ============ 负面提示词选取器 ============
    App.seedanceV2._negativeData = null;
    App.seedanceV2.openNegativePicker = async function() {
        if (!this._negativeData) {
            var d = await App.fetchJSON('/api/seedance/negative-prompts');
            if (d && d.categories) this._negativeData = d.categories;
        }
        var categories = this._negativeData || [];
        var overlay = document.createElement('div');
        overlay.id = 's2NegativePicker';
        overlay.className = 'modal-overlay';
        overlay.style.cssText = 'display:flex;z-index:800;background:rgba(0,0,0,0.5);align-items:center;justify-content:center;';
        overlay.onclick = function(e) { if (e.target === this) this.remove(); };
        var h = '<div class="modal-content" style="max-width:700px;max-height:80vh;overflow-y:auto;">';
        h += '<div class="modal-header"><h5>🚫 负面提示词词库</h5><button class="header-btn-sm" onclick="this.closest(\'#s2NegativePicker\').remove()">&times;</button></div>';
        h += '<div class="modal-body">';
        h += '<p style="font-size:12px;color:var(--text-muted);margin-bottom:12px;">点击条目将完整提示词追加到负面提示词输入框中</p>';
        for (var ci = 0; ci < categories.length; ci++) {
            var cat = categories[ci];
            h += '<div class="s2-style-category" style="margin-bottom:16px;">';
            h += '<div class="s2-style-cat-title" style="font-weight:600;font-size:14px;margin-bottom:8px;">' + cat.icon + ' ' + cat.name + '</div>';
            h += '<div style="display:flex;flex-wrap:wrap;gap:6px;">';
            for (var si = 0; si < cat.items.length; si++) {
                var it = cat.items[si];
                h += '<span class="s2-style-chip" onclick="App.seedanceV2._selectNegative(\'' + App._escape(it.prompt) + '&quot;,&quot;' + App._escape(it.name) + '\')" style="cursor:pointer;padding:4px 10px;border-radius:12px;border:1px solid var(--border-color,#d1d5db);font-size:12px;background:var(--bg-card,#fff);">' + it.name + '</span>';
            }
            h += '</div></div>';
        }
        h += '</div></div>';
        overlay.innerHTML = h;
        document.body.appendChild(overlay);
    };

    App.seedanceV2._selectNegative = function(prompt, name) {
        var inp = document.getElementById('s2_negative_prompt');
        if (inp) {
            if (inp.value.trim()) {
                inp.value = inp.value.trim() + ', ' + prompt;
            } else {
                inp.value = prompt;
            }
            App.seedanceV2.setDirty();
            App.seedanceV2.compose();
        }
        var picker = document.getElementById('s2NegativePicker');
        if (picker) picker.remove();
        App.showToast('已添加负面词: ' + name, 'success');
    };

    // ============ 全局画风/负面词卡选取器 ============
    App.seedanceV2._globalPickerTarget = '';
    App.seedanceV2._globalPickerIsNeg = false;

    App.seedanceV2._openGlobalGroupPicker = async function(groupId) {
        var isNegative = groupId === 89;
        var targetInputId = isNegative ? 's2_negative_prompt' : 's2_global_style';
        this._globalPickerTarget = targetInputId;
        this._globalPickerIsNeg = isNegative;

        var d = await App.fetchJSON('/api/seedance/v2/libraries/' + groupId + '/cards?page_size=200');
        var cards = (d && d.items) ? d.items : [];
        if (!cards.length) { App.showToast('该词库暂无词条', 'warning'); return; }

        var overlay = document.createElement('div');
        overlay.id = '_s2GlobalPicker';
        overlay.className = 'modal-overlay';
        overlay.style.cssText = 'display:flex;z-index:800;background:rgba(0,0,0,0.5);align-items:center;justify-content:center;';
        overlay.onclick = function(e) { if (e.target === this) this.remove(); };

        var h = '<div class="modal-content" style="max-width:600px;max-height:70vh;overflow-y:auto;" onclick="event.stopPropagation()">';
        h += '<div class="modal-header"><h5>' + (isNegative ? '| 负面提示词' : '| 全局画风') + '</h5><button class="header-btn-sm" onclick="this.closest(&apos;.modal-overlay&apos;).remove()">&times;</button></div>';
        h += '<div class="modal-body">';
        h += '<input class="s2-input mb-2" placeholder="搜索..." oninput="App.seedanceV2._filterGlobalCards(this.value)">';
        h += '<div style="display:flex;flex-wrap:wrap;gap:6px;" id="_s2GlobalCardGrid">';
        for (var i = 0; i < cards.length; i++) {
            var card = cards[i];
            var word = card.word_text || card.content || '';
            h += '<span class="s2-style-chip" style="padding:4px 10px;border-radius:12px;border:1px solid var(--border-color);font-size:12px;background:var(--bg-card);">' + App._escape(word) + '</span>';
        }
        h += '</div></div></div>';
        overlay.innerHTML = h;

        var chips = overlay.querySelectorAll('.s2-style-chip');
        for (var j = 0; j < chips.length; j++) {
            (function(chip) {
                var txt = chip.textContent;
                chip.style.cursor = 'pointer';
                chip.onmouseover = function() { this.style.borderColor = 'var(--primary)'; this.style.background = 'rgba(16,185,129,0.06)'; };
                chip.onmouseout = function() { this.style.borderColor = 'var(--border-color)'; this.style.background = 'var(--bg-card)'; };
                chip.onclick = function() { App.seedanceV2._pickGlobalWord(txt); };
            })(chips[j]);
        }

        document.body.appendChild(overlay);
    };

    App.seedanceV2._filterGlobalCards = function(query) {
        var chips = document.querySelectorAll('#_s2GlobalCardGrid .s2-style-chip');
        var q = (query || '').toLowerCase();
        for (var i = 0; i < chips.length; i++) {
            chips[i].style.display = (!q || (chips[i].textContent || '').toLowerCase().indexOf(q) >= 0) ? '' : 'none';
        }
    };

    App.seedanceV2._pickGlobalWord = function(word) {
        var inp = document.getElementById(App.seedanceV2._globalPickerTarget);
        if (inp) {
            if (App.seedanceV2._globalPickerIsNeg) {
                if (inp.value.trim()) {
                    inp.value = inp.value.trim() + ', ' + word;
                } else {
                    inp.value = word;
                }
            } else {
                inp.value = word;
            }
            App.seedanceV2.setDirty();
            App.seedanceV2._debouncedCompose();
        }
        var picker = document.getElementById('_s2GlobalPicker');
        if (picker && picker.parentNode) picker.parentNode.removeChild(picker);
    };

App.seedanceV2.closePicker=async function(){var p=document.getElementById('s2CardPicker');if(p)p.style.display='none';if(this.currentProjectId){await this.openProject(this.currentProjectId);this.compose();}};
    App.seedanceV2.openCardPicker=async function(sid,f){this.activeSceneId=sid;this.activeField=f;var lib=this.getLibraryByKey(f)||this.getLibraryByKey(this._fieldToDim[f]);if(!lib&&f&&f.startsWith&&f.startsWith('custom_')){for(var li=0;li<this.libraries.length;li++){if(this.libraries[li].dimension_key===f){lib=this.libraries[li];break;}}}if(!lib){App.showToast('未找到词库: '+f,'error');return;}// 优先使用右侧面板
        var panel = document.getElementById('s2RightPanel');
        if (panel) { this._openRightPicker(sid, f); return; }
        // 兜底：Modal 方式
        var o=document.getElementById('s2CardPicker');if(!o)return;o.style.display='block';document.getElementById('s2PickerTitle').textContent=App._t('auto.str_59ebdb8c', '✏️ 镜头')+this._getSceneOrder(sid)+' - '+lib.dimension_name;document.getElementById('s2PickerSearch').value='';document.getElementById('s2PickerSearch').focus();this.activePickerLibId=lib.id;this.renderPickerLibTabs(lib.id);await this.loadCards(lib.id);this.renderCards(lib.id);};
    App.seedanceV2.renderCards=function(libId){var c=document.getElementById('s2PickerCards');var cards=this.cardCache[libId]||[];var search=(document.getElementById('s2PickerSearch').value||'').toLowerCase();var lib=this.getLibraryById(libId);var scene=this._getCurrentScene();var currentVal='';if(lib&&scene){var fk=this._dimToFieldKey(lib.dimension_key);currentVal=(scene[fk]||'').trim();}var filtered=search?cards.filter(function(card){return card.word_text.toLowerCase().indexOf(search)>=0||(card.definition&&card.definition.toLowerCase().indexOf(search)>=0);}):cards;if(!filtered.length&&!search){c.innerHTML='<div class=\"s2-picker-empty\">暂无词条</div>';}else if(!filtered.length&&search){c.innerHTML='<div class=\"s2-picker-empty\">无匹配词条</div>';}if(filtered.length){var h='';for(var i=0;i<filtered.length;i++){var card=filtered[i];var sel=this._textMatches(currentVal,card.word_text)?' s2-picker-card-selected':'';h+='<div class=\"s2-picker-card'+sel+'\" onclick=\"App.seedanceV2.selectCard('+card.id+')\"><div class=\"s2-picker-word\">'+App._escape(card.word_text)+(sel?' <span class=\"sp-selected-badge\">\u2713 已选</span>':'')+'</div>'+(card.definition?'<div class=\"s2-picker-def\">'+App._escape(card.definition)+'</div>':'')+'<div class=\"s2-picker-usage\">使用 '+(card.usage_count||0)+' 次</div></div>';}c.innerHTML=h;}if(lib&&lib.category==='custom'){var addHtml='<div class=\"s2-picker-custom-add\"><input id=\"s2CustomWordInput_'+libId+'\" class=\"modal-input\" placeholder=\"输入自定义词条...\" style=\"flex:1;margin:0;font-size:13px;\"><input id=\"s2CustomWordDef_'+libId+'\" class=\"modal-input\" placeholder=\"释义(可选)\" style=\"flex:1;margin:0;font-size:13px;\"><button class=\"btn btn-sm btn-primary\" onclick=\"App.seedanceV2.onCustomLibAddWord('+libId+')\" style=\"white-space:nowrap;\">＋ 添加</button></div>';c.insertAdjacentHTML('beforeend',addHtml);}c.insertAdjacentHTML('beforeend','<div class=\"s2-picker-custom\" onclick=\"App.seedanceV2.customInput()\">\u270f\ufe0f 手动输入...</div>');};App.seedanceV2.selectCard=async function(cardId){var d=await App.fetchJSON('/api/seedance/v2/cards/'+cardId);if(!d||!d.card)return;var currentVal='';var scene=this._getCurrentScene();if(scene)currentVal=(scene[this.activeField]||'').trim();var cardValue=d.card.definition&&d.card.definition.trim()?d.card.definition:d.card.word_text;var displayName=d.card.word_text;var isSame=this._textMatches(currentVal,cardValue)||(cardValue!==d.card.word_text&&this._textMatches(currentVal,d.card.word_text));if(isSame){await this.updateSceneField(this.activeSceneId,this.activeField,'');await this.openProject(this.currentProjectId);this.renderPickerLibTabs(this.activePickerLibId);this.renderCards(this.activePickerLibId);App.showToast(App._t('auto.str_07b0321b', '已取消: ')+displayName,'info');}else{await this.updateSceneField(this.activeSceneId,this.activeField,cardValue);await this.openProject(this.currentProjectId);this.renderPickerLibTabs(this.activePickerLibId);this.renderCards(this.activePickerLibId);App.showToast('已选择: '+displayName,'success');}};
    App.seedanceV2.customInput=function(){var f=this.activeField;var lib=this.getLibraryByKey(f);var v=prompt(App._t('auto.str_e8fde74e', '输入自定义 ')+(lib?lib.dimension_name:f)+' 描述:');if(!v||!v.trim())return;var self=this;var fu=function(){if(lib)App.fetchJSON('/api/seedance/v2/custom-words',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({library_id:lib.id,word_text:v.trim()})});self.updateSceneField(self.activeSceneId,f,v.trim()).then(function(){return self.openProject(self.currentProjectId);}).then(function(){self.renderPickerLibTabs(self.activePickerLibId);self.renderCards(self.activePickerLibId);App.showToast('已设定: '+v.trim(),'success');});};fu();};

    // 拼接引擎（含300ms防抖，避免高频输入时重复计算）
console.log('[PK] seedance_pickers loaded');
})();
