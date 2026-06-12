"""Phase 8.2: Custom group full integration — compose output + field chips + parity with Ext-Unit

Gap analysis:
1. Compose ignores custom group keys (custom_xxx not in hardcoded field list)
2. Shot cards don't show custom group content as FieldChips
3. Custom group management entry hidden behind tiny ⚙ link

Fixes:
1. compose: after known fields, iterate all scene keys for custom group content
2. renderSceneCard: add FieldChips for custom groups with content
3. Copy/paste/export handles custom group fields
"""
import os

fp = os.path.expanduser(r"C:\Users\ASUS\.openclaw\workspace\prompt-tool-dev\frontend\static\js\seedance_v2_composer.js")
with open(fp, encoding='utf-8') as f:
    txt = f.read()

original = txt
changes = 0

# ── FIX 1: Compose — append custom group fields after known fields ──
old_compose_end = (
    "if(sc.film_flaw)parts.push(sc.film_flaw);if(sc.fantasy_physics)parts.push(sc.fantasy_physics);"
    "if(parts.length)sl+=': '+parts.join(',');lines.push(sl);"
    "this.outputJson.scenes.push({time:st+'-'+et+'s',fields:parts});"
)
new_compose_end = (
    "if(sc.film_flaw)parts.push(sc.film_flaw);if(sc.fantasy_physics)parts.push(sc.fantasy_physics);"
    "// 自定义分组字段: 遍历scene中所有custom_开头的key\n"
    "for(var ck in sc){if(ck.indexOf('custom_')===0&&sc[ck]&&sc[ck].trim()&&sc[ck]!==' '){var cv=sc[ck].trim();if(cv)parts.push(cv);}}\n"
    "if(parts.length)sl+=': '+parts.join(',');lines.push(sl);"
    "this.outputJson.scenes.push({time:st+'-'+et+'s',fields:parts});"
)

if old_compose_end in txt:
    txt = txt.replace(old_compose_end, new_compose_end)
    changes += 1
    print("[OK] compose: custom group fields appended")
else:
    print("[FAIL] compose end not found")

# ── FIX 2: renderSceneCard — add FieldChips for custom groups with content ──
old_field_chips = (
    "h+='</div>';\n                // == 拓展区：功能单元(Ext-Unit)系统 =="
)
new_field_chips = (
    "h+='</div>';\n"
    "                // 自定义分组FieldChips: 显示有内容的自定义分组\n"
    "                var custFields=[];\n"
    "                for(var ck2 in s){if(ck2.indexOf('custom_')===0&&s[ck2]&&s[ck2].trim()&&s[ck2]!==' '){\n"
    "                    var clib=null;\n"
    "                    for(var cli=0;cli<App.seedanceV2.libraries.length;cli++){if(App.seedanceV2.libraries[cli].dimension_key===ck2){clib=App.seedanceV2.libraries[cli];break;}}\n"
    "                    var cn=clib?(clib.dimension_name||'').substring(0,8):ck2.substring(7,15);\n"
    "                    custFields.push({f:ck2,n:cn,v:s[ck2]});\n"
    "                }}\n"
    "                if(custFields.length>0){\n"
    "                    h+='<div class=\"s2-field-group\" style=\"margin-top:6px;\"><span class=\"s2-field-label\">📁 自定义</span>';\n"
    "                    for(var cfi=0;cfi<custFields.length;cfi++){\n"
    "                        var cf=custFields[cfi];\n"
    "                        var cv=cf.v;var cn=cf.n;var cfk=cf.f;\n"
    "                        h+='<span class=\"s2-field-chip s2-filled\" data-scene-id=\"'+s.id+'\" data-field=\"'+cfk+'\" style=\"border-color:var(--primary);\"><span class=\"s2-chip-label\">'+App._escape(cn)+'</span><span class=\"s2-chip-val\">'+(cv.length>10?cv.substring(0,10)+'..':cv)+'</span></span>';\n"
    "                    }\n"
    "                    h+='</div>';\n"
    "                }\n"
    "                // == 拓展区：功能单元(Ext-Unit)系统 =="
)

if old_field_chips in txt:
    txt = txt.replace(old_field_chips, new_field_chips)
    changes += 1
    print("[OK] renderSceneCard: custom group FieldChips added")
else:
    print("[FAIL] field chips marker not found")

# ── FIX 3: _copyScene / duplicateScene / _exportScene — include custom group fields ──
# These functions have hardcoded field lists. Add custom group iteration.
old_copy_fields = (
    "var fields = ['camera_move','subject','scene_desc','composition','lighting',\n"
    "                    'action','focal_length','texture','speed','emotion','color_grade',\n"
    "                    'weather','particles','perspective','depth_of_field','filter',\n"
    "                    'natural_force','environment_detail','film_flaw','fantasy_physics'];\n"
    "                var clip = {};\n"
    "                for (var fi = 0; fi < fields.length; fi++) {\n"
    "                    if (src[fields[fi]]) clip[fields[fi]] = src[fields[fi]];\n"
    "                }"
)
new_copy_fields = (
    "var fields = ['camera_move','subject','scene_desc','composition','lighting',\n"
    "                    'action','focal_length','texture','speed','emotion','color_grade',\n"
    "                    'weather','particles','perspective','depth_of_field','filter',\n"
    "                    'natural_force','environment_detail','film_flaw','fantasy_physics'];\n"
    "                var clip = {};\n"
    "                for (var fi = 0; fi < fields.length; fi++) {\n"
    "                    if (src[fields[fi]]) clip[fields[fi]] = src[fields[fi]];\n"
    "                }\n"
    "                // 也复制自定义分组字段\n"
    "                for(var ck3 in src){if(ck3.indexOf('custom_')===0&&src[ck3]&&src[ck3].trim()&&src[ck3]!==' '){clip[ck3]=src[ck3];}}"
)

