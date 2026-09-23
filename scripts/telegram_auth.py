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
    session_str = os.environ.get("TELEGRAM_SESSION_STRING")

    if ENV_LOCAL_PATH.exists():
        content = ENV_LOCAL_PATH.read_text(encoding="utf-8")
        if not api_id:
            m_id = re.search(r"^TELEGRAM_API_ID\s*=\s*['\"]?(\d+)['\"]?", content, re.MULTILINE)
            if m_id:
                api_id = m_id.group(1)
        if not api_hash:
            m_hash = re.search(r"^TELEGRAM_API_HASH\s*=\s*['\"]?([a-f0-9]+)['\"]?", content, re.MULTILINE)
            if m_hash:
                api_hash = m_hash.group(1)
        if not session_str:
            m_sess = re.search(r"^TELEGRAM_SESSION_STRING\s*=\s*(.+)$", content, re.MULTILINE)
            if m_sess:
                session_str = m_sess.group(1).strip()

    return api_id, api_hash, session_str


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

    api_id, api_hash, existing_session_str = load_env_credentials()
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

    session = StringSession(existing_session_str or "")
    client = TelegramClient(session, int(api_id), api_hash)
    client.connect()

    if not client.is_user_authorized():
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
        messages = client.get_messages(channel, limit=10)
        print(f"  [✓] تم الوصول للقناة بنجاح! تم فحص آخر {len(messages)} منشورات.")
        tested_replies = 0
        for msg in messages:
            if not msg.text:
                continue
            if msg.replies and msg.replies.replies > 0:
                comments = list(client.iter_messages(channel, reply_to=msg.id, limit=3))
                print(f"    - منشور #{msg.id} ({msg.text[:35]}...): تم جلب {len(comments)} تعليقات تجريبية (الإجمالي: {msg.replies.replies})")
                tested_replies += 1
                if tested_replies >= 2:
                    break
            else:
                print(f"    - منشور #{msg.id}: التعليقات غير مفعلة على هذا المنشور.")
    except Exception as e:
        print(f"  [!] ملاحظة أثناء الاختبار: {e}")

    print("\n🎉 تم الإعداد بنجاح! المشغل جاهز الآن لسحب كافة التعليقات والنقاشات المقيدة.")


if __name__ == "__main__":
    main()
