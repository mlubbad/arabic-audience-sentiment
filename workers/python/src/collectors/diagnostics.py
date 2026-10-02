"""Live diagnostics utility for Omnichannel Data Ingestion (X, TikTok, Telegram, YouTube).

Probes external APIs, public web endpoints, and scraper providers (Apify, Bright Data)
to report connectivity, authentication health, and bot-challenge status.

Usage:
    uv run python src/collectors/diagnostics.py
    uv run python src/collectors/diagnostics.py --platform x --channel aljazeera
    uv run python src/collectors/diagnostics.py --platform tiktok --channel aljazeera
    uv run python src/collectors/diagnostics.py --platform telegram --channel aljazeera
"""

import argparse
import hashlib
import os
import httpx


def _load_env():
    """Load local environment variables from .env.local or .env if present."""
    candidates = [
        os.path.join(os.getcwd(), ".env.local"),
        os.path.join(os.getcwd(), ".env"),
        os.path.abspath(os.path.join(os.path.dirname(__file__), "../../../.env.local")),
        os.path.abspath(os.path.join(os.path.dirname(__file__), "../../../.env")),
        os.path.abspath(os.path.join(os.path.dirname(__file__), "../../../../.env.local")),
        os.path.abspath(os.path.join(os.path.dirname(__file__), "../../../../.env")),
    ]
    for env_path in candidates:
        if os.path.isfile(env_path):
            try:
                with open(env_path, "r", encoding="utf-8") as f:
                    for line in f:
                        line = line.strip()
                        if line and not line.startswith("#") and "=" in line:
                            k, v = line.split("=", 1)
                            k, v = k.strip(), v.strip().strip('"').strip("'")
                            if k and k not in os.environ:
                                os.environ[k] = v
            except (OSError, UnicodeDecodeError):
                pass


def check_apify(token: str | None) -> dict:
    if not token:
        return {
            "name": "Apify Scraper Engine",
            "status": "NOT_CONFIGURED",
            "details": "APIFY_API_TOKEN is missing. Recommended for reliable X & TikTok collection.",
        }
    try:
        resp = httpx.get("https://api.apify.com/v2/users/me", headers={"Authorization": f"Bearer {token}"}, timeout=10)
        if resp.status_code == 200:
            user = resp.json().get("data", {}).get("username", "ok")
            return {
                "name": "Apify Scraper Engine",
                "status": "HEALTHY",
                "details": f"Authenticated successfully as '{user}'. Ready for tweet & tiktok actors.",
            }
        return {
            "name": "Apify Scraper Engine",
            "status": "INVALID_TOKEN",
            "details": f"Apify returned HTTP {resp.status_code}. Verify token permissions.",
        }
    except Exception as exc:  # noqa: BLE001 — diagnostic probe reports connectivity failure
        return {
            "name": "Apify Scraper Engine",
            "status": "NETWORK_ERROR",
            "details": f"Could not reach Apify API: {exc}",
        }


