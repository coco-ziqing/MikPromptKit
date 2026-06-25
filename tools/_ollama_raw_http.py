# -*- coding: utf-8 -*-
"""Raw Ollama HTTP test - bypass all wrappers"""
import httpx, json, asyncio

SYSTEM = "You are a prompt decomposition expert. Decompose the given prompt into structured atoms. Return ONLY a JSON array (no markdown, no explanation) with fields: id, type, text, keywords, weight."

PROMPT = "a majestic dragon soaring through golden clouds at sunset, cinematic lighting, 8K photorealistic"

async def test():
    async with httpx.AsyncClient(timeout=120) as cli:
        # Test 1: /api/chat
        print("=== Test 1: /api/chat ===")
        payload = {
            "model": "qwen3.5:9b",
            "messages": [
                {"role": "system", "content": SYSTEM},
                {"role": "user", "content": f"Decompose this: {PROMPT}"}
            ],
            "stream": False,
            "options": {"temperature": 0.3, "num_predict": 400}
        }
        r = await cli.post("http://127.0.0.1:11434/api/chat", json=payload)
        data = r.json()
        content = data.get("message", {}).get("content", "")
        print(f"status={r.status_code} content_len={len(content)}")
        print(f"RAW: {content[:300]}")
        print(f"FULL: {json.dumps(data, indent=2, default=str)[:500]}")
        
        # Test 2: /api/generate
        print("\n=== Test 2: /api/generate ===")
        payload2 = {
            "model": "qwen3.5:9b",
            "prompt": f"{SYSTEM}\n\nUser: {PROMPT}\n\nAssistant (JSON array only):",
            "system": SYSTEM,
            "stream": False,
            "options": {"temperature": 0.3, "num_predict": 400}
        }
        r = await cli.post("http://127.0.0.1:11434/api/generate", json=payload2)
        data = r.json()
        response = data.get("response", "")
        print(f"status={r.status_code} response_len={len(response)}")
        print(f"RAW: {response[:300]}")

        # Test 3: simplest possible prompt
        print("\n=== Test 3: Simple prompt ===")
        payload3 = {
            "model": "qwen3.5:9b",
            "prompt": "Say exactly this: HELLO_WORLD",
            "stream": False,
            "options": {"temperature": 0, "num_predict": 20}
        }
        r = await cli.post("http://127.0.0.1:11434/api/generate", json=payload3)
        data = r.json()
        print(f"response: '{data.get('response','')}' eval_count={data.get('eval_count','?')}")

asyncio.run(test())
