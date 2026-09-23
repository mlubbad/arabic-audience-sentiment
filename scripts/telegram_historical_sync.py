#!/usr/bin/env python3
"""Historical sync and backfill tool for Telegram channels and supergroups.

Fetches historical posts via Telethon MTProto, populates public.videos,
and optionally selects them for sentiment collection.

Usage:
    uv --directory workers/python run python ../../scripts/telegram_historical_sync.py --handle @Istanbul_N23 --limit 500 --auto-select
"""
import argparse
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
import httpx
from telethon.sync import TelegramClient
from telethon.sessions import StringSession
from telethon.tl.functions.channels import GetFullChannelRequest


def load_env():
    """Load SUPABASE_* and TELEGRAM_* from .env.local or root .env."""
    env_paths = [
        Path(".env.local"),
        Path("../.env.local"),
        Path("../../.env.local"),
        Path(".env"),
        Path("../.env"),
        Path("../../.env"),
    ]
    env = {}
    for p in env_paths:
        if p.is_file():
            for line in p.read_text(encoding="utf-8").splitlines():
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    k, v = line.split("=", 1)
                    k = k.strip()
                    v = v.strip().strip("'\"")
                    if k not in env:
                        env[k] = v
    for k, v in env.items():
        if k not in os.environ:
            os.environ[k] = v
    return env