def check_brightdata(key: str | None, webdriver_url: str | None = None) -> dict:
    if not key and not webdriver_url:
        return {
            "name": "Bright Data Scraping API & Browser",
            "status": "NOT_CONFIGURED",
            "details": "Neither BRIGHTDATA_API_KEY nor BRIGHTDATA_WEBDRIVER_URL is set.",
        }

    status = "CONFIGURED"
    details_parts = []

    if key:
        try:
            resp = httpx.post(
                "https://api.brightdata.com/datasets/v3/scrape?dataset_id=gd_lwxmeb2u1cniijd7t4",
                headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
                json=[],
                timeout=10,
            )
            if resp.status_code in (200, 400):
                status = "HEALTHY"
                details_parts.append("Datasets API: Authenticated successfully")
            elif resp.status_code in (401, 403):
                status = "INVALID_KEY"
                details_parts.append(f"Datasets API: Rejected key with HTTP {resp.status_code}")
            else:
                details_parts.append(f"Datasets API: HTTP {resp.status_code}")
        except Exception as exc:  # noqa: BLE001 — diagnostic probe reports connectivity failure
            details_parts.append(f"Datasets API: Connectivity check skipped ({exc})")

    if webdriver_url:
        try:
            wb_resp = httpx.get(f"{webdriver_url.rstrip('/')}/status", timeout=10)
            if wb_resp.status_code == 200 and wb_resp.json().get("value", {}).get("ready"):
                if status != "INVALID_KEY":
                    status = "HEALTHY"
                details_parts.append("Scraping Browser: Ready for automated sessions (port 9515/9222)")
            else:
                details_parts.append(f"Scraping Browser: HTTP {wb_resp.status_code}")
        except Exception as exc:  # noqa: BLE001 — diagnostic probe reports connectivity failure
            details_parts.append(f"Scraping Browser: Connectivity check skipped ({exc})")

    details = " · ".join(details_parts) if details_parts else "Configured for fallback."
    return {
        "name": "Bright Data Scraping API & Browser",
        "status": status,
        "details": details,
    }


def check_x_channel(handle: str, bearer: str | None) -> dict:
    clean = handle.lstrip("@")
    if bearer:
        try:
            resp = httpx.get(
                f"https://api.twitter.com/2/users/by/username/{clean}",
                headers={"Authorization": f"Bearer {bearer}"},
                timeout=10,
            )
            if resp.status_code == 200:
                return {
                    "name": f"X / Twitter (@{clean}) - Official API",
                    "status": "HEALTHY",
                    "details": "Official API Bearer token verified and active.",
                }
            return {
                "name": f"X / Twitter (@{clean}) - Official API",
                "status": "API_ERROR",
                "details": f"Twitter API v2 returned HTTP {resp.status_code}.",
            }
        except Exception as exc:  # noqa: BLE001 — diagnostic probe reports connectivity failure
            return {
                "name": f"X / Twitter (@{clean}) - Official API",
                "status": "NETWORK_ERROR",
                "details": str(exc),
            }

    # Test public syndication endpoint
    syn_url = f"https://syndication.twitter.com/srv/timeline-profile/screen-name/{clean}"
    try:
        resp = httpx.get(syn_url, headers={"User-Agent": "Mozilla/5.0"}, timeout=10)
        if resp.status_code == 200:
            return {
                "name": f"X / Twitter (@{clean}) - Public Syndication",
                "status": "HEALTHY",
                "details": "Public syndication timeline accessible without credentials.",
            }
        if resp.status_code == 429:
            return {
                "name": f"X / Twitter (@{clean}) - Public Syndication",
                "status": "RATE_LIMITED (429)",
                "details": "Twitter syndication is rate-limited. Configure APIFY_API_TOKEN or X_BEARER_TOKEN.",
            }
        return {
            "name": f"X / Twitter (@{clean}) - Public Syndication",
            "status": f"HTTP_{resp.status_code}",
            "details": "Public endpoint returned error.",
        }
    except Exception as exc:  # noqa: BLE001 — diagnostic probe reports connectivity failure
        return {
            "name": f"X / Twitter (@{clean}) - Public Syndication",
            "status": "UNREACHABLE",
            "details": str(exc),
        }


