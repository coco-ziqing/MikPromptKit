import urllib.request, json
r = urllib.request.urlopen('http://127.0.0.1:8081/api/seedance/v2/projects/1')
d = json.loads(r.read())
print('项目:', d.get('project',{}).get('name'))
print('镜头数:', len(d.get('scenes',[])))
for s in d.get('scenes',[])[:3]:
    print('  镜头', s['scene_order'], ':', s.get('camera_move','')[:20] or '(空)')
