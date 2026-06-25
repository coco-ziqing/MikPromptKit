"""Kill all uvicorn processes + free ports 8080-8089"""
import subprocess, os, socket, time

# 1. Find PIDs on ports 8080-8089
pids = set()
for port in range(8080, 8090):
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        s.settimeout(0.5)
        s.bind(("0.0.0.0", port))
        s.close()
    except:
        try:
            result = subprocess.run(["netstat", "-ano"], capture_output=True, text=True, timeout=10)
            for line in result.stdout.split("\n"):
                if f":{port}" in line and "LISTENING" in line:
                    parts = line.strip().split()
                    if parts:
                        pid = parts[-1]
                        if pid.isdigit():
                            pids.add(pid)
        except: pass

print(f"PIDs on 8080-8089: {pids}")

# 2. Kill them
for pid in pids:
    try:
        subprocess.run(["taskkill", "/F", "/PID", pid], capture_output=True, timeout=5)
        print(f"Killed PID {pid}")
    except Exception as e:
        print(f"Failed to kill {pid}: {e}")

time.sleep(2)

# 3. Verify ports free
free = 0
for port in range(8080, 8090):
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        s.settimeout(0.5)
        s.bind(("0.0.0.0", port))
        s.close()
        free += 1
    except:
        pass
print(f"\nFree ports: {free}/10 (8080-8089)")
print("OK - ready to start" if free > 0 else "FAIL - still occupied")
