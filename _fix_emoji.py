with open('frontend/static/js/app_editor.js', 'rb') as f:
    data = f.read()

old = b"'??'"
new = b"'" + b'\xf0\x9f\x93\x9a' + b"'"
data = data.replace(old, new)

with open('frontend/static/js/app_editor.js', 'wb') as f:
    f.write(data)
print('Done, remaining:', data.count(old))
