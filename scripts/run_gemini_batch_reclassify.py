#!/usr/bin/env python3
"""Run the Context-Rich Hybrid Gemini Batch API Sentiment Reclassifier & Dual-Write Correction Engine."""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT / "workers" / "python" / "src"))

from sentiment.gemini_batch import GeminiBatchReclassifier  # noqa: E402

DEFAULT_TARGET_CHANNELS = (
    "@aljazeera360",
    "@afala_yatadabaron",
    "@sky_echo-q6p",
    "@mohammedalubbad",
    "@asharqnews",
    "@abdelkafytube",
    "@dralsuwaidan",
    "@shfa-1",
    "@mmoshaya",
)


def _load_env() -> dict[str, str]:
    env_vars = dict(os.environ)
    for candidate in (
        REPO_ROOT / ".env",
        REPO_ROOT / ".env.local",
        Path.home() / ".hermes" / ".env",
    ):
        if candidate.is_file():
            for line in candidate.read_text(encoding="utf-8", errors="ignore").splitlines():
                stripped = line.strip()
                if stripped and not stripped.startswith("#") and "=" in stripped:
                    k, v = stripped.split("=", 1)
                    val = v.strip().strip("\"'")
                    if val and not val.startswith("[REDACTED"):
                        env_vars[k.strip()] = val
    return env_vars


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--channels",
        nargs="+",
        default=list(DEFAULT_TARGET_CHANNELS),
        help="Channel handles or UUIDs to reclassify via Gemini Batch API",
    )
    parser.add_argument(
        "--max-comments-per-channel",
        type=int,
        default=120,
        help="Max comments to process per channel in each wave (default: 120)",
    )
    parser.add_argument(
        "--offset",
        type=int,
        default=0,
        help="Starting comment offset per channel (default: 0)",
    )
    parser.add_argument(
        "--waves",
        type=int,
        default=1,
        help="Number of sequential waves to execute (default: 1)",
    )
    parser.add_argument(
        "--chunk-size",
        type=int,
        default=50,
        help="Comments per Gemini Batch API request chunk (default: 50)",
    )
    parser.add_argument(
        "--no-transcripts",
        action="store_true",
        help="Skip fetching YouTube caption transcripts",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Run Gemini Batch API classification without writing to Supabase",
    )
    parser.add_argument(
        "--output",
        default="",
        help="Optional JSON file path to save the full reclassification report",
    )
    parser.add_argument(
        "--reuse-flash-job",
        default=None,
        help="Reuse an already-completed Tier-1 Flash Batch job (batches/...)",
    )
    parser.add_argument(
        "--reuse-argon-job",
        default=None,
        help="Reuse an already-completed Tier-2 Argon Batch job (batches/...)",
    )
    args = parser.parse_args()

    env = _load_env()
    supa_url = env.get("SUPABASE_URL") or env.get("VITE_SUPABASE_URL") or ""
    supa_key = env.get("SUPABASE_SERVICE_ROLE_KEY") or ""
    gemini_key = env.get("GOOGLE_API_KEY") or env.get("GEMINI_API_KEY") or ""

    if not supa_url or not supa_key or not gemini_key:
        raise SystemExit("Missing SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, or GEMINI_API_KEY")

    with GeminiBatchReclassifier(
        supabase_url=supa_url,
        supabase_service_key=supa_key,
        gemini_api_key=gemini_key,
        chunk_size=args.chunk_size,
    ) as engine:
        all_waves = []
        summary: dict = {}
        total_analysed = 0
        total_preds = 0
        total_corrs = 0
        for w in range(max(1, args.waves)):
            cur_offset = args.offset + w * args.max_comments_per_channel
            print(
                f"[Wave {w + 1}/{args.waves}] Starting at offset={cur_offset} "
                f"(max_per_channel={args.max_comments_per_channel}, chunk_size={args.chunk_size})...",
                file=sys.stderr,
                flush=True,
            )
            wave_report: dict = {}
            for attempt in range(1, 4):
                try:
                    wave_report = engine.reclassify_channels_via_batch(
                        args.channels,
                        max_comments_per_channel=args.max_comments_per_channel,
                        comment_offset=cur_offset,
                        fetch_transcripts=not args.no_transcripts,
                        apply_to_db=not args.dry_run,
                        timeout_s=1800.0,
                        reuse_flash_job=args.reuse_flash_job if (w == 0 and attempt == 1) else None,
                        reuse_argon_job=args.reuse_argon_job if (w == 0 and attempt == 1) else None,
                    )
                    break
                except Exception as exc:
                    print(
                        f"[Wave {w + 1}/{args.waves}] Attempt {attempt}/3 error: {exc}",
                        file=sys.stderr,
                        flush=True,
                    )
                    if attempt == 3:
                        raise
                    import time as _t
                    _t.sleep(10 * attempt)
            wave_report["wave_index"] = w + 1
            wave_report["comment_offset"] = cur_offset
            all_waves.append(wave_report)
            total_analysed += int(wave_report.get("total_comments") or 0)
            total_preds += int(wave_report.get("total_predictions_written") or 0)
            total_corrs += int(wave_report.get("total_corrections_written") or 0)
            print(
                f"[Wave {w + 1}/{args.waves}] Done! flash_job={wave_report.get('flash_batch_job')} "
                f"argon_job={wave_report.get('argon_batch_job')} | "
                f"cumulative_analysed={total_analysed} | cumulative_corrections={total_corrs}",
                file=sys.stderr,
                flush=True,
            )

            summary = {
                "completed_waves": len(all_waves),
                "requested_waves": args.waves,
                "cumulative_comments_analysed": total_analysed,
                "cumulative_predictions_written": total_preds,
                "cumulative_corrections_written": total_corrs,
                "latest_wave": wave_report,
            }
            if args.output:
                out_path = Path(args.output).expanduser().resolve()
                out_path.parent.mkdir(parents=True, exist_ok=True)
                out_path.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
            if wave_report.get("status") == "empty" or int(wave_report.get("total_comments") or 0) == 0:
                break

    out_json = json.dumps(summary if args.waves > 1 else all_waves[0], ensure_ascii=False, indent=2)
    if args.output and args.waves == 1:
        out_path = Path(args.output).expanduser().resolve()
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_text(out_json, encoding="utf-8")
    print(out_json)


if __name__ == "__main__":
    main()
