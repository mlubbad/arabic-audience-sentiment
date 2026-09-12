"""Explicit local smoke/collection command; installation never invokes this module."""
import argparse
import json
import os
from pathlib import Path
import httpx
from .protocol import Batch, RawComment
from .runner import collect
from .store import Store
from .youtube_api import YouTubeAPI


class FixtureCollector:
    source = "sanitized_fixture"
    revision = "fixture-v1"

    def batches(self, video_id, checkpoint):
        if checkpoint is None:
            yield Batch([RawComment("fixture-1", video_id, "تعليق اصطناعي")], "second", "partial")
        yield Batch([RawComment("fixture-2", video_id, "رد اصطناعي", is_reply=True)], None, "exhausted")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", choices=["fixture", "youtube-api"], required=True)
    parser.add_argument("--workspace", required=True)
    parser.add_argument("--video", required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    with httpx.Client() as client, Store(args.output / "spool.sqlite") as store:
        adapter = FixtureCollector() if args.source == "fixture" else YouTubeAPI(os.environ.get("YOUTUBE_API_KEY", ""), client)
        store.enqueue(args.workspace, args.video)
        collect(store, args.workspace, adapter)
        summary = {"source": adapter.source, "adapter_revision": adapter.revision,
                   "workspace": args.workspace, "video_id": args.video,
                   "status": store.status(args.workspace, args.video),
                   "unique_comments_in_workspace": store.count(args.workspace),
                   "coverage": "source traversal only; advertised total and complete reply coverage not established"}
        (args.output / "manifest.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n")
        print(json.dumps(summary, ensure_ascii=False))
        return 0 if summary["status"] == "succeeded" else 1


if __name__ == "__main__":
    raise SystemExit(main())
