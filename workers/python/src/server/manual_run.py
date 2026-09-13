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
STATS = "https://www.googleapis.com/youtube/v3/videos"


def survey_uploads(token: str, client: httpx.Client, consider: int = 25) -> dict:
    """Recent uploads, each with the number of comments it actually has.

    Returns the candidates alongside the choice, because "no video to collect"
    on its own is an answer nobody can act on. Seeing that every recent upload
    reports no comments is a different situation from the channel lookup
    failing, and the operator has to be able to tell them apart.

    commentCount is absent when comments are switched off for that video, and
    "0" when they are on and nobody has written one. Those are different facts
    and only the second could ever become a comment later.

    Via the uploads playlist rather than search.list: one quota unit instead of
    a hundred, for the same answer.
    """
    auth = {"authorization": f"Bearer {token}"}
    empty = {"chosen": None, "candidates": [], "reason": ""}

    channels = client.get(
        UPLOADS, params={"part": "contentDetails", "mine": "true"},
        headers=auth, timeout=30,
    )
    if channels.status_code != 200:
        return {**empty, "reason": f"channel_lookup_failed:{channels.status_code}"}
    items = channels.json().get("items") or []
    if not items:
        return {**empty, "reason": "no_channel_for_credential"}
    playlist = items[0]["contentDetails"]["relatedPlaylists"]["uploads"]

    videos = client.get(
        ITEMS,
        params={"part": "snippet", "playlistId": playlist, "maxResults": consider},
        headers=auth, timeout=30,
    )
    if videos.status_code != 200:
        return {**empty, "reason": f"uploads_lookup_failed:{videos.status_code}"}
    entries = videos.json().get("items") or []
    if not entries:
        return {**empty, "reason": "channel_has_no_uploads"}

    titles = {
        e["snippet"]["resourceId"]["videoId"]: e["snippet"].get("title") or ""
        for e in entries
    }
    stats = client.get(
        STATS,
        params={"part": "statistics", "id": ",".join(titles)},
        headers=auth, timeout=30,
    )
    if stats.status_code != 200:
        return {**empty, "reason": f"statistics_lookup_failed:{stats.status_code}"}

    candidates = []
    for item in stats.json().get("items") or []:
        raw = item.get("statistics", {}).get("commentCount")
        candidates.append({
            "video_id": item["id"],
            "title": titles.get(item["id"], ""),
            # None means the setting is off, not that the count is zero.
            "comments": None if raw is None else int(raw),
        })
    candidates.sort(key=lambda c: (c["comments"] is None, -(c["comments"] or 0)))

    best = candidates[0] if candidates and (candidates[0]["comments"] or 0) > 0 else None
    if best is None:
        disabled = sum(1 for c in candidates if c["comments"] is None)
        reason = (
            f"no_upload_has_comments:{len(candidates)}_checked_{disabled}_disabled"
        )
        return {"chosen": None, "candidates": candidates, "reason": reason}
    return {"chosen": best, "candidates": candidates, "reason": "ok"}


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
    chosen: dict[str, object] = {}
    survey: dict[str, object] = {}

    def build(token: str):
        report = survey_uploads(token, client)
        survey.update(report)
        if report["chosen"] is None:
            # Carried on the callable itself so the runner can record it
            # without the survey's vocabulary leaking into its signature.
            build.reason = report["reason"]
            return None, None
        chosen.update(report["chosen"])
        return YouTubeAPI(None, client, access_token=token), report["chosen"]["video_id"]

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
         "why": survey.get("reason", "not_reached"),
         "candidates": survey.get("candidates", []),
         "analysed": bool(args.analyse)},
        ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
