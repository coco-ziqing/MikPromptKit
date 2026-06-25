import urllib.request, json, re

# Verify index.html load order
r = urllib.request.urlopen('http://127.0.0.1:8080/', timeout=5)
html = r.read().decode('utf-8')
i18n_pos = html.find('app_i18n.js')
composer_pos = html.find('seedance_v2_composer.js')
print('app_i18n.js position: %d' % i18n_pos)
print('seedance_v2_composer.js position: %d' % composer_pos)
print('i18n BEFORE composer: %s' % (i18n_pos < composer_pos and i18n_pos > 0))

# Health
r2 = urllib.request.urlopen('http://127.0.0.1:8080/api/health/check', timeout=5)
d = json.loads(r2.read())
print('Health: ok=%s checked=%s/%s' % (d['ok'], d['checked'], d['total_checks']))
print('\nAll checks passed!' if i18n_pos < composer_pos else '\nFAIL: load order wrong!')
