"""Standalone operator runner for collecting Telegram comments with sentiment analysis.

Claims collect jobs, collects discussion replies via Telethon MTProto,
runs CAMeLBERT sentiment analysis on each comment, and commits batches to Supabase.
"""
import os
import sys
import time
from pathlib import Path

# Add src to sys.path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "workers" / "python" / "src"))

import httpx


def load_env():
    env_file = Path(__file__).resolve().parent.parent / ".env.local"
    if not env_file.exists():
        return
    for line in env_file.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            k = k.strip()
            v = v.strip().strip('"').strip("'")
            if k not in os.environ:
                os.environ[k] = v


def main():
    load_env()
    target_handle = sys.argv[1] if len(sys.argv) > 1 else "Istanbul_N23"
    target_clean = target_handle.lstrip("@").lower()

    supabase_url = os.environ.get("SUPABASE_URL", "")
    worker_cred = os.environ.get("WORKER_CREDENTIAL")
    if not worker_cred:
        print(
            "WORKER_CREDENTIAL is required in the environment or .env.local.",
            file=sys.stderr,
        )
        return 2

    from server.gateway import ControlPlane
    from server.loop import build_collector
    from server.runner import _backfill
    from sentiment.transformer import load_pinned

    base_url = f"{supabase_url.rstrip('/')}/functions/v1"

    print("=" * 60)
    print("Telegram Comment Collector & Sentiment Analyzer Runner")
    print(f"Target: @{target_clean}")
    print("=" * 60)

    print("Loading CAMeLBERT sentiment model...")
    t0 = time.time()
    analyzer = load_pinned("camelbert-da")
    print(f"CAMeLBERT model loaded in {time.time() - t0:.2f}s.")

    with httpx.Client(timeout=60) as client:
        cp = ControlPlane(base_url, worker_cred, client)

        builder = build_collector(
            client,
            telegram_api_id=os.environ.get("TELEGRAM_API_ID"),
            telegram_api_hash=os.environ.get("TELEGRAM_API_HASH"),
            telegram_session_string=os.environ.get("TELEGRAM_SESSION_STRING"),
        )

        max_jobs = 10
        for i in range(max_jobs):
            print(f"\nClaiming collect job (attempt {i+1})...")
            lease = cp.claim(["collect"])
            if not lease:
                print("No queued collect jobs found.")
                break

            job_id = lease.get("job_id")
            ch_handle = (lease.get("external_channel_id") or "").lstrip("@").lower()
            platform = lease.get("platform")
            videos = lease.get("videos", [])
            print(f"Claimed Job {job_id} | Platform: {platform} | Channel: @{ch_handle} | Videos: {len(videos)}")

            # Process the job
            success = _backfill(cp, lease, builder, analyzer=analyzer)
            print(f"Job {job_id} finished: success={success}")

            if ch_handle == target_clean:
                print(f"\nTarget channel @{target_clean} collection complete!")
                break

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
