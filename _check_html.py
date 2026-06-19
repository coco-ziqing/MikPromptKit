import urllib.request, re
r = urllib.request.urlopen('http://127.0.0.1:8081/')
html = r.read().decode()
scripts = re.findall(r'<script src="([^"]+)"', html)
print('\n'.join(scripts))