def check_tiktok_channel(handle: str, token: str | None) -> dict:
    clean = handle.lstrip("@")
    if token:
        return {
            "name": f"TikTok (@{clean}) - Display API",
            "status": "CONFIGURED",
            "details": "TIKTOK_ACCESS_TOKEN configured for official API calls.",
        }

    # Test public profile and WAF
    url = f"https://www.tiktok.com/@{clean}"
    try:
        resp = httpx.get(
            url,
            headers={
                "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                "Accept-Language": "ar,en-US;q=0.9,en;q=0.8",
            },
            follow_redirects=True,
            timeout=10,
        )
        text_lower = resp.text.lower()
        if "slardar" in text_lower or "wafchallenge" in text_lower or "verify-bar" in text_lower:
            return {
                "name": f"TikTok (@{clean}) - Public HTML",
                "status": "BLOCKED (SlardarWAF Challenge)",
                "details": "TikTok anti-bot challenge triggered. Collector properly fails/blocks (no fake empty). Set APIFY_API_TOKEN.",
            }
        if resp.status_code == 200:
            return {
                "name": f"TikTok (@{clean}) - Public HTML",
                "status": "ACCESSIBLE",
                "details": "Public profile HTML loaded without challenge.",
            }
        return {
            "name": f"TikTok (@{clean}) - Public HTML",
            "status": f"HTTP_{resp.status_code}",
            "details": "Public profile returned error.",
        }
    except Exception as exc:  # noqa: BLE001 — diagnostic probe reports connectivity failure
        return {
            "name": f"TikTok (@{clean}) - Public HTML",
            "status": "UNREACHABLE",
            "details": str(exc),
        }


def check_telegram_channel(handle: str) -> dict:
    clean = handle.lstrip("@")
    cat_url = f"https://t.me/s/{clean}"
    cat_status = "UNKNOWN"
    disc_status = "UNKNOWN"
    details = []

    try:
        resp = httpx.get(cat_url, headers={"User-Agent": "Mozilla/5.0"}, timeout=10)
        if resp.status_code == 200:
            if "<title>Telegram: Contact @" in resp.text:
                cat_status = "PRIVATE_OR_NOT_FOUND"
                details.append("Channel is private or does not exist.")
            else:
                cat_status = "HEALTHY"
                details.append("Public posts catalogue accessible via t.me/s/.")
        else:
            cat_status = f"HTTP_{resp.status_code}"
    except Exception as exc:  # noqa: BLE001 — diagnostic probe reports connectivity failure
        cat_status = "UNREACHABLE"
        details.append(f"Catalogue unreachable: {exc}")

    # Check discussion comments endpoint
    disc_url = "https://t.me/api/discussion/1"
    try:
        resp = httpx.get(disc_url, headers={"User-Agent": "Mozilla/5.0"}, timeout=10)
        if resp.status_code == 401:
            disc_status = "AUTH_REQUIRED (401)"
            details.append("Discussion comments require session/auth. Collector properly raises telegram_discussion_requires_auth.")
        elif resp.status_code == 200:
            disc_status = "HEALTHY"
            details.append("Discussion endpoint public.")
        else:
            disc_status = f"HTTP_{resp.status_code}"
    except Exception:  # noqa: BLE001 — diagnostic probe reports connectivity failure
        disc_status = "UNREACHABLE"

    return {
        "name": f"Telegram (@{clean})",
        "status": f"Catalogue: {cat_status} | Discussion: {disc_status}",
        "details": " ".join(details),
    }


