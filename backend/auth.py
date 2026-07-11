@router.get("/me")
def whoami(request: Request):
    """获取当前用户 — 完全自包含 JWT 解析，不依赖任何外部模块"""
    token = None
    ah = request.headers.get("Authorization", "")
    if ah.startswith("Bearer "):
        token = ah[7:]
    else:
        token = request.cookies.get("pk_token", "")

    uid = 1
    authenticated = False

    if token and "." in token:
        try:
            parts = token.split(".")
            if len(parts) == 3:
                payload_b64 = parts[1]
                # URL-safe base64 decode
                payload_b64 = payload_b64 + "=" * (-len(payload_b64) % 4)
                payload_json = base64.urlsafe_b64decode(payload_b64)
                payload = json.loads(payload_json)
                if payload.get("exp", 0) > time.time():
                    uid = payload.get("user_id", 1)
                    authenticated = True
        except Exception:
            pass

    db = _ro()
    try:
        row = db.execute(
            "SELECT id, username, display_name, role, is_active, created_at, last_login_at FROM users WHERE id=?",
            [uid]).fetchone()
        if row:
            return {"ok": True, "authenticated": authenticated, "user": dict(row)}
    finally:
        db.close()

    return {"ok": True, "authenticated": authenticated,
            "user": {"id": uid, "username": "admin", "role": "admin"}}
