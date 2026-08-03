/**
 * seedance_media_cards.js - 词卡缩略图管理（从 seedance_v2_composer.js 拆出）
 */
(function() {
'use strict';
if (!App.seedanceV2 || App.seedanceV2._uploadWordCardThumb) return;
    // ============ 词卡缩略图 ============
    App.seedanceV2._uploadWordCardThumb=async function(cardId,file){
        var fd=new FormData();fd.append('file',file);
        try{
            var r=await fetch('/api/seedance/v2/cards/'+cardId+'/thumbnail',{method:'POST',body:fd});
            var d=await r.json();
            if(d&&d.ok){
                var lib=App.seedanceV2.getLibraryById(App.seedanceV2.activePickerLibId);
                if(lib){delete App.seedanceV2.cardCache[lib.id];await App.seedanceV2.loadCards(lib.id);
                App.seedanceV2._renderRightPickerContent(lib);}
                App.showToast(App._t('auto.str_1c0c1c36', '缩略图已保存'),'success');
            }else{App.showToast(App._t('auto.upload_失败', '上传未完成'),'error');}
        }catch(e){App.showToast(App._t('auto.upload_异常__', '上传异常: ')+e.message,'error');}
    };
    App.seedanceV2._setupWordCardDropZones=function(){
        var self=this;
        document.querySelectorAll('.s2-card-thumb-zone').forEach(function(z){
            if(z.dataset.dropBound)return;z.dataset.dropBound='1';
            // 拖入上传
            z.addEventListener('dragover',function(e){e.preventDefault();e.stopPropagation();
                this.style.background='rgba(16,185,129,0.12)';this.style.border='1px dashed #10b981';});
            z.addEventListener('dragleave',function(e){this.style.background='';this.style.border='';});
            z.addEventListener('drop',function(e){e.preventDefault();e.stopPropagation();
                this.style.background='';this.style.border='';
                var cid=parseInt(this.dataset.cardId);
                if(!cid||!e.dataTransfer.files||!e.dataTransfer.files.length)return;
                var files=Array.from(e.dataTransfer.files).filter(function(f){return f.type.startsWith('image/')||f.type.startsWith('video/');});
                if(!files.length)return;
                var allCards=document.querySelectorAll('.s2-card-thumb-zone');
                var startIdx=-1;
                for(var ai=0;ai<allCards.length;ai++){if(parseInt(allCards[ai].dataset.cardId)===cid){startIdx=ai;break;}}
                for(var fi=0;fi<files.length;fi++){
                    var targetCard=cid;
                    if(startIdx>=0&&fi>0){
                        var nextCard=allCards[startIdx+fi];
                        if(nextCard)targetCard=parseInt(nextCard.dataset.cardId);
                    }
                    self._dispatchUpload(targetCard,files[fi]);
                }
                if(files.length>1)App.showToast(files.length+App._t('auto.str_11d3c3dd', ' 个文件正在上传'),'info');
            });
            // 点击上传：由+占位符自身处理，不影响其他元素点击
            // 右键菜单：所有卡片均支持 预览选择 / 替换预览 / 移除预览
            z.addEventListener('contextmenu',function(e){
                e.preventDefault();e.stopPropagation();
                var cid=parseInt(this.dataset.cardId);
                self._showThumbContextMenu(cid,e.clientX,e.clientY,this);
            });
        });
        // 全局粘贴监听：在右侧面板打开时Ctrl+V可直接粘贴到当前活跃镜头词库
        if(!document.getElementById('s2RightPanel').dataset.pasteBound){
            document.getElementById('s2RightPanel').dataset.pasteBound='1';
            document.addEventListener('paste',function(e){
                var panel=document.getElementById('s2RightPanel');
                if(!panel||!panel.classList.contains('open'))return;
                var items=e.clipboardData&&e.clipboardData.items;
                if(!items)return;
                for(var i=0;i<items.length;i++){
                    if(items[i].type.startsWith('image/')||items[i].type.startsWith('video/')){
                        e.preventDefault();
                        var f=items[i].getAsFile();
                        if(!f)continue;
                        // 粘贴到当前活跃面板中第一个词卡（用户可通过悬停指示目标）
                        var targetCard=self.activePickerLibId?self._getFirstVisibleWordCard():null;
                        if(targetCard){
                            self._dispatchUpload(targetCard,f);
                            App.showToast(App._t('auto.str_3da56a85', '已粘贴到词卡预览'),'success');
                        }
                        break;
                    }
                }
            });
        }
    };
    // 打开文件选择器为词卡添加预览（由+占位符onclick调用）
    App.seedanceV2._pickFileForCard=function(cardId){
        var inp=document.createElement('input');inp.type='file';
        inp.accept='image/*,video/mp4,video/webm,video/mov';
        inp.onchange=function(ev){
            var f=ev.target.files[0];
            if(!f)return;
            App.seedanceV2._dispatchUpload(cardId,f);
        };
        inp.click();
    };
    // 统一上传分发：根据文件类型路由到图片或视频上传
    App.seedanceV2._dispatchUpload=function(cardId,file){
        if(!file)return;
        if(file.type.startsWith('video/')){this._uploadWordCardVideo(cardId,file);}
        else if(file.type.startsWith('image/')){this._uploadWordCardThumb(cardId,file);}
        else{App.showToast(App._t('auto.str_e56690fe', '仅支持图片和视频文件'),'warning');}
    };
    // 获取面板中第一个可见的词卡ID（用于Ctrl+V粘贴目标）
    App.seedanceV2._getFirstVisibleWordCard=function(){
        var items=document.querySelectorAll('.s2-right-card-item');
        for(var i=0;i<items.length;i++){
            if(items[i].style.display!=='none'&&items[i].dataset.cardId){
                return parseInt(items[i].dataset.cardId);
            }
        }
        // fallback: 第一个缩略图区
        var z=document.querySelector('.s2-card-thumb-zone');
        return z?parseInt(z.dataset.cardId):null;
    };
    // 右键菜单：预览选择/替换预览/移除预览
    App.seedanceV2._showThumbContextMenu=function(cardId,x,y,zoneEl){
        var self=this;
        // 如果没有传入 zoneEl，通过 cardId 查找
        if(!zoneEl){
            zoneEl=document.querySelector('.s2-card-thumb-zone[data-card-id="'+cardId+'"]');
        }
        var old=document.getElementById('s2ThumbCtxMenu');
        if(old)old.remove();
        var isDark=document.documentElement.classList.contains('dark')||document.body.classList.contains('dark-theme');
        var menu=document.createElement('div');menu.id='s2ThumbCtxMenu';
        menu.style.cssText='position:fixed;z-index:9999;left:'+x+'px;top:'+y+'px;'
            +(isDark?'background:#1e293b;border:1px solid #334155;color:#e2e8f0;':'background:#fff;border:1px solid #e2e8f0;color:#1e293b;')
            +'border-radius:8px;box-shadow:0 4px 20px rgba(0,0,0,0.25);padding:4px;min-width:140px;font-size:13px;';
        menu.innerHTML=
            '<div style="padding:7px 12px;cursor:pointer;border-radius:5px;font-weight:600;color:'+(isDark?'#38bdf8':'#0ea5e9')+';" onmouseover="this.style.background=\''+(isDark?'#334155':'#f1f5f9')+'\'" onmouseout="this.style.background=\'\'" onclick="App.seedanceV2._openMediaLibrary('+cardId+');document.getElementById(\'s2ThumbCtxMenu\').remove()">预览选择</div>'
            +'<div style="padding:7px 12px;cursor:pointer;border-radius:5px;" onmouseover="this.style.background=\''+(isDark?'#334155':'#f1f5f9')+'\'" onmouseout="this.style.background=\'\'" onclick="App.seedanceV2._replaceThumb('+cardId+');document.getElementById(\'s2ThumbCtxMenu\').remove()">替换预览</div>'
            +'<div style="padding:7px 12px;cursor:pointer;border-radius:5px;" onmouseover="this.style.background=\''+(isDark?'#334155':'#f1f5f9')+'\'" onmouseout="this.style.background=\'\'" onclick="App.seedanceV2._deleteThumb('+cardId+');document.getElementById(\'s2ThumbCtxMenu\').remove()">移除预览</div>';
        document.body.appendChild(menu);
        setTimeout(function(){
            document.addEventListener('click',function h(){var m=document.getElementById('s2ThumbCtxMenu');if(m)m.remove();document.removeEventListener('click',h);});
        },50);
    };
    // 替换预览：打开文件选择器
    App.seedanceV2._replaceThumb=function(cardId){
        var inp=document.createElement('input');inp.type='file';inp.accept='image/*,video/mp4,video/webm,video/mov';
        inp.onchange=function(e){var f=e.target.files[0];if(f)App.seedanceV2._dispatchUpload(cardId,f);};
        inp.click();
    };
    // 移除预览：同时删除缩略图和视频
    App.seedanceV2._deleteThumb=async function(cardId){
        var lib=App.seedanceV2.getLibraryById(App.seedanceV2.activePickerLibId);
        // 2026-08-03 加固: 破坏性操作二次确认（此前误删导致 #1097-#1104 缩略图字段清空）
        if(!confirm('确认移除该词卡的缩略图与视频预览？\n（文件仍保留，仅清除引用，可重新上传）'))return;
        try{
            await fetch('/api/seedance/v2/cards/'+cardId+'/thumbnail',{method:'DELETE'});
            await fetch('/api/seedance/v2/cards/'+cardId+'/video',{method:'DELETE'});
        }catch(e){ App.showToast('移除请求未响应: '+e.message,'error'); return; }
        if(lib){delete App.seedanceV2.cardCache[lib.id];await App.seedanceV2.loadCards(lib.id);
        App.seedanceV2._renderRightPickerContent(lib);}
        App.showToast('预览已移除','info');
    };
    // 从媒体资产管理库选取预览 — 接受 cardId 参数精准定位目标词卡
    App.seedanceV2._openMediaLibrary=function(cardId){
        if (!cardId) {
            App.showToast('请右键点击目标词卡的缩略图区域，选择「预览选择」','warning');
            return;
        }
        var old=document.getElementById('s2MediaLibModal');
        if(old)old.remove();
        var overlay=document.createElement('div');overlay.id='s2MediaLibModal';
        overlay.className='modal-overlay';
        overlay.style.cssText='display:flex;z-index:900;background:rgba(0,0,0,0.5);align-items:center;justify-content:center;';
        overlay.onclick=function(e){if(e.target===this)this.style.display='none';};
        overlay.innerHTML='<div class="modal-content" style="max-width:680px;max-height:85vh;">'+
            '<div class="modal-header"><h5>📂 预览选择 — 从媒体库选取</h5><span style="font-size:11px;color:var(--text-muted);margin-left:12px;">→ 目标: #'+cardId+'</span><button class="header-btn-sm" onclick="document.getElementById(\'s2MediaLibModal\').style.display=\'none\'">✕</button></div>'+
            '<div style="display:flex;gap:0;padding:0 16px;border-bottom:1px solid var(--border-color);">'+
            '<button id="s2MediaTabImg" class="_s2MediaTab active" onclick="App.seedanceV2._switchMediaTab(\'image\')" style="padding:6px 16px;border:none;background:none;cursor:pointer;font-size:13px;border-bottom:2px solid var(--primary,#6366f1);color:var(--primary,#6366f1);font-weight:600;">图片库</button>'+
            '<button id="s2MediaTabVid" class="_s2MediaTab" onclick="App.seedanceV2._switchMediaTab(\'video\')" style="padding:6px 16px;border:none;background:none;cursor:pointer;font-size:13px;border-bottom:2px solid transparent;color:var(--text-muted);">视频库</button>'+
            '</div>'+
            '<div class="modal-body" style="max-height:55vh;overflow-y:auto;"><div id="s2MediaLibGrid" style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;"><div class="loading-spinner"><div class="spinner-border spinner-border-sm"></div></div></div></div>'+
            '<div class="modal-footer"><button class="btn btn-sm btn-secondary" onclick="document.getElementById(\'s2MediaLibModal\').style.display=\'none\'">取消</button></div></div>';
        document.body.appendChild(overlay);
        overlay.dataset.targetCardId = cardId;
        App.seedanceV2._activeMediaTab = 'image';
        App.seedanceV2._loadImageLib();
    };
    // Tab 切换
    App.seedanceV2._switchMediaTab=function(type){
        this._activeMediaTab = type;
        document.querySelectorAll('._s2MediaTab').forEach(function(b){
            b.style.borderBottom='2px solid transparent';b.style.color='var(--text-muted)';b.style.fontWeight='normal';b.classList.remove('active');
        });
        var btn=document.getElementById(type==='image'?'s2MediaTabImg':'s2MediaTabVid');
        if(btn){btn.style.borderBottom='2px solid var(--primary,#6366f1)';btn.style.color='var(--primary,#6366f1)';btn.style.fontWeight='600';btn.classList.add('active');}
        var grid=document.getElementById('s2MediaLibGrid');
        if(grid)grid.innerHTML='<div class="loading-spinner"><div class="spinner-border spinner-border-sm"></div></div>';
        if(type==='image')this._loadImageLib();
        else this._loadVideoLib();
    };
    // 图片库
    App.seedanceV2._loadImageLib=async function(){
        var grid=document.getElementById('s2MediaLibGrid');
        if(!grid)return;
        try{
            var d=await App.fetchJSON('/api/thumbnails/library?page_size=120');
            if(!d||!d.items){grid.innerHTML='<div style="text-align:center;padding:20px;color:var(--text-muted);">图片库为空</div>';return;}
            var h='';
            for(var i=0;i<d.items.length;i++){
                var item=d.items[i];
                h+='<div style="border:1px solid var(--border-color);border-radius:6px;overflow:hidden;cursor:pointer;transition:0.12s;" onclick="App.seedanceV2._pickFromMediaLib(\''+(item.filename||'')+'\')" onmouseover="this.style.borderColor=\''+('var(--primary,#6366f1)')+'\'" onmouseout="this.style.borderColor=\''+('var(--border-color)')+'\'">';
                h+='<div style="width:100%;height:100px;background:var(--bg-muted,#f1f5f9);display:flex;align-items:center;justify-content:center;">';
                if(item.url){h+='<img src="'+item.url+'" style="width:100%;height:100%;object-fit:cover;" loading="lazy">';}
                else{h+='<span style="font-size:10px;color:var(--text-muted);">无预览</span>';}
                h+='</div><div style="padding:4px 6px;font-size:10px;color:var(--text-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">'+(item.original_name||item.filename||'').substring(0,18)+'</div>';
                h+='</div>';
            }
            grid.innerHTML=h||'<div style="grid-column:1/-1;text-align:center;padding:20px;color:var(--text-muted);">暂无图片资产</div>';
        }catch(e){grid.innerHTML='<div style="text-align:center;padding:20px;color:var(--danger);">加载未完成</div>';}
    };
    // 视频库
    App.seedanceV2._loadVideoLib=async function(){
        var grid=document.getElementById('s2MediaLibGrid');
        if(!grid)return;
        try{
            var d=await App.fetchJSON('/api/thumbnails/video-library?page_size=120');
            if(!d||!d.items){grid.innerHTML='<div style="text-align:center;padding:20px;color:var(--text-muted);">视频库为空</div>';return;}
            var h='';
            for(var i=0;i<d.items.length;i++){
                var item=d.items[i];
                var cover=item.cover_url||'';
                var dur=item.duration?Math.round(item.duration)+'s':'';
                h+='<div style="border:1px solid var(--border-color);border-radius:6px;overflow:hidden;cursor:pointer;transition:0.12s;position:relative;" onclick="App.seedanceV2._pickFromVideoLib(this,\''+(item.filename||'')+'\')" onmouseover="this.style.borderColor=\''+('var(--primary,#6366f1)')+'\'" onmouseout="this.style.borderColor=\''+('var(--border-color)')+'\'">';
                h+='<div style="width:100%;height:100px;background:var(--bg-muted,#1e1e1e);display:flex;align-items:center;justify-content:center;position:relative;">';
                if(cover){h+='<img src="'+cover+'" style="width:100%;height:100%;object-fit:cover;" loading="lazy">';}
                h+='<span style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:28px;color:rgba(255,255,255,0.7);pointer-events:none;text-shadow:0 1px 3px rgba(0,0,0,0.5);">▶</span>';
                if(dur)h+='<span style="position:absolute;bottom:2px;right:2px;background:rgba(0,0,0,0.7);color:#fff;font-size:9px;padding:0 3px;border-radius:2px;">'+dur+'</span>';
                h+='</div></div>';
            }
            grid.innerHTML=h||'<div style="grid-column:1/-1;text-align:center;padding:20px;color:var(--text-muted);">暂无视频资产</div>';
        }catch(e){grid.innerHTML='<div style="text-align:center;padding:20px;color:var(--danger);">加载未完成</div>';}
    };
    // 从视频库选取
    App.seedanceV2._pickFromVideoLib=async function(el,filename){
        if(el._picking)return;
        el._picking=true;
        var overlay=document.getElementById('s2MediaLibModal');
        var targetCardId=overlay?parseInt(overlay.dataset.targetCardId):null;
        if(overlay)overlay.style.display='none';
        try{
            if(!targetCardId){App.showToast('未找到目标词卡','warning');return;}
            var d=await App.fetchJSON('/api/seedance/v2/cards/'+targetCardId+'/video-from-library',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({source_filename:filename})});
            if(d&&d.ok){
                var lib=App.seedanceV2.getLibraryById(App.seedanceV2.activePickerLibId);
                if(lib){delete App.seedanceV2.cardCache[lib.id];await App.seedanceV2.loadCards(lib.id);App.seedanceV2._renderRightPickerContent(lib);}
                App.showToast('视频已关联到词卡预览','success');
            }else{App.showToast('暂未关联成功: '+(d&&d.error?d.error:'未知'),'error');}
        }catch(e){App.showToast('视频选取未完成: '+e.message,'error');}
        el._picking=false;
    };
    // 从媒体库选取后：下载缩略图→上传到指定词卡（从overlay.dataset获取targetCardId）
    App.seedanceV2._pickFromMediaLib=async function(filename){
        var overlay=document.getElementById('s2MediaLibModal');
        if(overlay)overlay.style.display='none';
        if(!filename)return;
        try{
            var resp=await fetch('/api/thumbnails/file/'+filename);
            if(!resp.ok){App.showToast(App._t('auto.str_5d4350ae', '获取文件未完成'),'error');return;}
            var blob=await resp.blob();
            var file=new File([blob],filename,{type:blob.type||'image/jpeg'});
            // 优先使用弹窗指定的目标词卡ID，fallback 到第一个可见词卡
            var targetId=parseInt(overlay.dataset.targetCardId)||App.seedanceV2._getFirstVisibleWordCard();
            if(!targetId){App.showToast(App._t('auto.str_6c2f0229', '未找到目标词卡'),'warning');return;}
            // 获取目标词卡名称用于反馈
            var targetWord='';
            var lib=App.seedanceV2.getLibraryById(App.seedanceV2.activePickerLibId);
            var cards=lib?App.seedanceV2.cardCache[lib.id]:null;
            if(cards){for(var ci=0;ci<cards.length;ci++){if(cards[ci].id===targetId){targetWord=cards[ci].word_text||'';break;}}}
            // 高亮目标词卡缩略图区
            var targetZone=document.querySelector('.s2-card-thumb-zone[data-card-id="'+targetId+'"]');
            if(targetZone){
                targetZone.style.transition='0.15s';
                targetZone.style.boxShadow='0 0 0 3px #10b981';
                targetZone.style.borderColor='#10b981';
                setTimeout(function(){targetZone.style.boxShadow='';targetZone.style.borderColor='';},1500);
            }
            App.seedanceV2._dispatchUpload(targetId,file);
            App.showToast('已添加预览到: '+(targetWord||App._t('auto.str_5ac02b19', '词卡#')+targetId),'success');
        }catch(e){App.showToast('选取未完成: '+e.message,'error');}
    };
console.log('[PK] seedance_media_cards loaded');
})();
