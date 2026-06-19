with open('frontend/static/js/app_editor.js', 'r', encoding='utf-8') as f:
    content = f.read()

# 直接替换所有 ?? 为 📚
content = content.replace('??', '\U0001f4da')

with open('frontend/static/js/app_editor.js', 'w', encoding='utf-8') as f:
    f.write(content)
print('Fixed')
