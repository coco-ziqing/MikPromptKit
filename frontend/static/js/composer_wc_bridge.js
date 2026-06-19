// v4.1.0: Composer Word Card Bridge — 组装器右面板接入统一词卡
(function(){'use strict';if(!App.seedanceV2)return;
(function r(){if(!App.seedanceV2.libraries){setTimeout(r,200);return;}else if(App.seedanceV2.libraries.length===0){setTimeout(r,500);return;}_go();})();

function _go(){var S=App.seedanceV2;

// 1. 分组加载 — 保留原始 dim↔field 映射不变
S.__origLL=S.loadLibraries;
S.loadLibraries=async function(){
try{var d=await App.fetchJSON('/api/v4/word-cards/groups');if(d&&d.groups){
var L=[];for(var i=0;i<d.groups.length;i++){var g=d.groups[i];L.push({id:g.id,dimension_key:g.key,dimension_name:g.name,category:g.type==='seedance'?'extended':(g.type==='builtin'?'basic':'custom'),sort_order:i,card_count:g.card_count,description:g.description||'',_is_word_card:true});}
this.libraries=L;return;}}catch(e){console.log('[WC] loadLibraries fallback',e);}return S.__origLL.call(this);};

// 2. 词卡加载
S.__origLC=S.loadCards;
S.loadCards=async function(libId){if(this.cardCache[libId])return;
try{var d=await App.fetchJSON('/api/v4/word-cards?group_id='+libId+'&page_size=200');if(d&&d.items){var C=[];for(var i=0;i<d.items.length;i++){var c=d.items[i];C.push({id:c.id,word_text:c.content||'',definition:c.meaning||'',preview_image:c.thumbnail||'',preview_video:c.preview_media||'',is_system:c.is_builtin?1:0,usage_count:c.usage_count||0,heat_weight:c.heat_weight||0});}this.cardCache[libId]=C;return;}}catch(e){}return S.__origLC.call(this,libId);};

// 3. 选取词卡
S.__origPW=S._pickRightWord;
S._pickRightWord=function(el){var cid=parseInt(el.getAttribute('data-card-id')),w=el.dataset.word;if(!w||!S.activeSceneId)return;if(!S.activeField){App.showToast('请先点击镜头字段','warning');return;}var sc=S._getCurrentScene();if(!sc)return;
if(cid&&S.activeSceneId){App.fetchJSON('/api/v4/word-cards/picker/link',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({scene_id:S.activeSceneId,card_id:cid})}).catch(function(){});}
var cv=(sc[S.activeField]||'').trim(),isC=cv.indexOf(',')>=0||cv.length<=20;
if(isC&&cv.indexOf(w)>=0)cv=cv.replace(w,'').replace(/,\s*,/g,',').replace(/^,|,$/g,'').trim();
else if(isC&&cv)cv=cv+', '+w;else cv=w;
sc[S.activeField]=cv;S.updateSceneField(S.activeSceneId,S.activeField,cv);S._refreshRightSelection();S.compose();};

// 4. 添加词条
S.__origAP=S._addPanelWord;
S._addPanelWord=async function(libId){var wi=document.getElementById('s2PanelWordInput'),di=document.getElementById('s2PanelWordDef'),w=(wi?wi.value:'').trim();if(!w){App.showToast('请输入词条','warning');return;}var def=di?(di.value||'').trim():'';try{var d=await App.fetchJSON('/api/v4/word-cards',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({content:w,meaning:def,name:w.substring(0,60),group_id:libId,module:'custom',source:'composer_add'})});if(d&&d.ok){if(wi)wi.value='';if(di)di.value='';delete S.cardCache[libId];await S.loadCards(libId);var l=S.getLibraryById(libId);if(l)S._renderRightPickerContent(l);App.showToast('已添加','success');}}catch(e){App.showToast('添加失败:'+e.message,'error');}};

// 5. 高亮刷新
S._refreshRightSelection=function(){var sc=S._getCurrentScene(),fv=sc?(sc[S.activeField]||''):'';document.querySelectorAll('.s2-right-card-item').forEach(function(el){var w=el.dataset.word||'',s=fv&&w&&fv.indexOf(w)>=0;el.classList.toggle('selected',s);el.style.background=s?'rgba(16,185,129,0.08)':'';el.style.borderColor=s?'#10b981':'var(--border-color)';});S.renderScenes();};

// 6. 打开选取面板 — 与原始逻辑完全一致的field→dimKey→手动循环
S.__origORP=S._openRightPicker;
S._openRightPicker=function(sid,field){
    S.activeSceneId=sid;
    var isCustomKey=field&&typeof field==='string'&&field.startsWith&&field.startsWith('custom_');
    if(!isCustomKey)S.activeField=field;
    var panel=document.getElementById('s2RightPanel');
    if(!panel)return;
    if(panel.classList.contains('collapsed'))S.toggleRightPanel();

    // dimKey: 与原始代码完全一致 — 先用 _fieldToDim 映射，没有就原值
    var dimKey=S._fieldToDim&&S._fieldToDim[field]?S._fieldToDim[field]:field;

    // 手动循环匹配（与原始代码一致）
    var foundLib=null;
    for(var i=0;i<S.libraries.length;i++){
        var lib=S.libraries[i];
        if(lib.dimension_key===dimKey||lib.dimension_key===field){foundLib=lib;break;}
    }
    if(!foundLib){App.showToast('未找到词库: '+field,'warning');return;}
    S.activePickerLibId=foundLib.id;
    S._renderRightPickerContent(foundLib);
};

// 7. 预加载
S.preloadAllCardCaches=async function(){var L=this.libraries||[];for(var i=0;i<Math.min(L.length,10);i++){var lid=L[i].id;if(this.cardCache[lid])continue;try{await this.loadCards(lid);}catch(e){}}};

// 8. 渲染标注+双击编辑
S.__origRRC=S._renderRightPickerContent;
S._renderRightPickerContent=function(lib){S.__origRRC.call(this,lib);var t=document.querySelector('.s2-panel-toolbar');if(t&&!t.querySelector('.wc-indicator')){var ind=document.createElement('span');ind.className='wc-indicator';ind.style.cssText='font-size:9px;color:var(--primary);margin-left:4px;opacity:0.5;';ind.textContent='🔄 统一词卡';t.appendChild(ind);}document.querySelectorAll('.s2-right-card-item').forEach(function(el){if(el._wcBound)return;el._wcBound=true;el.addEventListener('dblclick',function(){var cid=parseInt(this.getAttribute('data-card-id'));if(cid&&App.wordEditor)App.wordEditor.openFromComposer(cid);});el.title=(el.title||'')+' | 双击编辑';});};

console.log('[WC Bridge] ready — libraries='+(S.libraries||[]).length);
}})();
