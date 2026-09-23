#!/usr/bin/env python3
"""Interactive Telegram authentication script for Telethon (MTProto).

Authenticates with Telegram using the user's API credentials and saves
the resulting StringSession to .env.local for both the repo and the running worker.
"""

import os
import re
import sys
from pathlib import Path

# Repository root
REPO_ROOT = Path(__file__).resolve().parent.parent
ENV_LOCAL_PATH = REPO_ROOT / ".env.local"
WORKER_ENV_PATH = Path.home() / "Library/Application Support/sentiment-worker/checkout/.env.local"


def load_env_credentials():
    api_id = os.environ.get("TELEGRAM_API_ID")
    api_hash = os.environ.get("TELEGRAM_API_HASH")

    if not (api_id and api_hash) and ENV_LOCAL_PATH.exists():
        content = ENV_LOCAL_PATH.read_text(encoding="utf-8")
        m_id = re.search(r"^TELEGRAM_API_ID\s*=\s*['\"]?(\d+)['\"]?", content, re.MULTILINE)
        m_hash = re.search(r"^TELEGRAM_API_HASH\s*=\s*['\"]?([a-f0-9]+)['\"]?", content, re.MULTILINE)
        if m_id:
            api_id = m_id.group(1)
        if m_hash:
            api_hash = m_hash.group(1)

    return api_id, api_hash


def save_session_to_env(file_path: Path, session_str: str):
    if not file_path.exists():
        return
    content = file_path.read_text(encoding="utf-8")
    if "TELEGRAM_SESSION_STRING=" in content:
        content = re.sub(
            r"^TELEGRAM_SESSION_STRING\s*=.*$",
            f"TELEGRAM_SESSION_STRING={session_str}",
            content,
            flags=re.MULTILINE,
        )
    else:
        content = content.rstrip() + f"\n\n# Telegram Authenticated Session\nTELEGRAM_SESSION_STRING={session_str}\n"

    file_path.write_text(content, encoding="utf-8")
    print(f"  [✓] Updated {file_path}")


def main():
    print("=" * 65)
    print("  ربط حساب تليجرام الموثق (Telegram MTProto Authentication)")
    print("=" * 65)

    api_id, api_hash = load_env_credentials()
    if not api_id or not api_hash:
        print("❌ خطأ: لم يتم العثور على TELEGRAM_API_ID أو TELEGRAM_API_HASH في .env.local")
        sys.exit(1)

    print(f"  المعرف (API ID): {api_id}")
    print(f"  المفتاح (API Hash): {api_hash[:6]}...{api_hash[-4:]}")
    print("-" * 65)

    try:
        from telethon.sync import TelegramClient
        from telethon.sessions import StringSession
    except ImportError:
        print("❌ Telethon غير مثبت. يرجى تثبيته عبر: uv add telethon")
        sys.exit(1)

    session = StringSession()
    client = TelegramClient(session, int(api_id), api_hash)

    print("\nسيتم الآن تسجيل الدخول. يرجى إدخال رقم هاتفك الدولي عند الطلب:")
    print("(مثال: +966501234567 أو +970591234567)")
    print("ثم إدخال الرمز الذي سيصلك داخل تطبيق تليجرام.\n")

    client.start()

    session_str = client.session.save()
    me = client.get_me()

    name = f"{me.first_name or ''} {me.last_name or ''}".strip()
    username = f"@{me.username}" if me.username else me.phone

    print("\n" + "=" * 65)
    print(f"  ✅ تم تسجيل الدخول بنجاح كـ: {name} ({username})")
    print("=" * 65)

    # Save to local repo .env.local
    save_session_to_env(ENV_LOCAL_PATH, session_str)

    # Save to background worker .env.local if present
    if WORKER_ENV_PATH.exists():
        save_session_to_env(WORKER_ENV_PATH, session_str)

    print("\nجاري اختبار جلب تعليقات من قناة @warlife3...")
    try:
        channel = client.get_entity("warlife3")
        messages = client.get_messages(channel, limit=3)
        print(f"  [✓] تم الوصول للقناة بنجاح! تم فحص آخر {len(messages)} منشورات.")
        for msg in messages:
            comments = list(client.iter_messages(channel, reply_to=msg.id, limit=5))
            replies_cnt = msg.replies.replies if msg.replies else len(comments)
            print(f"    - منشور #{msg.id}: {replies_cnt} تعليق.")
    except Exception as e:
        print(f"  [!] ملاحظة أثناء الاختبار: {e}")

    print("\n🎉 تم الإعداد بنجاح! المشغل جاهز الآن لسحب كافة التعليقات والنقاشات المقيدة.")


if __name__ == "__main__":
    main()
