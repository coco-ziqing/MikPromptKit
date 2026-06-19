import urllib.request
js = urllib.request.urlopen('http://127.0.0.1:8080/static/js/app_core.js').read().decode('utf-8')
idx = js.find("view === 'wcmanager'")
if idx > 0:
    print('wcmanager分支:', js[idx:idx+400])
else:
    print('wcmanager处理不存在')
    # 检查viewWCManager是否在HTML中而不是由JS创建