def main():
    parser = argparse.ArgumentParser(description="Sync historical Telegram posts into database.")
    parser.add_argument("--handle", required=True, help="Telegram handle (e.g., @Istanbul_N23 or Istanbul_N23)")
    parser.add_argument("--limit", type=int, default=500, help="Maximum number of historical posts to fetch (default: 500)")
    parser.add_argument("--auto-select", action="store_true", help="Automatically select all imported posts for collection")
    args = parser.parse_args()

    load_env()

    sb_url = os.environ.get("SUPABASE_URL")
    sb_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not sb_url or not sb_key:
        print("Error: Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment.", file=sys.stderr)
        sys.exit(1)

    tg_id = os.environ.get("TELEGRAM_API_ID")
    tg_hash = os.environ.get("TELEGRAM_API_HASH")
    tg_sess = os.environ.get("TELEGRAM_SESSION_STRING")
    if not tg_id or not tg_hash or not tg_sess:
        print("Error: Telegram MTProto credentials missing (TELEGRAM_API_ID, TELEGRAM_API_HASH, TELEGRAM_SESSION_STRING).", file=sys.stderr)
        sys.exit(1)

    clean_handle = args.handle.lstrip("@").strip()
    headers = {
        "apikey": sb_key,
        "Authorization": f"Bearer {sb_key}",
        "Content-Type": "application/json",
        "Prefer": "return=representation",
    }

    # 1. Lookup channel in public.channels
    with httpx.Client(base_url=sb_url, headers=headers, timeout=20.0) as http:
        resp = http.get(f"/rest/v1/channels?handle=ilike.*{clean_handle}*")
        channels = resp.json()
        if not channels:
            print(f"Error: Channel with handle matching '{clean_handle}' not found in database.", file=sys.stderr)
            sys.exit(1)
        channel = channels[0]
        channel_db_id = channel["id"]
        workspace_id = channel["workspace_id"]
        print(f"Found Channel: {channel.get('title')} ({channel.get('handle')})")
        print(f"Channel ID: {channel_db_id}, Workspace ID: {workspace_id}")

        # 2. Fetch messages via Telethon
        print(f"\nConnecting to Telegram MTProto...")
        with TelegramClient(StringSession(tg_sess), int(tg_id), tg_hash) as tg:
            entity = tg.get_entity(clean_handle)
            is_megagroup = getattr(entity, "megagroup", False)
            is_broadcast = getattr(entity, "broadcast", False)
            has_discussion = is_megagroup
            if is_broadcast:
                try:
                    full = tg(GetFullChannelRequest(entity))
                    has_discussion = bool(getattr(getattr(full, "full_chat", None), "linked_chat_id", None))
                except Exception as e:
                    print(f"Warning: could not fetch full channel info: {e}")
                    has_discussion = True

            chat_type = "Supergroup" if is_megagroup else ("Broadcast Channel" if is_broadcast else "Chat")
            print(f"Entity: {getattr(entity, 'title', clean_handle)} | Type: {chat_type} | Comments Allowed: {has_discussion}")
            print(f"Fetching up to {args.limit} posts...")

            fetched_messages = []
            for msg in tg.iter_messages(entity, limit=args.limit):
                if getattr(msg, "id", None):
                    fetched_messages.append(msg)

            print(f"Successfully retrieved {len(fetched_messages)} messages from Telegram.")

        # 3. Format and upsert into public.videos in batches of 100
        now_iso = datetime.now(timezone.utc).isoformat()
        records_to_upsert = []
        for m in fetched_messages:
            msg_text = getattr(m, "message", "") or getattr(m, "text", "") or ""
            first_line = msg_text.strip().split("\n")[0] if msg_text else f"منشور {m.id}"
            replies_obj = getattr(m, "replies", None)
            comment_count = getattr(replies_obj, "replies", 0) if replies_obj else 0
            comments_state = "open" if has_discussion else "disabled"
            pub_date = m.date.isoformat() if getattr(m, "date", None) else now_iso

            records_to_upsert.append({
                "workspace_id": workspace_id,
                "channel_id": channel_db_id,
                "platform": "telegram",
                "external_video_id": str(m.id),
                "title": first_line[:120],
                "kind": "channel_post",
                "published_at": pub_date,
                "last_observed_at": now_iso,
                "catalogued_at": now_iso,
                "reported_comment_count": comment_count,
                "comments_state": comments_state,
                "field_provenance": {"source": "telegram_mtproto", "channel": clean_handle},
            })

        print(f"Upserting {len(records_to_upsert)} posts into public.videos...")
        batch_size = 100
        total_upserted = 0
        all_upserted_ids = []
        for i in range(0, len(records_to_upsert), batch_size):
            chunk = records_to_upsert[i : i + batch_size]
            upsert_headers = dict(headers)
            upsert_headers["Prefer"] = "resolution=merge-duplicates,return=representation"
            resp = http.post(
                "/rest/v1/videos?on_conflict=workspace_id,platform,external_video_id",
                headers=upsert_headers,
                json=chunk,
            )
            if resp.status_code not in (200, 201):
                print(f"Error upserting chunk {i}: {resp.status_code} {resp.text}", file=sys.stderr)
            else:
                data = resp.json()
                total_upserted += len(data)
                for item in data:
                    all_upserted_ids.append(item["id"])
                print(f"  Saved {total_upserted}/{len(records_to_upsert)} posts...")

        # Update channel catalogued_at
        http.patch(
            f"/rest/v1/channels?id=eq.{channel_db_id}",
            json={"catalogued_at": now_iso},
        )
        print("Channel catalogued_at timestamp updated.")

        # 4. Auto-select if requested
        if args.auto_select and all_upserted_ids:
            print(f"\nAuto-selecting {len(all_upserted_ids)} posts for sentiment collection...")
            ws_resp = http.get(f"/rest/v1/workspaces?id=eq.{workspace_id}")
            ws_owner = ws_resp.json()[0].get("created_by") if ws_resp.status_code == 200 and ws_resp.json() else None

            sel_records = [
                {
                    "workspace_id": workspace_id,
                    "channel_id": channel_db_id,
                    "video_id": vid,
                    "selected_by": ws_owner,
                }
                for vid in all_upserted_ids
            ]
            sel_headers = dict(headers)
            sel_headers["Prefer"] = "resolution=merge-duplicates"
            for i in range(0, len(sel_records), 100):
                chunk = sel_records[i : i + 100]
                resp = http.post(
                    "/rest/v1/video_selections?on_conflict=workspace_id,video_id",
                    headers=sel_headers,
                    json=chunk,
                )
                if resp.status_code not in (200, 201):
                    print(f"Selection error: {resp.status_code} {resp.text}")
            print(f"Successfully selected {len(all_upserted_ids)} posts for collection.")

        print(f"\nDone! Successfully synchronized {total_upserted} posts for @{clean_handle}.")


if __name__ == "__main__":
    main()
