"""
提示词模板变量 API
解析 {{variable}} 语法并支持运行时替换
"""
import re
from fastapi import APIRouter
from pydantic import BaseModel

router = APIRouter(prefix="/api/v2/templates", tags=["templates"])

VARIABLE_PATTERN = re.compile(r'\{\{(\w+)\}\}')


@router.post("/parse")
def parse_template(data: dict):
    """解析提示词中的变量"""
    content = data.get("content", "")
    if not content:
        return {"ok": True, "variables": [], "preview": ""}
    
    variables = sorted(set(VARIABLE_PATTERN.findall(content)))
    
    # 生成预览（变量名替换为高亮占位符）
    preview = content
    for v in variables:
        preview = preview.replace("{{" + v + "}}", "[" + v + "]")
    
    return {
        "ok": True,
        "variables": [{"name": v, "default": "", "description": ""} for v in variables],
        "preview": preview
    }


class RenderRequest(BaseModel):
    content: str
    values: dict = {}


@router.post("/render")
def render_template(data: RenderRequest):
    """替换变量并返回渲染结果"""
    content = data.content
    values = data.values or {}
    
    # 替换所有 {{variable}} 为传入的值
    def _replace(m):
        name = m.group(1)
        return values.get(name, "{{" + name + "}}")
    
    rendered = VARIABLE_PATTERN.sub(_replace, content)
    
    # 检查是否有未替换的变量
    remaining = VARIABLE_PATTERN.findall(rendered)
    
    return {
        "ok": True,
        "rendered": rendered,
        "has_unfilled": len(remaining) > 0,
        "unfilled": list(set(remaining))
    }
