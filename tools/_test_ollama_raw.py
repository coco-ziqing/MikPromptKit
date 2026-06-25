"""Direct Ollama call test - bypass atoms.py, see raw output"""
import sys, os, asyncio
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'backend'))
from ollama_client import ollama_chat, ollama_generate

async def test():
    prompt = "Decompose this into JSON atoms: a majestic dragon soaring through golden clouds at sunset, cinematic lighting, 8K photorealistic, epic scale, rim light, volumetric fog"
    system = """You are a prompt decomposition expert. Decompose the given prompt into structured atoms.
Return ONLY a JSON array (no markdown, no explanation). Each element:
  id: uuid string
  type: creative|style|composition|constraint|tone|negative|quality|subject|lighting|color|action|camera|atmosphere
  text: extracted phrase (under 15 words)
  keywords: array of 1-3 keywords
  weight: 0.0-1.0 (higher = more important)
DO NOT include any text before or after the JSON array. Output ONLY the array."""

    print("=== Testing ollama_chat ===")
    try:
        result = await ollama_chat(
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": prompt}
            ],
            function="optimize_fast",
            temperature=0.3,
            max_tokens=500,
            timeout_s=60
        )
        print(f"ok={result.get('ok')}")
        if result.get('ok'):
            content = result.get('content', '')
            print(f"RAW OUTPUT ({len(content)} chars):")
            print(content[:500])
        else:
            print(f"error: {result.get('error')}")
    except Exception as e:
        print(f"Exception: {e}")

    print("\n=== Testing ollama_generate (fallback) ===")
    try:
        result = await ollama_generate(
            prompt=prompt,
            system=system,
            function="optimize_fast",
            temperature=0.3,
            max_tokens=500,
            timeout_s=60
        )
        print(f"ok={result.get('ok')}")
        if result.get('ok'):
            print(f"RAW ({len(result.get('content',''))} chars): {result.get('content','')[:500]}")
        else:
            print(f"error: {result.get('error')}")
    except Exception as e:
        print(f"Exception: {e}")

asyncio.run(test())