def check_youtube_channel(channel: str = "asharqnews") -> dict:
    """Diagnose YouTube collection capabilities (Platform Reader OAuth grant + API key)."""
    clean = channel.lstrip("@")
    supabase_url = os.environ.get("SUPABASE_URL")
    service_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    worker_cred = os.environ.get("WORKER_CREDENTIAL")
    api_key = os.environ.get("YOUTUBE_API_KEY")

    details = []
    has_reader = False
    if worker_cred and supabase_url and service_key:
        h = hashlib.sha256(worker_cred.encode()).hexdigest()
        try:
            res = httpx.post(
                f"{supabase_url}/rest/v1/rpc/svc_worker_reader_grant",
                json={"credential_hash": h},
                headers={"apikey": service_key, "Authorization": f"Bearer {service_key}"},
                timeout=10,
            )
            if res.status_code == 200 and len(res.json()) > 0:
                has_reader = True
                details.append("OAuth Platform Reader active in private.platform_reader (can read public YouTube channels without API key).")
        except Exception as exc:  # noqa: BLE001 — diagnostic probe reports connectivity failure
            details.append(f"Reader check error: {exc}")

    if api_key:
        if api_key.startswith("AQ."):
            details.append("YOUTUBE_API_KEY has AQ.* prefix (Google AI Studio/Cloud format, not accepted by YouTube API v3; bypassed in favor of OAuth Reader).")
        elif api_key.startswith("AIzaSy"):
            details.append("YOUTUBE_API_KEY has AIzaSy* prefix (standard Data API v3 key).")
    else:
        details.append("Direct API key not configured (not required; Platform Reader provides OAuth tokens).")

    # Probe YouTube Data API reachability
    try:
        resp = httpx.get("https://www.googleapis.com/youtube/v3/videos", timeout=5)
        if resp.status_code in (400, 401, 403):
            details.append("YouTube Data API v3 endpoint reachable.")
        else:
            details.append(f"YouTube endpoint returned HTTP {resp.status_code}.")
    except Exception as exc:  # noqa: BLE001 — diagnostic probe reports connectivity failure
        details.append(f"YouTube endpoint unreachable: {exc}")

    if has_reader:
        status = "HEALTHY (OAuth Platform Reader Active)"
    elif api_key and api_key.startswith("AIzaSy"):
        status = "HEALTHY (Direct API Key)"
    else:
        status = "DEGRADED (Requires Platform Reader or API Key)"

    return {
        "name": f"YouTube (@{clean})",
        "status": status,
        "details": " ".join(details),
    }


def main():
    _load_env()
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--platform", default="all", choices=["all", "youtube", "x", "tiktok", "telegram", "scrapers"])
    p.add_argument("--channel", default="asharqnews", help="Channel handle or username to test")
    args = p.parse_args()

    apify_token = os.environ.get("APIFY_API_TOKEN")
    brightdata_key = os.environ.get("BRIGHTDATA_API_KEY")
    brightdata_webdriver = os.environ.get("BRIGHTDATA_WEBDRIVER_URL")
    x_bearer = os.environ.get("X_BEARER_TOKEN") or os.environ.get("TWITTER_BEARER_TOKEN")
    tiktok_token = os.environ.get("TIKTOK_ACCESS_TOKEN")

    print("\n" + "=" * 78)
    print("  OMNICHANNEL DATA INGESTION DIAGNOSTICS (فحص شامل لجلب البيانات)")
    print("=" * 78)

    results = []

    if args.platform in ("all", "scrapers"):
        results.append(check_apify(apify_token))
        results.append(check_brightdata(brightdata_key, brightdata_webdriver))

    if args.platform in ("all", "youtube"):
        results.append(check_youtube_channel(args.channel))

    if args.platform in ("all", "x"):
        results.append(check_x_channel(args.channel, x_bearer))

    if args.platform in ("all", "tiktok"):
        results.append(check_tiktok_channel(args.channel, tiktok_token))

    if args.platform in ("all", "telegram"):
        results.append(check_telegram_channel(args.channel))

    for r in results:
        status_color = r["status"]
        print(f"\n[-] {r['name']}")
        print(f"    Status : {status_color}")
        print(f"    Details: {r['details']}")

    print("\n" + "=" * 78)
    print("  SUMMARY RECOMMENDATIONS (التوصيات)")
    print("=" * 78)
    print("1. YouTube: Public channel collection is fully managed via the OAuth Platform Reader")
    print("   (private.platform_reader). No external AIzaSy... API key is required.")
    print("2. Twitter (X): Public syndication is aggressively rate-limited (HTTP 429) by Twitter.")
    print("   Setting APIFY_API_TOKEN in .env.local enables resilient automated scraping.")
    print("3. TikTok: Web requests encounter Cloudflare/Slardar anti-bot challenges.")
    print("   The collector correctly marks these as blocked/failed (never empty success).")
    print("   Setting APIFY_API_TOKEN routes collection through managed residential scrapers.")
    print("4. Telegram: Public post discovery is functional. Discussion comments require session auth.")
    print("=" * 78 + "\n")


if __name__ == "__main__":
    main()
