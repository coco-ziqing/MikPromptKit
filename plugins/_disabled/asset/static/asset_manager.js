// PromptKit Asset Manager v1.0.0 — Phase25 Track A
// 资产画廊: 上传/去重/版本/标签/评分/溯源/筛选/预览
(function(){'use strict';

var A = {
  VERSION: '1.0.0',
  _apiBase: '/api/plugins/com.promptkit.asset',
  _assets: [], _stats: {}, _tags: [],
  _filter: { media_type:'', tag:'', min_rating:0, q:'', sort:'recent' },
  _trash: false,

  _isEN: function(){ try { return (localStorage.getItem('promptkit_lang')||'zh-CN')==='en'; } catch(e){ return false; } },
  _L: function(zh,en){ return this._isEN() ? (en||zh) : zh; },

  // ---- API helpers ----
  _api: async function(p){ try{ var r=await fetch(this._apiBase+p); return await r.json(); }catch(e){ return {ok:false}; } },
  _apiPost: async function(p,d){ try{ var r=await fetch(this._apiBase+p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(d||{})}); return await r.json(); }catch(e){ return {ok:false}; } },
  _apiPut: async function(p,d){ try{ var r=await fetch(this._apiBase+p,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(d||{})}); return await r.json(); }catch(e){ return {ok:false}; } },
  _apiDelete: async function(p){ try{ var r=await fetch(this._apiBase+p,{method:'DELETE'}); return await r.json(); }catch(e){ return {ok:false}; } },
  _apiUpload: async function(p,formData){ try{ var r=await fetch(this._apiBase+p,{method:'POST',body:formData}); return await r.json(); }catch(e){ return {ok:false}; } },

  _toast: function(m,t){ if(typeof App!=='undefined'&&App.showToast) App.showToast(m,t); else console.log('[Asset]',m); },
  _esc: function(s){ if(s==null) return ''; var d=document.createElement('div'); d.textContent=String(s); return d.innerHTML; },
  _overlay: function(){ var o=document.createElement('div'); o.className='pk-modal-overlay'; o.onclick=function(e){ if(e.target===o) o.remove(); }; return o; },
  _fileUrl: function(id){ return this._apiBase+'/assets/'+id+'/file'; },
  _fmtSize: function(b){ b=b||0; if(b<1024) return b+' B'; if(b<1048576) return (b/1024).toFixed(1)+' KB'; return (b/1048576).toFixed(1)+' MB'; },
  _stars: function(r){ r=Math.round(r||0); var s=''; for(var i=1;i<=5;i++) s+= (i<=r?'★':'☆'); return s; },

  // ---- 入口 ----
  open: function(){
    var vp=document.getElementById('viewAssetMgmt');
    if(!vp){ vp=document.createElement('div'); vp.id='viewAssetMgmt'; vp.className='view-panel active-view'; vp.style.display='flex'; var mc=document.getElementById('mainContent'); if(mc) mc.appendChild(vp); }
    document.querySelectorAll('#mainContent > .view-panel').forEach(function(p){ p.style.display='none'; });
    vp.style.display='flex';
    this._init();
  },
  close: function(){ var vp=document.getElementById('viewAssetMgmt'); if(vp) vp.style.display='none'; },

  _init: async function(){
    var vp=document.getElementById('viewAssetMgmt'); if(!vp) return;
    vp.innerHTML='<div class="pk-asset-wrap"><div id="pkAssetHeader"></div><div id="pkAssetBody"><p style="padding:40px;text-align:center;color:var(--text-muted);">'+this._L('加载中...','Loading...')+'</p></div></div>';
    await this._reload();
  },

  _reload: async function(){
    await this._loadStats();
    await this._loadTags();
    await this._loadAssets();
    this._renderHeader();
    this._renderGrid();
  },

  _loadStats: async function(){ var r=await this._api('/stats'); this._stats=r.ok?r:{}; },
  _loadTags: async function(){ var r=await this._api('/tags'); this._tags=(r.tags||[]); },
  _loadAssets: async function(){
    var f=this._filter, qs=[];
    if(f.media_type) qs.push('media_type='+encodeURIComponent(f.media_type));
    if(f.tag) qs.push('tag='+encodeURIComponent(f.tag));
    if(f.min_rating>0) qs.push('min_rating='+f.min_rating);
    if(f.q) qs.push('q='+encodeURIComponent(f.q));
    qs.push('sort='+f.sort); qs.push('limit=300');
    var r=await this._api('/assets?'+qs.join('&'));
    var list=r.assets||[];
    // 前端过滤回收站视图（后端仅返回 is_deleted=0；回收站单独取）
    if(this._trash){ var t=await this._api('/assets?limit=300&_all=1'); /* 无专用回收站端点，用 stats.trashed 提示 */ }
    this._assets=list;
  },

  // ---- Header (stats + toolbar + filters) ----
  _renderHeader: function(){
    var c=document.getElementById('pkAssetHeader'),L=this._L.bind(this),self=this,s=this._stats; if(!c) return;
    var byType={}; (s.by_type||[]).forEach(function(x){ byType[x.media_type]=x.c; });
    var h='';
    h+='<div class="pk-asset-topbar">';
    h+='<div class="pk-asset-title"><h4>🖼️ '+L('资产管理','Asset Manager')+'</h4>';
    h+='<span class="pk-asset-substat">'+(s.total||0)+' '+L('资产','assets')+' · '+(s.total_size_mb||0)+' MB · '+L('图','img')+' '+(byType.image||0)+' / '+L('视频','vid')+' '+(byType.video||0)+'</span></div>';
    h+='<div class="pk-asset-actions-top">';
    h+='<button class="btn btn-sm btn-primary" onclick="PK_AssetManager.showUpload()">⬆ '+L('上传','Upload')+'</button>';
    h+='<button class="btn btn-sm btn-outline-secondary" onclick="PK_AssetManager.scanDup()" title="'+L('扫描重复文件','Scan duplicates')+'">🕵️ '+L('去重','Dedup')+((s.duplicates||0)>0?' ('+s.duplicates+')':'')+'</button>';
    h+='<button class="btn btn-sm btn-outline-secondary" onclick="PK_AssetManager._reload()">🔄</button>';
    h+='</div></div>';

    // filter bar
    var types=[{v:'',zh:'全部',en:'All'},{v:'image',zh:'🖼 图片',en:'Images'},{v:'video',zh:'🎬 视频',en:'Videos'}];
    h+='<div class="pk-asset-filterbar">';
    h+='<div class="pk-asset-segbtns">';
    types.forEach(function(t){ h+='<button class="pk-seg'+(self._filter.media_type===t.v?' active':'')+'" onclick="PK_AssetManager.setType(\''+t.v+'\')">'+L(t.zh,t.en)+'</button>'; });
    h+='</div>';
    h+='<input class="pk-asset-search" id="pkAssetSearch" placeholder="'+L('搜索文件名/备注/生成提示词...','Search...')+'" value="'+self._esc(self._filter.q)+'" oninput="PK_AssetManager._debSearch(this.value)">';
    var sorts=[{v:'recent',zh:'最新',en:'Recent'},{v:'rating',zh:'评分',en:'Rating'},{v:'size',zh:'大小',en:'Size'},{v:'name',zh:'名称',en:'Name'}];
    h+='<select class="pk-asset-sel" onchange="PK_AssetManager.setSort(this.value)">';
    sorts.forEach(function(o){ h+='<option value="'+o.v+'"'+(self._filter.sort===o.v?' selected':'')+'>'+L(o.zh,o.en)+'</option>'; });
    h+='</select>';
    h+='<select class="pk-asset-sel" onchange="PK_AssetManager.setRating(this.value)">';
    [{v:0,zh:'全部星级',en:'Any ★'},{v:3,zh:'≥3★',en:'≥3★'},{v:4,zh:'≥4★',en:'≥4★'},{v:5,zh:'5★',en:'5★'}].forEach(function(o){ h+='<option value="'+o.v+'"'+(self._filter.min_rating==o.v?' selected':'')+'>'+L(o.zh,o.en)+'</option>'; });
    h+='</select>';
    h+='</div>';

    // tag chips
    if(this._tags.length){
      h+='<div class="pk-asset-tagbar"><span class="pk-tag-label">🏷</span>';
      h+='<button class="pk-tagchip'+(!self._filter.tag?' active':'')+'" onclick="PK_AssetManager.setTag(\'\')">'+L('全部','All')+'</button>';
      this._tags.slice(0,20).forEach(function(t){ h+='<button class="pk-tagchip'+(self._filter.tag===t.tag?' active':'')+'" onclick="PK_AssetManager.setTag(\''+self._esc(t.tag)+'\')">'+self._esc(t.tag)+' <em>'+t.c+'</em></button>'; });
      h+='</div>';
    }
    c.innerHTML=h;
  },

  _debSearch: function(v){ var self=this; clearTimeout(this._st); this._st=setTimeout(function(){ self._filter.q=v; self._loadAssets().then(function(){ self._renderGrid(); }); },300); },
  setType: function(v){ this._filter.media_type=v; this._refreshList(); },
  setSort: function(v){ this._filter.sort=v; this._refreshList(); },
  setRating: function(v){ this._filter.min_rating=parseFloat(v); this._refreshList(); },
  setTag: function(v){ this._filter.tag=v; this._refreshList(); },
  _refreshList: async function(){ await this._loadAssets(); this._renderHeader(); this._renderGrid(); },

  // ---- Grid ----
  _renderGrid: function(){
    var c=document.getElementById('pkAssetBody'),L=this._L.bind(this),self=this; if(!c) return;
    if(!this._assets.length){
      c.innerHTML='<div class="pk-empty-state" style="padding:60px 20px;text-align:center;"><p style="font-size:56px;margin:0;">🖼️</p><h4>'+L('暂无资产','No assets')+'</h4><p style="color:var(--text-muted);">'+L('点击「上传」导入图片或视频产出','Click Upload to import images or videos')+'</p><button class="btn btn-primary mt-3" onclick="PK_AssetManager.showUpload()">⬆ '+L('上传资产','Upload')+'</button></div>';
      return;
    }
    var h='<div class="pk-asset-gallery">';
    this._assets.forEach(function(a){
      var isVid=a.media_type==='video';
      var media = isVid
        ? '<video src="'+self._fileUrl(a.id)+'" muted preload="metadata" onmouseover="this.play()" onmouseout="this.pause();this.currentTime=0;"></video><span class="pk-asset-vbadge">▶</span>'
        : '<img loading="lazy" src="'+self._fileUrl(a.id)+'" onerror="this.parentNode.classList.add(\'pk-broken\')">';
      var dup = (a.duplicate_of||a.is_duplicate) ? '' : '';
      h+='<div class="pk-asset-tile" onclick="PK_AssetManager.detail('+a.id+')">';
      h+='<div class="pk-asset-thumb">'+media+'</div>';
      h+='<div class="pk-asset-tile-body">';
      h+='<div class="pk-asset-fname" title="'+self._esc(a.original_filename)+'">'+self._esc(a.original_filename||('#'+a.id))+'</div>';
      h+='<div class="pk-asset-tile-meta">';
      h+='<span class="pk-asset-rate" title="'+(a.rating||0)+'">'+self._stars(a.rating)+'</span>';
      h+='<span class="pk-asset-dim">'+(a.width?a.width+'×'+a.height:'')+(isVid&&a.duration?' · '+Math.round(a.duration)+'s':'')+'</span>';
      h+='</div>';
      if(a.tags&&a.tags.length){ h+='<div class="pk-asset-tiletags">'; a.tags.slice(0,3).forEach(function(t){ h+='<span class="pk-mini-tag">'+self._esc(t)+'</span>'; }); if(a.tags.length>3) h+='<span class="pk-mini-tag">+'+(a.tags.length-3)+'</span>'; h+='</div>'; }
      h+='<div class="pk-asset-badges">';
      if(a.version_count>0) h+='<span class="pk-asset-badge v">v'+(a.version_count+1)+'</span>';
      if(a.ref_count>0) h+='<span class="pk-asset-badge r">🔗'+a.ref_count+'</span>';
      h+='<span class="pk-asset-badge s">'+self._fmtSize(a.file_size)+'</span>';
      h+='</div>';
      h+='</div></div>';
    });
    h+='</div>';
    c.innerHTML=h;
  },

  // ---- Upload modal ----
  showUpload: function(){
    var L=this._L.bind(this),self=this,ov=this._overlay();
    ov.innerHTML='<div class="pk-modal pk-modal-2col" onclick="event.stopPropagation()"><h4>⬆ '+L('上传资产','Upload Assets')+'</h4>'+
      '<div class="pk-edit-2col"><div class="pk-edit-left">'+
        '<div class="pk-drop" id="pkDrop"><p style="font-size:40px;margin:0;">📁</p><p>'+L('拖拽文件到此，或点击选择','Drag files here or click to select')+'</p><input type="file" id="pkFiles" multiple accept="image/*,video/*" style="display:none;"></div>'+
        '<div id="pkFileList" class="pk-filelist"></div>'+
      '</div><div class="pk-edit-right">'+
        '<div class="form-group"><label>🏷 '+L('标签(逗号分隔)','Tags')+'</label><input type="text" id="up_tags" placeholder="'+L('如: 封面,精选','e.g. cover,best')+'"></div>'+
        '<div class="form-group"><label>🧬 '+L('生成模型','Gen Model')+'</label><input type="text" id="up_model" placeholder="sdxl / seedance..."></div>'+
        '<div class="form-group"><label>📝 '+L('生成提示词','Gen Prompt')+'</label><textarea id="up_prompt" rows="3"></textarea></div>'+
        '<div class="form-group"><label>📄 '+L('备注','Notes')+'</label><input type="text" id="up_notes"></div>'+
        '<label style="display:flex;align-items:center;gap:6px;font-size:13px;"><input type="checkbox" id="up_dedup" checked> '+L('自动去重(SHA256)','Auto dedup')+'</label>'+
      '</div></div>'+
      '<div class="pk-modal-actions"><button class="btn btn-secondary" onclick="this.closest(\'.pk-modal-overlay\').remove()">'+L('取消','Cancel')+'</button><button class="btn btn-primary" id="up_go" disabled>'+L('开始上传','Upload')+'</button></div>'+
      '<div id="up_progress" style="margin-top:10px;"></div></div>';
    document.body.appendChild(ov);
    var drop=ov.querySelector('#pkDrop'), input=ov.querySelector('#pkFiles'), listEl=ov.querySelector('#pkFileList'), goBtn=ov.querySelector('#up_go');
    self._pendingFiles=[];
    function refreshList(){
      listEl.innerHTML=self._pendingFiles.map(function(f,i){ return '<div class="pk-filerow"><span>'+(f.type.indexOf('video')===0?'🎬':'🖼')+' '+self._esc(f.name)+'</span><span class="pk-fsize">'+self._fmtSize(f.size)+'</span></div>'; }).join('');
      goBtn.disabled=!self._pendingFiles.length;
    }
    function addFiles(fl){ for(var i=0;i<fl.length;i++) self._pendingFiles.push(fl[i]); refreshList(); }
    drop.onclick=function(){ input.click(); };
    input.onchange=function(){ addFiles(input.files); };
    drop.ondragover=function(e){ e.preventDefault(); drop.classList.add('over'); };
    drop.ondragleave=function(){ drop.classList.remove('over'); };
    drop.ondrop=function(e){ e.preventDefault(); drop.classList.remove('over'); addFiles(e.dataTransfer.files); };
    goBtn.onclick=async function(){
      goBtn.disabled=true;
      var prog=ov.querySelector('#up_progress'), tags=ov.querySelector('#up_tags').value, model=ov.querySelector('#up_model').value, gprompt=ov.querySelector('#up_prompt').value, notes=ov.querySelector('#up_notes').value, dedup=ov.querySelector('#up_dedup').checked;
      var okc=0,dupc=0;
      for(var i=0;i<self._pendingFiles.length;i++){
        var f=self._pendingFiles[i];
        prog.innerHTML='<div class="pk-uprow">'+L('上传中','Uploading')+' '+(i+1)+'/'+self._pendingFiles.length+': '+self._esc(f.name)+'</div>';
        var fd=new FormData(); fd.append('file',f); fd.append('tags',tags); fd.append('gen_model',model); fd.append('gen_prompt',gprompt); fd.append('notes',notes); fd.append('dedup',dedup?'true':'false');
        var r=await self._apiUpload('/assets/upload',fd);
        if(r.ok){ okc++; if(r.is_duplicate) dupc++; }
      }
      self._toast(L('上传完成','Uploaded')+': '+okc+(dupc?(' ('+dupc+' '+L('重复','dup')+')'):''),'success');
      ov.remove(); self._reload();
    };
  },

  // ---- Detail modal ----
  detail: async function(id){
    var L=this._L.bind(this),self=this,r=await this._api('/assets/'+id); if(!r.ok) return;
    var a=r.asset, isVid=a.media_type==='video';
    var media = isVid ? '<video src="'+self._fileUrl(id)+'" controls style="max-width:100%;max-height:52vh;border-radius:8px;"></video>'
                      : '<img src="'+self._fileUrl(id)+'" style="max-width:100%;max-height:52vh;border-radius:8px;object-fit:contain;">';
    var gp=a.gen_params||{}; var gpStr=Object.keys(gp).length?JSON.stringify(gp):'—';
    var ov=this._overlay();
    var tagsHtml=(a.tags||[]).map(function(t){ return '<span class="pk-mini-tag pk-tag-del" onclick="PK_AssetManager.rmTag('+id+',\''+self._esc(t)+'\')">'+self._esc(t)+' ✕</span>'; }).join('');
    var verHtml=(a.versions||[]).length ? (a.versions||[]).map(function(v){ return '<div class="pk-verrow">v'+v.version+' · '+self._esc((v.notes||'').substring(0,40))+' <span style="color:var(--text-muted);">'+(v.created_at||'')+'</span></div>'; }).join('') : '<span style="color:var(--text-muted);">'+L('仅原始版本','Original only')+'</span>';
    var refHtml=(a.refs||[]).length ? (a.refs||[]).map(function(rf){ return '<span class="pk-refchip">'+self._esc(rf.ref_type)+'#'+rf.ref_id+' <span onclick="PK_AssetManager.unlink('+id+',\''+self._esc(rf.ref_type)+'\','+rf.ref_id+')" style="cursor:pointer;">✕</span></span>'; }).join('') : '<span style="color:var(--text-muted);">'+L('无关联','None')+'</span>';
    ov.innerHTML='<div class="pk-modal pk-modal-2col pk-asset-detail" onclick="event.stopPropagation()">'+
      '<div class="pk-edit-2col"><div class="pk-edit-left" style="text-align:center;">'+media+
        '<div style="margin-top:10px;"><button class="btn btn-sm btn-outline-secondary" onclick="window.open(\''+self._apiBase+'/assets/'+id+'/download\')">⬇ '+L('下载','Download')+'</button> '+
        '<button class="btn btn-sm btn-outline-secondary" onclick="document.getElementById(\'pkVerFile\').click()">➕ '+L('新版本','New Ver')+'</button>'+
        '<input type="file" id="pkVerFile" style="display:none;" onchange="PK_AssetManager.addVersion('+id+',this.files[0])"></div>'+
      '</div><div class="pk-edit-right">'+
        '<h4 style="margin:0 0 4px;">'+self._esc(a.original_filename)+'</h4>'+
        '<div style="font-size:12px;color:var(--text-muted);margin-bottom:10px;">'+(a.width?a.width+'×'+a.height:'')+(isVid&&a.duration?' · '+Math.round(a.duration)+'s':'')+' · '+self._fmtSize(a.file_size)+' · '+self._esc(a.mime_type)+'</div>'+
        '<div class="form-group"><label>⭐ '+L('评分','Rating')+'</label><div class="pk-rate-input" id="pkRateIn">'+[1,2,3,4,5].map(function(n){ return '<span data-n="'+n+'" onclick="PK_AssetManager.rate('+id+','+n+')" class="'+(Math.round(a.rating)>=n?'on':'')+'">★</span>'; }).join('')+'</div></div>'+
        '<div class="form-group"><label>🏷 '+L('标签','Tags')+'</label><div class="pk-tag-editrow">'+tagsHtml+'<input type="text" id="pkNewTag" placeholder="+tag" onkeydown="if(event.key===\'Enter\')PK_AssetManager.addTag('+id+',this.value)"></div></div>'+
        '<div class="form-group"><label>🧬 '+L('生成溯源','Generation')+'</label><div class="pk-gen-box"><div><b>model:</b> '+self._esc(a.gen_model||'—')+'</div><div><b>prompt:</b> '+self._esc(a.gen_prompt||'—')+'</div><div><b>params:</b> <code>'+self._esc(gpStr)+'</code></div></div></div>'+
        '<div class="form-group"><label>📝 '+L('备注','Notes')+'</label><textarea id="pkNotes" rows="2" onblur="PK_AssetManager.saveNotes('+id+',this.value)">'+self._esc(a.notes||'')+'</textarea></div>'+
        '<div class="form-group"><label>🔗 '+L('关联(提示词/词卡/镜头)','Refs')+'</label><div>'+refHtml+'</div><div style="margin-top:6px;display:flex;gap:6px;"><select id="pkRefType" class="pk-asset-sel"><option value="word_card">word_card</option><option value="prompt">prompt</option><option value="scene">scene</option><option value="atom">atom</option></select><input type="number" id="pkRefId" placeholder="id" style="width:70px;"><button class="btn btn-sm btn-outline-secondary" onclick="PK_AssetManager.link('+id+')">+</button></div></div>'+
        '<div class="form-group"><label>📚 '+L('版本链','Versions')+'</label><div class="pk-ver-list">'+verHtml+'</div></div>'+
      '</div></div>'+
      '<div class="pk-modal-actions"><button class="btn btn-danger btn-sm" style="margin-right:auto;" onclick="PK_AssetManager.del('+id+')">🗑 '+L('删除','Delete')+'</button><button class="btn btn-secondary" onclick="this.closest(\'.pk-modal-overlay\').remove()">'+L('关闭','Close')+'</button></div></div>';
    document.body.appendChild(ov);
  },

  rate: async function(id,n){ var r=await this._apiPost('/assets/'+id+'/rate',{rating:n,user_id:(window.__PK_USER__&&window.__PK_USER__.id)||1}); if(r.ok){ this._toast(this._L('已评分','Rated'),'success'); this._syncTileAfter(id); this.detail(id); } },
  addTag: async function(id,v){ v=(v||'').trim(); if(!v) return; var r=await this._apiPost('/assets/'+id+'/tags',{tags:[v]}); if(r.ok){ await this._loadTags(); this.detail(id); this._renderHeader(); } },
  rmTag: async function(id,t){ await this._apiDelete('/assets/'+id+'/tags/'+encodeURIComponent(t)); await this._loadTags(); this.detail(id); this._renderHeader(); },
  saveNotes: async function(id,v){ await this._apiPut('/assets/'+id,{notes:v}); },
  link: async function(id){ var t=document.getElementById('pkRefType').value, rid=document.getElementById('pkRefId').value; if(!rid) return; var r=await this._apiPost('/assets/'+id+'/link',{ref_type:t,ref_id:parseInt(rid)}); if(r.ok){ this._toast(this._L('已关联','Linked'),'success'); this.detail(id); } },
  unlink: async function(id,t,rid){ await this._apiDelete('/assets/'+id+'/link/'+t+'/'+rid); this.detail(id); },
  addVersion: async function(id,file){ if(!file) return; var fd=new FormData(); fd.append('file',file); fd.append('notes',''); var r=await this._apiUpload('/assets/'+id+'/versions',fd); if(r.ok){ this._toast(this._L('新版本已添加','Version added')+' v'+r.version,'success'); this.detail(id); this._refreshList(); } },
  del: async function(id){ if(!confirm(this._L('移入回收站？','Move to trash?'))) return; await this._apiDelete('/assets/'+id); document.querySelectorAll('.pk-modal-overlay').forEach(function(o){ o.remove(); }); this._reload(); },
  scanDup: async function(){ var r=await this._apiPost('/scan-duplicates',{}); if(r.ok){ this._toast(this._L('去重扫描完成','Dedup done')+': '+r.duplicate_groups+' '+this._L('组','groups')+' / '+r.duplicate_assets+' '+this._L('重复','dups'),'success'); this._reload(); } },
  _syncTileAfter: function(id){ /* 轻量：整体刷新交给关闭详情后的 reload */ },
};

window.PK_AssetManager = A;
console.log('[PK_AssetManager] loaded v'+A.VERSION);
})();
