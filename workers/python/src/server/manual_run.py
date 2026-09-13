"""One operator-driven collection run, against the deployed control plane.

This is not the production path. A real deployment has a worker process that
claims continuously; this claims once, collects one video, and stops. It exists
so a channel's first real comments can be seen end to end before deciding where
the worker should live.

It holds no Google credential of its own. It authenticates with a scoped worker
credential, and the access token for the channel comes down with the claim —
the refresh token and the sealing key stay on the server, as they do for any
worker.
"""
import argparse
import json
import os

import httpx

from collectors.youtube_api import YouTubeAPI
from sentiment.deterministic import DeterministicTestAnalyzer

from .gateway import ControlPlane
from .runner import run_once

UPLOADS = "https://www.googleapis.com/youtube/v3/channels"
ITEMS = "https://www.googleapis.com/youtube/v3/playlistItems"


def latest_video(token: str, client: httpx.Client) -> tuple[str, str] | None:
    """The channel's most recent upload, or None.

    Via the uploads playlist rather than search.list: one quota unit instead of
    a hundred, for the same answer.
    """
    channels = client.get(
        UPLOADS,
        params={"part": "contentDetails", "mine": "true"},
        headers={"authorization": f"Bearer {token}"},
        timeout=30,
    )
    if channels.status_code != 200:
        return None
    items = channels.json().get("items") or []
    if not items:
        return None
    playlist = items[0]["contentDetails"]["relatedPlaylists"]["uploads"]

    videos = client.get(
        ITEMS,
        params={"part": "snippet", "playlistId": playlist, "maxResults": 1},
        headers={"authorization": f"Bearer {token}"},
        timeout=30,
    )
    if videos.status_code != 200:
        return None
    entries = videos.json().get("items") or []
    if not entries:
        return None
    snippet = entries[0]["snippet"]
    return snippet["resourceId"]["videoId"], snippet.get("title") or ""


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--base", default=os.environ.get("WORKER_API_BASE_URL", ""))
    p.add_argument("--credential", default=os.environ.get("WORKER_CREDENTIAL", ""))
    # Off by default. The deterministic analyzer is not a model, and labelling a
    # real channel's comments with it would put figures on screen that mean
    # nothing about that audience.
    p.add_argument("--analyse", action="store_true",
                   help="label with the deterministic test analyzer (NOT a model)")
    args = p.parse_args()
    if not args.base or not args.credential:
        raise SystemExit("need WORKER_API_BASE_URL and WORKER_CREDENTIAL")

    client = httpx.Client()
    control = ControlPlane(args.base, args.credential, client)
    chosen: dict[str, str] = {}

    def build(token: str):
        found = latest_video(token, client)
        if found is None:
            return None, None
        video_id, title = found
        chosen["video_id"], chosen["title"] = video_id, title
        return YouTubeAPI(None, client, access_token=token), video_id

    worked = run_once(
        control,
        None,
        "",
        video_title=None,
        analyzer=DeterministicTestAnalyzer() if args.analyse else None,
        build_collector=build,
    )
    print(json.dumps(
        {"claimed": worked, "video": chosen or None,
         "analysed": bool(args.analyse)},
        ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
