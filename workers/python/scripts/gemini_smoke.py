"""One request to Gemini with the configured key. Prints the HTTP status and
whether the JSON schema constraint was honoured; never prints the key or the URL."""
import json
import os
import sys

import httpx

MODEL = "gemini-2.5-flash"
BODY = {
    "contents": [{"role": "user", "parts": [{"text":
        "صنّف هذا التعليق إلى موضوع واحد من: question, praise, other.\n"
        "التعليق: ما اسم الأغنية في المقدمة؟\n"
        "أجب بصيغة JSON فقط."}]}],
    "generationConfig": {
        "temperature": 0,
        "responseMimeType": "application/json",
        "responseSchema": {
            "type": "ARRAY",
            "items": {
                "type": "OBJECT",
                "properties": {
                    "index": {"type": "INTEGER"},
                    "topic_key": {"type": "STRING", "enum": ["question", "praise", "other"]},
                    "confidence": {"type": "NUMBER"},
                },
                "required": ["index", "topic_key", "confidence"],
            },
        },
    },
}


def main() -> int:
    key = os.environ.get("GEMINI_API_KEY", "")
    if not key:
        print("GEMINI_API_KEY is not set")
        return 2
    r = httpx.post(
        f"https://generativelanguage.googleapis.com/v1beta/models/{MODEL}:generateContent",
        headers={"x-goog-api-key": key, "content-type": "application/json"},
        json=BODY,
        timeout=30,
    )
    print("status", r.status_code)
    if r.status_code != 200:
        # The error body names the restriction; it does not carry the key.
        print(json.dumps(r.json().get("error", {}), ensure_ascii=False)[:600])
        return 1
    text = r.json()["candidates"][0]["content"]["parts"][0]["text"]
    parsed = json.loads(text)
    print("schema honoured:", isinstance(parsed, list) and "topic_key" in parsed[0])
    print("verdict:", parsed[0])
    return 0


if __name__ == "__main__":
    sys.exit(main())
