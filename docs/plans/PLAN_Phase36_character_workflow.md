# Phase36 设计方案 — 角色设定模版化 · 总项目角色库 · 分镜调用

> 状态：待确认（设计稿）　生成：2026-07-14
> 需求：角色组装器基于「角色设定模版 + 基础词卡/自定义」拼装角色 → 存入总项目角色库 → 分镜组装器读取该总项目角色 → 组成分镜动态提示词。

---

## 1. 现状（代码级）
| 组件 | 数据 | 说明 |
|------|------|------|
| 角色组装器 | `character_profiles`(4) via `/api/character-composer/*` | 结构化角色设定，`settings_json`={gender,age,hairstyle,facial,expression,clothing,pose,style,background,lighting,color_scheme,quality}+派生富字段。**全局**(project_id 多为0) |
| 角色库(前端 characterLib) | `/api/characters` | 分镜镜头卡取全局角色列表 |
| 分镜组装器 | `user_project_scene.character_id` | 每镜头绑定一个角色（现取**全局**角色池） |
| 项目看板 角色页(P2) | `master_asset`(asset_type=character, 2条) via `/master/{id}/assets` | 通用键值资产(name/desc/content/image)，**与 character_profiles 割裂** |
| 模版 | `project_templates`(0, 空) | 仅桩，未用 |

**核心问题**：存在两套并行角色系统（全局 `character_profiles` ↔ 每项目 `master_asset`），互不联通；无「角色设定模版」；分镜取全局池而非「本总项目角色」。

---

## 2. 目标工作流（映射到实现）
```
[角色设定模版库] --选模版--> [角色组装器]
     调用基础词卡 / 自定义编辑（在模版框架下填槽）
                 --保存--> [character_profiles]（全局角色库，带 template_id）
[总项目] --选取/新建--> [本项目角色库]（项目↔角色 绑定）
[分镜组装器(属于某总项目)] --读取本项目角色--> 每镜头绑定 --> 分镜动态提示词
```

## 3. 建议架构（统一到 character_profiles + 新增两层）

### 3.1 数据模型（新增/改造）
```
character_template (新增：角色设定模版库)
  id, name, description,
  structure_json,        -- 框架槽位定义：有序字段 [{key,label,wordcard_group_id?,placeholder}]
  is_builtin, owner_user_id, created_at, updated_at

character_profiles (改造)
  + template_id INTEGER  -- 来源模版（可空）
  （settings_json 保持；按模版 structure_json 的槽位组织）

master_project_character (新增：总项目↔角色 多对多选取)
  id, master_project_id, character_id, sort_order, added_at
  UNIQUE(master_project_id, character_id)
```
> master_asset(character) 逐步弃用/桥接：项目看板角色页改读 `master_project_character → character_profiles`。

### 3.2 后端 API
- 模版：`GET/POST/PUT/DELETE /api/character-templates`（系统内置 + 自定义；structure_json）
- 组装器：`POST /characters` 增加 `template_id`；按模版槽位保存 settings_json（已有互通逻辑复用）
- 项目角色库：`GET /api/master/{mid}/characters`（本项目已选角色）/ `POST`（从全局库选取加入 {character_id}）/ `POST .../new`（新建并加入）/ `DELETE .../{character_id}`（移出，不删全局）
- 分镜取数：分镜镜头角色选择器改用 `GET /api/master/{mid}/characters`（该 seedance 项目所属总项目）；无绑定则回退全局

### 3.3 前端
- **角色组装器**：顶部「角色设定模版」选择器 → 按模版 structure_json 渲染槽位；每槽「调用词卡」(从绑定词卡分组挑) / 自定义输入 → 实时拼 settings_json → 保存（可回写模版）。
- **项目看板 角色页(P2)**：改为「本项目角色库」——网格显示已选角色 + 「＋ 从角色库选取」弹窗（多选全局角色）+ 「＋ 新建角色」(打开组装器，存后自动加入本项目)。
- **分镜组装器**：镜头卡「出演角色」下拉改列**本总项目角色**（该 seedance 项目关联的 master_project）。

## 4. 分期
- **36.1 模版库 + 组装器接模版**：character_template 表/CRUD + 组装器模版选择&槽位渲染 + 系统内置 1-2 套模版（写实/动漫）。
- **36.2 总项目角色库**：master_project_character 绑定 + 项目看板角色页改造（选取/新建/移出）+ master_asset(character) 桥接迁移。
- **36.3 分镜按项目取角色**：镜头角色选择器改本项目角色 + 回退全局 + 分镜动态提示词合成校验。

## 5. 边界/风险
- 不重写分镜合成核心，仅改「角色取数来源」。
- master_asset(character) 迁移需平滑（2 条现存 → 映射到 character_profiles 或保留只读）。
- 「基础词卡→槽位」的映射需要词卡分组与角色槽位的对应关系（见待确认Q3）。

## 6. 待确认（拍板后开工）
1. **角色↔总项目绑定**：多对多「全局库 + 项目选取复用」(推荐) / 还是每项目独立拷贝一份互不影响？
2. **是否合并 master_asset(character)**：项目看板角色页统一改用 character_profiles（弃用旧 master_asset 角色冗余）？是/否。
3. **角色设定模版深度**：(a) 仅字段结构框架 / (b) 字段 + 每槽默认「词卡分组」绑定（点击即从该分组选词卡填入）。你要哪种？并请给一版你心目中的**角色设定框架字段清单**（现有 settings_json 已含 12 项：gender/age/hairstyle/facial/expression/clothing/pose/style/background/lighting/color_scheme/quality）。