if old_copy_fields in txt:
    txt = txt.replace(old_copy_fields, new_copy_fields)
    changes += 1
    print("[OK] _copyScene: custom group fields copied")
else:
    print("[FAIL] _copyScene fields not found")

# ── FIX 4: _pasteScene / duplicateScene — include custom group fields in JSON body ──
# Find the duplicateScene function which builds a JSON body with all fields
old_duplicate = (
    "fantasy_physics:src.fantasy_physics})});if(d&&d.ok)await this.openProject(this.currentProjectId);"
)
new_duplicate = (
    "fantasy_physics:src.fantasy_physics,"
    "// 自定义分组字段\n"
    "custom_fields:function(s){var o={};for(var k in s){if(k.indexOf('custom_')===0&&s[k]&&s[k].trim()&&s[k]!==' ')o[k]=s[k];}return o;}(src)}));if(d&&d.ok)await this.openProject(this.currentProjectId);"
)

# Check duplicateScene function exists differently in this version
if old_duplicate in txt:
    txt = txt.replace(old_duplicate, new_duplicate)
    changes += 1
    print("[OK] duplicateScene: custom group fields included")
else:
    print("[WARN] duplicateScene SNIPPET NOT MATCHED - checking alternative")
    # Try to find the exact string
    idx = txt.find("fantasy_physics:src.fantasy_physics")
    if idx >= 0:
        print(f"  Found fantasy_physics:src.fantasy_physics at {idx}")
        ctx = txt[idx:idx+30]
        print(f"  Context: {repr(ctx)}")

# ── FIX 5: Export scene — include custom group fields ──
old_export_fields = (
    "var fields = ['camera_move','subject','scene_desc','composition','lighting','action','focal_length','texture','speed','emotion','color_grade','weather','particles','perspective','depth_of_field','filter','natural_force','environment_detail','film_flaw','fantasy_physics'];\n"
    "        var data = { version: '1.0', type: 'promptkit_scene', exported_at: new Date().toISOString(), scene_name: '镜头'+(idx+1), duration: scene.duration, fields: {} };\n"
    "        for (var fi = 0; fi < fields.length; fi++) {\n"
    "            if (scene[fields[fi]]) data.fields[fields[fi]] = scene[fields[fi]];\n"
    "        }"
)
new_export_fields = (
    "var fields = ['camera_move','subject','scene_desc','composition','lighting','action','focal_length','texture','speed','emotion','color_grade','weather','particles','perspective','depth_of_field','filter','natural_force','environment_detail','film_flaw','fantasy_physics'];\n"
    "        var data = { version: '1.0', type: 'promptkit_scene', exported_at: new Date().toISOString(), scene_name: '镜头'+(idx+1), duration: scene.duration, fields: {} };\n"
    "        for (var fi = 0; fi < fields.length; fi++) {\n"
    "            if (scene[fields[fi]]) data.fields[fields[fi]] = scene[fields[fi]];\n"
    "        }\n"
    "        // 也导出自定义分组字段\n"
    "        for(var ck4 in scene){if(ck4.indexOf('custom_')===0&&scene[ck4]&&scene[ck4].trim()&&scene[ck4]!==' '){data.fields[ck4]=scene[ck4];}}"
)

if old_export_fields in txt:
    txt = txt.replace(old_export_fields, new_export_fields)
    changes += 1
    print("[OK] _exportScene: custom group fields exported")
else:
    print("[FAIL] _exportScene fields not found")

# ── FIX 6: bind custom group FieldChip click handlers in renderScenes ──
# The existing fieldChip click binding iterates document.querySelectorAll('.s2-field-chip')
# Custom group chips are also .s2-field-chip so they should get bound automatically.
# But the handler calls openCardPicker(sid, f) where f=this.dataset.field
# This should work since openCardPicker now handles custom_ keys.

# ── FIX 7: add more prominent group management entry in the ext-group header ──
# Change ⚙ to a more descriptive link
old_manage = (
    "h+='<span class=\"s2-ext-manage-link\" onclick=\"App.seedanceV2.openGroupManager()\" title=\"管理自定义分组\">⚙</span>';"
)
new_manage = (
    "h+='<span class=\"s2-ext-manage-link\"><button class=\"btn btn-xs btn-outline\" onclick=\"App.seedanceV2._openGroupCreator()\" title=\"新建自定义分组\" style=\"font-size:10px;padding:1px 6px;margin-right:3px;\">+📁</button><button class=\"btn btn-xs btn-outline\" onclick=\"App.seedanceV2.openGroupManager()\" title=\"管理自定义分组\" style=\"font-size:10px;padding:1px 6px;\">⚙</button></span>';"
)

if old_manage in txt:
    txt = txt.replace(old_manage, new_manage)
    changes += 1
    print("[OK] Ext-group: +create button added alongside manage")
else:
    print("[FAIL] manage link not found")

# ── Save & verify ──
with open(fp, 'w', encoding='utf-8') as f:
    f.write(txt)

bc = txt.count('{') - txt.count('}')
pc = txt.count('(') - txt.count(')')
sq = txt.count('[') - txt.count(']')
print(f"Brace: {{{bc}}} ({pc}) [{sq}]")
assert bc == 0 and pc == 0 and sq == 0, f"BRACE MISMATCH"

for fn in ['custom_','compose=function','renderSceneCard','_copyScene','_exportScene']:
    print(f"  {fn}: {'OK' if fn in txt else 'MISSING'}")

print(f"{changes}/7 applied. Size: {len(txt)} chars")
