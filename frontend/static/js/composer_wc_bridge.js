// v4.2.0: Composer Word Card + Atom Bridge — Phase17
// T5: 改用 PK 底座（PK.api / PK.toast / PK._esc），保留全部外部接口
(function(){'use strict';if(!App.seedanceV2)return;
(function r(){if(!App.seedanceV2.libraries){setTimeout(r,200);return;}else if(App.seedanceV2.libraries.length===0){setTimeout(r,500);return;}_go();})();

function _go(){var S=App.seedanceV2;

    // T5 修复：字段映射修正后强制重新加载分组（覆盖旧 API 数据，确保 dimension_key 与 DB 一致）
    (async function(){
        try {
            var d = await PK.api('/api/v4/word-cards/groups');
            if (d && d.groups && d.groups.length > S.libraries.length) {
                var L = [];
                for (var i = 0; i < d.groups.length; i++) {
                    var g = d.groups[i];
                    var dk = g.key;
                    if (g.type === 'atom') { dk = _atomNameToField(g.name); }
                    var cat = g.type === 'seedance' ? 'extended' : (g.type === 'builtin' ? 'basic' : (g.type === 'atom' ? 'basic' : 'custom'));
                    L.push({id: g.id, dimension_key: dk, dimension_name: g.name, category: cat, sort_order: i, card_count: g.card_count, description: g.description || '', _is_word_card: true, _is_atom: g.type === 'atom'});
                }
                S.libraries = L;
                console.log('[WC Bridge] 已从 PK.api 刷新 ' + L.length + ' 个分组');
            }
        } catch(e) { console.warn('[WC Bridge] 刷新失败', e); }
    })();

// 0. 原子类型 -> seedance 字段映射
var ATOM_FIELD_MAP={
    'subject':'subject','style':'scene_desc','composition':'composition',
    'lighting':'lighting','color':'color_grade','quality':'texture',
    'camera':'focal_length','atmosphere':'emotion','tone':'color_grade',
    'negative':'filter','constraint':'filter','creative':'particles','action':'action'
};
function _atomNameToField(name){var m={'主体描述':'subject','光影效果':'lighting','镜头语言':'focal_length','画质参数':'texture','风格表现':'scene_desc','色调氛围':'color_grade','构图取景':'composition','色彩搭配':'color','创意元素':'particles','限制条件':'filter','动作':'action','情绪':'emotion','天气':'weather','特效':'sfx','自动导入':'scene_desc'};for(var k in m){if(name.indexOf(k)>=0)return m[k];}return'scene_desc';}

// 0. 统一字段映射表
if(!S._fieldToDim){
    S._fieldToDim={};
    var allFields=S._F||{};
    for(var k in allFields){
        if(k==='emotion')S._fieldToDim[k]='emotion';
        else if(k==='camera_move')S._fieldToDim[k]='camera_move';
        else if(k==='subject')S._fieldToDim[k]='subject';
        else if(k==='scene_desc')S._fieldToDim[k]='scene';
        else if(k==='composition')S._fieldToDim[k]='composition';
        else if(k==='lighting')S._fieldToDim[k]='lighting';
        else if(k==='action')S._fieldToDim[k]='action';
        else if(k==='focal_length')S._fieldToDim[k]='focal_length';
        else if(k==='texture')S._fieldToDim[k]='texture';
        else if(k==='speed')S._fieldToDim[k]='speed';
        else if(k==='color_grade')S._fieldToDim[k]='color_grade';
        else if(k==='weather')S._fieldToDim[k]='weather';
        else if(k==='particles')S._fieldToDim[k]='particles';
        else if(k==='perspective')S._fieldToDim[k]='perspective';
        else if(k==='depth_of_field')S._fieldToDim[k]='depth_of_field';
        else if(k==='filter')S._fieldToDim[k]='filter';
        else if(k==='natural_force')S._fieldToDim[k]='natural_force';
        else if(k==='environment_detail')S._fieldToDim[k]='env_detail';
        else if(k==='film_flaw')S._fieldToDim[k]='film_flaw';
        else if(k==='fantasy_physics')S._fieldToDim[k]='fantasy_physics';
        else if(k==='character_voice')S._fieldToDim[k]='audio_char_narr';
        else if(k==='bgm')S._fieldToDim[k]='audio_bgm';
        else if(k==='sfx')S._fieldToDim[k]='audio_sfx';
    }
}

// 1. 分组加载 — T5: PK.api
S.__origLL=S.loadLibraries;
S.loadLibraries=async function(){
try{var d=await PK.api('/api/v4/word-cards/groups');if(d&&d.groups){
var L=[];for(var i=0;i<d.groups.length;i++){var g=d.groups[i];
var dk=g.key;
if(g.type==='atom'){dk=_atomNameToField(g.name);}
var cat=g.type==='seedance'?'extended':(g.type==='builtin'?'basic':(g.type==='atom'?'basic':'custom'));
L.push({id:g.id,dimension_key:dk,dimension_name:g.name,category:cat,sort_order:i,card_count:g.card_count,description:g.description||'',_is_word_card:true,_is_atom:g.type==='atom'});}
this.libraries=L;return;}}catch(e){console.log('[WC] loadLibraries fallback',e);}return S.__origLL.call(this);};

// 2. 词卡加载 — T5: PK.api
S.__origLC=S.loadCards;
S.loadCards=async function(libId){if(this.cardCache[libId])return;
try{var d=await PK.api('/api/v4/word-cards?group_id='+libId+'&page_size=200');if(d&&d.items){var C=[];for(var i=0;i<d.items.length;i++){var c=d.items[i];C.push({id:c.id,word_text:c.content||'',definition:c.meaning||'',preview_image:c.thumbnail||'',preview_video:c.preview_media||'',is_system:c.is_builtin?1:0,usage_count:c.usage_count||0,heat_weight:c.heat_weight||0});}this.cardCache[libId]=C;return;}}catch(e){}return S.__origLC.call(this,libId);};

// 3. 选取词卡 — T5: PK.api(link) + 业务逻辑不变
S.__origPW=S._pickRightWord;
S._pickRightWord=function(el){
    var cid=parseInt(el.getAttribute('data-card-id')),w=el.dataset.word;
    if(!w||!S.activeSceneId)return;
    var sc=S._getCurrentScene();if(!sc)return;
    var isAtom=el.classList.contains('s2-card-atom');
    if(isAtom && !S.activeField){
        var dimKey=el.getAttribute('data-dim')||_atomNameToField(el.getAttribute('data-group')||'');
        S.activeField=dimKey;
    }
    if(!S.activeField){PK.toast('请先点击镜头字段','warning');return;}
    if(cid&&S.activeSceneId){PK.api('/api/v4/word-cards/picker/link',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({scene_id:S.activeSceneId,card_id:cid})}).catch(function(){});}
    var cv=(sc[S.activeField]||'').trim(),isC=cv.indexOf(',')>=0||cv.length<=20;
    if(isC&&cv.indexOf(w)>=0)cv=cv.replace(w,'').replace(/,\s*,/g,',').replace(/^,|,$/g,'').trim();
    else if(isC&&cv)cv=cv+', '+w;else cv=w;
    sc[S.activeField]=cv;S.updateSceneField(S.activeSceneId,S.activeField,cv);S._refreshRightSelection();S.compose();};

// 4. 添加词条 — T5: PK.api + PK.toast
S.__origAP=S._addPanelWord;
S._addPanelWord=async function(libId){var wi=document.getElementById('s2PanelWordInput'),di=document.getElementById('s2PanelWordDef'),w=(wi?wi.value:'').trim();if(!w){PK.toast('请输入词条','warning');return;}var def=di?(di.value||'').trim():'';try{var d=await PK.json('/api/v4/word-cards',{content:w,meaning:def,name:w.substring(0,60),group_id:libId,module:'custom',source:'composer_add'});if(d&&d.ok){if(wi)wi.value='';if(di)di.value='';delete S.cardCache[libId];await S.loadCards(libId);var l=S.getLibraryById(libId);if(l)S._renderRightPickerContent(l);PK.toast('已添加','success');}}catch(e){PK.toast('添加失败','error');}};

// 5. 高亮刷新
S._refreshRightSelection=function(){var sc=S._getCurrentScene(),fv=sc?(sc[S.activeField]||''):'';document.querySelectorAll('.s2-right-card-item').forEach(function(el){var w=el.dataset.word||'',s=fv&&w&&fv.indexOf(w)>=0;el.classList.toggle('selected',s);el.style.background=s?'rgba(16,185,129,0.08)':'';el.style.borderColor=s?'#10b981':'var(--border-color)';});S.renderScenes();};

// 6. 打开选取面板 — T5: PK.toast
S.__origORP=S._openRightPicker;
S._openRightPicker=function(sid,field){
    S.activeSceneId=sid;
    var isCustomKey=field&&typeof field==='string'&&field.startsWith&&field.startsWith('custom_');
    if(isCustomKey){
        PK.toast('自定义分组词库','info');
        S.__origORP.call(S, sid, field);
        return;
    }
    S.activeField=field;
    var panel=document.getElementById('s2RightPanel');
    if(!panel)return;
    if(panel.classList.contains('collapsed'))S.toggleRightPanel();
    if(!S.libraries||S.libraries.length===0){
        PK.toast('词库正在加载，请稍候...','info');
        var retry=0, maxRetry=20;
        var timer=setInterval(function(){
            retry++;
            if(S.libraries&&S.libraries.length>0){
                clearInterval(timer);
                S._openRightPicker(sid, field);
            }else if(retry>=maxRetry){
                clearInterval(timer);
                PK.toast('词库加载超时，请刷新页面','error');
            }
        },300);
        return;
    }
    var dimKey=(S._fieldToDim&&S._fieldToDim[field])?S._fieldToDim[field]:null;
    var foundLib=null;
    if(dimKey) foundLib=S.getLibraryByKey(dimKey);
    if(!foundLib) foundLib=S.getLibraryByKey(field);
    if(!foundLib){
        for(var i=0;i<S.libraries.length;i++){
            var lib=S.libraries[i];
            if(lib.dimension_key===dimKey||lib.dimension_key===field||lib.dimension_key===('dim_'+field)){foundLib=lib;break;}
        }
    }
    if(!foundLib){
        var _quiet = ['camera_move','subject'];
        if (_quiet.indexOf(field) < 0 && _quiet.indexOf(dimKey) < 0) { console.debug('[WC Bridge] 未匹配字段:', field, 'dimKey:', dimKey); }
        return;
    }
    S.activePickerLibId=foundLib.id;
    S._renderRightPickerContent(foundLib);
};

// 7. 预加载
S.preloadAllCardCaches=async function(){var L=this.libraries||[];for(var i=0;i<Math.min(L.length,10);i++){var lid=L[i].id;if(this.cardCache[lid])continue;try{await this.loadCards(lid);}catch(e){}}};

// 8. 渲染标注+双击编辑 + 底部原子入口（业务不变，仅 inline html 用 PK._esc 不可能因为此函数不改变量文本）
S.__origRRC=S._renderRightPickerContent;
S._renderRightPickerContent=function(lib){
    S.__origRRC.call(this,lib);
    var t=document.querySelector('.s2-panel-toolbar');
    if(t&&!t.querySelector('.wc-indicator')){
        var ind=document.createElement('span');
        ind.className='wc-indicator';
        ind.style.cssText='font-size:9px;color:var(--primary);margin-left:4px;opacity:0.5;';
        ind.textContent='\ud83d\udd04 统一词卡';
        t.appendChild(ind);
    }
    document.querySelectorAll('.s2-right-card-item').forEach(function(el){
        if(el._wcBound)return;el._wcBound=true;
        el.addEventListener('dblclick',function(){
            var cid=parseInt(this.getAttribute('data-card-id'));
            if(cid&&App.wordEditor)App.wordEditor.openFromComposer(cid);
        });
        el.title=(el.title||'')+' | 双击编辑';
    });
    var cardList=document.querySelector('.s2-right-card-list');
    if(cardList && !cardList.querySelector('.s2-atom-library-bar')){
        var atomHtml='<div class="s2-atom-library-bar" style="margin-top:10px;padding-top:8px;border-top:1px solid var(--border-color);">';
        atomHtml+='<div style="font-size:11px;color:var(--text-muted);margin-bottom:4px;">\u269b 原子引擎 - 已归档的原子词卡可在此直接调用</div>';
        atomHtml+='<div id="s2AtomGroupBtns" style="display:flex;flex-wrap:wrap;gap:4px;"></div></div>';
        cardList.insertAdjacentHTML('beforeend',atomHtml);
        var atomLibs=[];
        for(var i=0;i<S.libraries.length;i++){if(S.libraries[i]._is_atom)atomLibs.push(S.libraries[i]);}
        var btnContainer=document.getElementById('s2AtomGroupBtns');
        if(btnContainer && atomLibs.length>0){
            for(var ai=0;ai<atomLibs.length;ai++){
                var al=atomLibs[ai];
                (function(lib){var btn=document.createElement('button');
                btn.className='btn btn-xs btn-outline';
                btn.textContent=lib.dimension_name;
                btn.style.cssText='font-size:11px;margin:0;';
                btn.onclick=function(){S._renderRightPickerContent(lib);S.activePickerLibId=lib.id;};
                btnContainer.appendChild(btn);})(al);
            }
        }
    }
};

// 9. 搜索 — T5: PK.api
S.__origSQ=S._quickSearch;
S._quickSearch=async function(q){var libId=this.activePickerLibId;if(!libId||!q)return;
try{var d=await PK.api('/api/v4/word-cards/search?q='+encodeURIComponent(q)+'&group_id='+libId+'&page_size=50');var list=document.querySelector('.s2-right-card-list');if(list&&d&&d.items){var html='';var L=S.getLibraryById(libId);var dim=L&&L.dimension_name?L.dimension_name:'';for(var i=0;i<d.items.length;i++){var c=d.items[i];var v=c.content||'';html+=S._renderCardItem(c.id, v, c.meaning||'', c.thumbnail||'', c.preview_media||'', dim, false, false);}list.innerHTML=html||'<div style="color:var(--text-muted);padding:12px;text-align:center;">\ud83d\udd0d 未找到相关词卡</div>';}}catch(e){}};

// 10. 删除词条 — T5: PK.api + PK.toast + PK.confirm
S.__origDR=S._deleteWord;
S._deleteWord=async function(wordId, el, e){if(e){e.stopPropagation();}var ok=await PK.confirm('确定删除该词条？');if(!ok)return;
try{var d=await PK.api('/api/v4/word-cards/'+wordId,{method:'DELETE'});if(d&&d.ok){PK.toast('已删除','success');if(el){el.remove();}if(S.activePickerLibId){delete S.cardCache[S.activePickerLibId];await S.loadCards(S.activePickerLibId);var lib=S.getLibraryById(S.activePickerLibId);if(lib)S._renderRightPickerContent(lib);}}}catch(e){PK.toast('删除失败','error');}};

}});
