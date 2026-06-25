"""Debug 405 - raw http response"""
import http.client, json

conn = http.client.HTTPConnection("127.0.0.1", 8088, timeout=10)
body = json.dumps({"prompt":"test abc","media_type":"image"})
conn.request("POST", "/api/v4/atoms/decompose", body=body, headers={"Content-Type": "application/json"})
r = conn.getresponse()
print(f"Status: {r.status} {r.reason}")
print(f"Headers: {dict(r.getheaders())}")
data = r.read().decode()
print(f"Body: {data[:500]}")
conn.close()

# Also try decompose/text
conn = http.client.HTTPConnection("127.0.0.1", 8088, timeout=10)
body2 = json.dumps({"text":"test abc","source_type":"manual","media_type":"image"})
conn.request("POST", "/api/v4/atoms/decompose/text", body2, headers={"Content-Type": "application/json"})
r2 = conn.getresponse()
print(f"\nText decompose: {r2.status} {r2.reason}")
data2 = r2.read().decode()
print(f"Body: {data2[:300]}")
conn.close()
