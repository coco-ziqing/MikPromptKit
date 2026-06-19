import urllib.request
html = urllib.request.urlopen('http://127.0.0.1:8080/').read().decode('utf-8')
idx = html.find('viewWCManager')
if idx > 0:
    seg = html[idx:idx+600]
    print(seg.encode('ascii', 'replace').decode('ascii'))
else:
    print('MISS: viewWCManager')
checks = ['wcGrid', 'wcGroupBar', 'wcSearch', 'wcGroupFilter', 'wcPagination']
for c in checks:
    if c in html:
        print('OK:', c)
    else:
        print('MISS:', c)
