# -*- coding: utf-8 -*-
"""冒烟测试：app 装配 / 路由注册 / 健康检查 / 核心 API（Phase 3.3）

离线可跑（TestClient + 临时数据目录），无需启动真实服务。
运行：python -m pytest backend/tests -v
"""
import pytest


class TestAppAssembly:
    """app 装配完整性"""

    def test_openapi_has_many_paths(self, openapi_paths):
        """50 个 router 收敛后路径应远大于 100"""
        assert len(openapi_paths) > 100

    def test_core_router_groups(self, openapi_paths):
        """核心业务域路由必须注册"""
        for prefix in [
            "/api/v4/word-cards",
            "/api/auth",
            "/api/dam",
            "/api/license",
            "/api/health",
            "/api/prompts",
            "/api/seedance",
            "/api/presence",
            "/api/logs",
            "/api/v2/comfyui",
        ]:
            assert any(p.startswith(prefix) for p in openapi_paths), f"missing router: {prefix}"


class TestHealth:
    def test_health_check(self, client):
        r = client.get("/api/health/check")
        assert r.status_code == 200
        data = r.json()
        # ok 在有 warning 时可为 False，核心是结构完整
        assert "results" in data
        assert data.get("total_checks", 0) > 0

    def test_health_db(self, client):
        r = client.get("/api/health/check/db")
        assert r.status_code == 200

    def test_health_port(self, client):
        r = client.get("/api/health/check/port")
        assert r.status_code == 200
        data = r.json()
        assert data["result"]["ok"] is True


class TestCoreApi:
    def test_index_html(self, client):
        r = client.get("/")
        assert r.status_code == 200
        assert "PromptKit" in r.text or "Mik" in r.text or "<!DOCTYPE" in r.text

    def test_static_js(self, client):
        r = client.get("/static/js/app_core.js")
        assert r.status_code == 200

    def test_word_cards_list(self, client):
        r = client.get("/api/v4/word-cards", params={"page": 1, "page_size": 5})
        assert r.status_code == 200
        data = r.json()
        assert "items" in data or "total" in data or isinstance(data, list)

    def test_auth_login_admin(self, client):
        """种子数据应包含 admin/admin"""
        r = client.post("/api/auth/login", json={"username": "admin", "password": "admin"})
        assert r.status_code == 200
        data = r.json()
        assert data.get("ok") is True or "token" in str(data).lower() or "access_token" in data
