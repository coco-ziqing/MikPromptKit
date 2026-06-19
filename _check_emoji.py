with open('frontend/static/js/app_editor.js', 'rb') as f:
    data = f.read()

target = b'\xe5\x85\xa8\xe9\x83\xa8\xe8\xaf\x8d\xe5\xba\x93'
idx = data.find(target)
if idx > 0:
    chunk = data[idx-40:idx+20]
    print('全部词库:', chunk)

# 检查 '' 占位
two_q = b"??"
count_q = 0
pos = 0
while True:
    pos = data.find(two_q, pos)
    if pos < 0: break
    count_q += 1
    print(f'?? at byte {pos}: {data[max(0,pos-10):pos+15]}')
    pos += 1

print(f'\nTotal ?? occurrences: {count_q}')
