with open('frontend/static/js/app_core.js', 'r', encoding='utf-8') as f:
    content = f.read()

old = "if (hs) hs.textContent = v + ' | 词库 ' + (d.total_prompts||0) + ' 条 | 使用 ' + (d.total_usage||0) + ' 次'"
new = "if (hs) hs.textContent = v.replace('v', '') + ' | 词库 ' + (d.total_prompts||0) + ' 条 | 使用 ' + (d.total_usage||0) + ' 次'"
content = content.replace(old, new)

with open('frontend/static/js/app_core.js', 'w', encoding='utf-8') as f:
    f.write(content)
print('Done')
