# -*- coding: utf-8 -*-
"""Test with thinking model workaround - increase token budget + switch model"""
import httpx, json, asyncio

PROMPT = "Decompose this into JSON atoms: a majestic dragon soaring through golden clouds at sunset, cinematic lighting, 8K photorealistic, epic scale"
SYSTEM = "You are a prompt decomposition expert. Return ONLY a JSON array. Fields: id, type, text, keywords, weight. NO markdown, NO explanation. JUST the array."

async def test():
    async with httpx.AsyncClient(timeout=120) as cli:
        # Fix 1: Use qwen3.5:4b (non-thinking, faster)
        print("=== Fix 1: qwen3.5:4b with 2000 tokens ===")
        payload = {
            "model": "qwen3.5:4b",
            "messages": [
                {"role": "system", "content": SYSTEM},
                {"role": "user", "content": PROMPT}
            ],
            "stream": False,
            "options": {"temperature": 0.3, "num_predict": 2000}
        }
        r = await cli.post("http://127.0.0.1:11434/api/chat", json=payload)
        data = r.json()
        content = data.get("message", {}).get("content", "")
        thinking = data.get("message", {}).get("thinking", "")
        print(f"status={r.status_code} think_len={len(thinking)} content_len={len(content)}")
        print(f"CONTENT: {content[:400]}")
        
        # Fix 2: qwen3.5:9b with 4000 tokens
        print("\n=== Fix 2: qwen3.5:9b with 4000 tokens ===")
        payload2 = {
            "model": "qwen3.5:9b",
            "messages": [
                {"role": "system", "content": SYSTEM},
                {"role": "user", "content": PROMPT}
            ],
            "stream": False,
            "options": {"temperature": 0.3, "num_predict": 4000}
        }
        r = await cli.post("http://127.0.0.1:11434/api/chat", json=payload2)
        data = r.json()
        content = data.get("message", {}).get("content", "")
        thinking = data.get("message", {}).get("thinking", "")
        print(f"think_len={len(thinking)} content_len={len(content)}")
        print(f"CONTENT: {content[:400]}")
        
        # Fix 3: phi4 non-thinking model
        print("\n=== Fix 3: phi4 (non-thinking) ===")
        payload3 = {
            "model": "phi4:latest",
            "messages": [
                {"role": "system", "content": SYSTEM},
                {"role": "user", "content": PROMPT}
            ],
            "stream": False,
            "options": {"temperature": 0.2, "num_predict": 1000}
        }
        r = await cli.post("http://127.0.0.1:11434/api/chat", json=payload3)
        data = r.json()
        content = data.get("message", {}).get("content", "")
        print(f"content_len={len(content)}")
        print(f"CONTENT: {content[:400]}")

asyncio.run(test())
