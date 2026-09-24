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
from .runner import run_backfill, run_once

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

    entries = []
    page = None
    # Paged rather than capped: a backfill is asking about the whole channel,
    # and stopping at the first page would silently define "the channel" as its
    # newest 50 uploads.
    while len(entries) < consider:
        params = {
            "part": "snippet",
            "playlistId": playlist,
            "maxResults": min(50, consider - len(entries)),
        }
        if page:
            params["pageToken"] = page
        videos = client.get(ITEMS, params=params, headers=auth, timeout=30)
        if videos.status_code != 200:
            return {**empty, "reason": f"uploads_lookup_failed:{videos.status_code}"}
        body = videos.json()
        entries.extend(body.get("items") or [])
        page = body.get("nextPageToken")
        if not page:
            break
    if not entries:
        return {**empty, "reason": "channel_has_no_uploads"}

    titles = {
        e["snippet"]["resourceId"]["videoId"]: e["snippet"].get("title") or ""
        for e in entries
    }
    ids = list(titles)
    stat_items = []
    # videos.list accepts at most 50 ids per call, so a long channel is asked
    # about in chunks rather than in one request that silently returns fewer.
    for start in range(0, len(ids), 50):
        stats = client.get(
            STATS,
            params={"part": "statistics", "id": ",".join(ids[start:start + 50])},
            headers=auth, timeout=30,
        )
        if stats.status_code != 200:
            return {**empty, "reason": f"statistics_lookup_failed:{stats.status_code}"}
        stat_items.extend(stats.json().get("items") or [])

    candidates = []
    for item in stat_items:
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
    # Off by default, and the test analyzer is never the default when it is on:
    # it performs no language understanding, and labelling a real channel with
    # it would put figures on screen that mean nothing about that audience.
    # A backfill walks the whole channel as one resumable job. Off by default:
    # it can spend a large share of the day's quota, and that should be asked
    # for rather than happen because someone ran the collector.
    p.add_argument("--backfill", action="store_true",
                   help="walk every upload that has comments, resuming from the checkpoint")
    p.add_argument("--videos", type=int, default=25,
                   help="how many recent uploads to consider (single-video path only; "
                        "a --backfill run reads whichever videos the server hands down)")
    from sentiment.transformer import CANDIDATES

    p.add_argument("--model", default="none",
                   choices=["none", "deterministic-test", *sorted(CANDIDATES.keys())],
                   help="candidate Arabic classifier (e.g. arabert-4class, camelbert-da); "
                        "deterministic-test is a fixture double, NOT a model")
    args = p.parse_args()
    if not args.base or not args.credential:
        raise SystemExit("need WORKER_API_BASE_URL and WORKER_CREDENTIAL")

    analyzer = None
    if args.model in CANDIDATES:
        # Imported here so the collection-only path never needs torch.
        from sentiment.transformer import load_pinned

        analyzer = load_pinned(args.model)
    elif args.model == "deterministic-test":
        analyzer = DeterministicTestAnalyzer()


    client = httpx.Client()
    control = ControlPlane(args.base, args.credential, client)
    chosen: dict[str, object] = {}
    survey: dict[str, object] = {}

    def build(token: str, expires_at: str | None = None, renew=None):
        report = survey_uploads(token, client, consider=args.videos)
        survey.update(report)
        if report["chosen"] is None:
            # Carried on the callable itself so the runner can record it
            # without the survey's vocabulary leaking into its signature.
            build.reason = report["reason"]
            return None, None
        chosen.update(report["chosen"])
        build.video_title = report["chosen"]["title"] or None
        return YouTubeAPI(None, client, access_token=token, expires_at=expires_at,
                          renew=renew), report["chosen"]["video_id"]

    if args.backfill:
        # Which videos to read is the server's decision, carried on the
        # lease — this only has to build a collector for the claimed token.
        # A lease without one is a public channel: with the project's API key
        # in the environment the by-hand run can read it too; without it the
        # None the runner receives ends the job blocked with the code that
        # names the gap.
        def backfill_build(token, expires_at=None, renew=None, channel_id=None):
            if token:
                return YouTubeAPI(None, client, access_token=token,
                                  expires_at=expires_at, renew=renew)
            if channel_id and os.environ.get("YOUTUBE_API_KEY") and not os.environ["YOUTUBE_API_KEY"].startswith("AQ."):
                return YouTubeAPI(os.environ["YOUTUBE_API_KEY"], client)
            return None
        worked = run_backfill(
            control,
            backfill_build,
            analyzer=analyzer,
        )
    else:
        worked = run_once(
            control,
            None,
            "",
            video_title=None,
            analyzer=analyzer,
            build_collector=build,
        )
    print(json.dumps(
        {"claimed": worked, "video": chosen or None,
         "why": survey.get("reason", "not_reached"),
         "candidates": survey.get("candidates", []),
         "mode": "backfill" if args.backfill else "one_video",
         "analysed_with": args.model if analyzer is not None else None,
         "analysis_key": getattr(analyzer, "model_id", None)
         and f"{analyzer.model_id}@{analyzer.revision}"},
        ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
