"""Verify fix: check index.html serves correct content (no // <!--)"""
import urllib.request, json

# Check health
r = urllib.request.urlopen("http://127.0.0.1:8080/api/health/check", timeout=5)
data = json.loads(r.read())
print(f"health: ok={data.get('ok','?')}")

# Check JS files load correctly
for js_file in ["atom_editor.js?v=1", "app_core.js?v=13.1"]:
    try:
        r = urllib.request.urlopen(f"http://127.0.0.1:8080/static/js/{js_file}", timeout=5)
        print(f"  {js_file}: {r.status} ({len(r.read())} bytes)")
    except Exception as e:
        print(f"  {js_file}: FAIL - {e}")

# Verify the HTML comment fix
r = urllib.request.urlopen("http://127.0.0.1:8080/", timeout=5)
html = r.read().decode("utf-8")
# Check no orphan JS comment before script tags
problematic = "// <!-- Phase15: wc_bridge"
if problematic in html:
    print("\n[FAIL] Old broken comment still in index.html!")
else:
    print("\n[OK] index.html fix confirmed - no '// <!--' comment")
    
# Check the wc_bridge script tag is valid
if '<!-- Phase15: wc_bridge' in html and '<script src="/static/js/wc_bridge.js' in html:
    print("[OK] wc_bridge script tag correctly placed")

# Verify atom_editor loaded
if '<script src="/static/js/atom_editor.js' in html:
    print("[OK] atom_editor.js script tag present")

print("\n[READY] Refresh browser with Ctrl+Shift+R to clear cache")
