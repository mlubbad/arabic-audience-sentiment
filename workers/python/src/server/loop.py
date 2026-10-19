"""A worker that keeps running, so collection does not wait for an operator.

The one-shot runner beside this exists to prove a channel end to end by hand.
It is not a product: a customer's data goes stale between the moments somebody
remembers to run it, and the dashboard says so — "no worker connected" is an
honest message about a real gap, not a cosmetic one.

Three things this adds over calling the runner in a shell loop.

The model is loaded once. Loading takes seconds and allocates hundreds of
megabytes; doing it per job would dominate the run and thrash a shared host.

Idleness is cheap and bounded. An empty queue sleeps rather than spinning, and
after enough empty cycles the process exits so whatever supervises it starts a
clean one — long-lived Python on shared hosting accumulates memory, and a
scheduled restart is simpler than diagnosing that later.

A failure of one job never takes the loop down. The job's own failure handling
has already recorded an outcome; anything that escapes it is logged and the
loop continues, because a worker that dies on one bad job stops collecting for
every tenant it serves.
"""

import argparse
import os
import signal
import sys
import time

import httpx

from collectors.youtube_api import YouTubeAPI
from collectors.facebook_collector import FacebookCollector
from collectors.instagram_collector import InstagramCollector
from collectors.telegram_collector import TelegramCollector
from collectors.tiktok_collector import TikTokCollector
from collectors.x_collector import XCollector
from collectors.scrapers.apify import ApifyClient
from collectors.scrapers.brightdata import BrightDataClient

from .gateway import ControlPlane, ControlPlaneError, LeaseLost
from .runner import run_job

_stop = False


def _request_stop(signum, frame):  # noqa: ARG001 - signal handler shape
    """Finish the job in hand, then leave. Killing mid-commit loses a lease."""
    global _stop
    _stop = True


def _log(message: str) -> None:
    # Unbuffered and timestamped: this is read from a file while it runs.
    print(f"{time.strftime('%Y-%m-%dT%H:%M:%S%z')} {message}", flush=True)


def build_collector(
    client: httpx.Client,
    api_key: str | None = None,
    telegram_bot_token: str | None = None,
    telegram_api_id: str | None = None,
    telegram_api_hash: str | None = None,
    telegram_session_string: str | None = None,
    telegram_fixture: dict | None = None,
    x_bearer_token: str | None = None,
    x_fixture: dict | None = None,
    tiktok_access_token: str | None = None,
    tiktok_fixture: dict | None = None,
    apify_token: str | None = None,
    apify_x_actor: str | None = None,
    apify_tiktok_actor: str | None = None,
    brightdata_api_key: str | None = None,
    brightdata_proxy_url: str | None = None,
    brightdata_browser_ws: str | None = None,
    brightdata_webdriver_url: str | None = None,
    x_scraper_provider: str | None = None,
    tiktok_scraper_provider: str | None = None,
    facebook_fixture: dict | None = None,
    instagram_fixture: dict | None = None,
    apify_facebook_posts_actor: str | None = None,
    apify_facebook_comments_actor: str | None = None,
    apify_instagram_posts_actor: str | None = None,
    apify_instagram_comments_actor: str | None = None,
    facebook_scraper_provider: str | None = None,
    instagram_scraper_provider: str | None = None,
):
    """The collector builder the runner is handed.

    A token with no channel id builds the OAuth collector, as it always has —
    the grant is the channel. A token beside a channel id is the platform
    reader: the operator's own grant reading a public channel by id, its rows
    filed as public data. An id with no token asks for the project's API key;
    without it the builder answers None — which the runner reports as a
    blocking configuration gap on this worker, never as a fault in the
    channel.

    For platform == 'telegram', returns a TelegramCollector adapter.
    For platform == 'x', returns an XCollector adapter.
    For platform == 'tiktok', returns a TikTokCollector adapter.
    For platform == 'facebook' / 'instagram', returns the Meta collectors: a
    lease token is the page's or account's own grant (Graph API), a lease
    with only a handle is read through the scrapers. There is no worker-wide
    Meta token to fall back to: Meta grants are per channel.
    """
    apify_client = None
    if apify_token:
        apify_kwargs: dict = {"token": apify_token, "client": client}
        if apify_x_actor:
            apify_kwargs["x_actor"] = apify_x_actor
        if apify_tiktok_actor:
            apify_kwargs["tiktok_actor"] = apify_tiktok_actor
        for key, value in (
            ("facebook_posts_actor", apify_facebook_posts_actor),
            ("facebook_comments_actor", apify_facebook_comments_actor),
            ("instagram_posts_actor", apify_instagram_posts_actor),
            ("instagram_comments_actor", apify_instagram_comments_actor),
        ):
            if value:
                apify_kwargs[key] = value
        apify_client = ApifyClient(**apify_kwargs)

    brightdata_client = None
    if brightdata_api_key or brightdata_proxy_url or brightdata_browser_ws or brightdata_webdriver_url:
        brightdata_client = BrightDataClient(
            api_key=brightdata_api_key,
            proxy_url=brightdata_proxy_url,
            browser_ws=brightdata_browser_ws,
            webdriver_url=brightdata_webdriver_url,
            client=client,
        )

    def build(
        token: str | None,
        expires_at: str | None = None,
        renew=None,
        channel_id: str | None = None,
        platform: str | None = "youtube",
    ):
        p = (platform or "youtube").lower()
        if p == "telegram":
            return TelegramCollector(
                channel_id=channel_id,
                client=client,
                bot_token=telegram_bot_token,
                api_id=telegram_api_id,
                api_hash=telegram_api_hash,
                session_string=telegram_session_string,
                fixture_data=telegram_fixture,
            )
        if p == "x":
            return XCollector(
                channel_id=channel_id,
                client=client,
                bearer_token=token or x_bearer_token,
                apify_client=apify_client,
                brightdata_client=brightdata_client,
                fixture_data=x_fixture,
                preferred_scraper=x_scraper_provider,
            )
        if p == "tiktok":
            return TikTokCollector(
                channel_id=channel_id,
                client=client,
                access_token=token or tiktok_access_token,
                apify_client=apify_client,
                brightdata_client=brightdata_client,
                fixture_data=tiktok_fixture,
                preferred_scraper=tiktok_scraper_provider,
            )
        if p == "facebook":
            return FacebookCollector(
                channel_id=channel_id,
                client=client,
                access_token=token,
                apify_client=apify_client,
                brightdata_client=brightdata_client,
                fixture_data=facebook_fixture,
                preferred_scraper=facebook_scraper_provider,
            )
        if p == "instagram":
            return InstagramCollector(
                channel_id=channel_id,
                client=client,
                access_token=token,
                apify_client=apify_client,
                brightdata_client=brightdata_client,
                fixture_data=instagram_fixture,
                preferred_scraper=instagram_scraper_provider,
            )
        if token:
            return YouTubeAPI(
                None,
                client,
                access_token=token,
                expires_at=expires_at,
                renew=renew,
                public_reader=bool(channel_id),
            )
        if channel_id and api_key and not api_key.startswith("AQ."):
            return YouTubeAPI(api_key, client)
        return None

    return build


def serve(
    controls,
    build,
    analyzer=None,
    classifier=None,
    genre_classifier=None,
    idle_seconds: float = 60.0,
    max_idle: int = 30,
    run=run_job,
    sleep=time.sleep,
    should_stop=lambda: _stop,
) -> str:
    """The loop itself. Returns why it stopped.

    Separated from argument parsing so the behaviour that matters — surviving a
    job that raises, and standing down rather than spinning — is testable
    without a control plane, a model or a clock.
    """
    # One control plane per credential. A credential is scoped to a single
    # workspace, so a worker holding one serves one tenant and every other
    # tenant waits for a worker nobody started. They are taken in turn rather
    # than in order, or the first busy tenant would starve the rest.
    queue = list(controls) if isinstance(controls, (list, tuple)) else [controls]
    idle = 0
    turn = 0
    while not should_stop():
        control = queue[turn % len(queue)]
        turn += 1
        try:
            kwargs = {"analyzer": analyzer, "classifier": classifier}
            if genre_classifier is not None:
                kwargs["genre_classifier"] = genre_classifier
            worked = run(control, build, **kwargs)
        except LeaseLost:
            # Another worker owns this job. Not an error: take the next one.
            _log("lease lost, another worker has it")
            worked = True
        except ControlPlaneError as exc:
            # The refusal code carries no secret; the message might.
            _log(f"control plane refused: {exc.code}")
            worked = False
        except Exception as exc:  # noqa: BLE001 - the loop outlives one job
            # A worker that dies on one bad job stops collecting for every
            # tenant it serves. The job's own handling has already recorded an
            # outcome; what escaped it is noted and the loop goes on.
            _log(f"job raised {type(exc).__name__}")
            worked = False

        if worked:
            idle = 0
            continue
        idle += 1
        # A round is only idle when every credential came back empty, so one
        # quiet tenant never stands the worker down for the others.
        if idle % len(queue) != 0:
            continue
        # A quiet round is the moment to ask the server for more work: every
        # credential just came back empty, so this is not competing with a
        # job in progress for the same tenant.
        for c in queue:
            try:
                c.tick()
            except ControlPlaneError as exc:
                _log(f"tick refused: {exc.code}")
        if idle // len(queue) >= max_idle:
            _log(f"idle for {idle // len(queue)} rounds, exiting for a clean restart")
            return "idle"
        sleep(idle_seconds)
    return "stopped"


def _load_dotenv_if_needed() -> None:
    """Load local environment variables from .env.local or .env if not already set.

    Safe fallback for development and worker processes running outside Docker/CI.
    Never overwrites existing environment variables.
    """
    candidates = [
        os.path.join(os.getcwd(), ".env.local"),
        os.path.join(os.getcwd(), ".env"),
        os.path.abspath(os.path.join(os.path.dirname(__file__), "../../../.env.local")),
        os.path.abspath(os.path.join(os.path.dirname(__file__), "../../../.env")),
    ]
    for env_path in candidates:
        if os.path.isfile(env_path):
            try:
                with open(env_path, "r", encoding="utf-8") as f:
                    for line in f:
                        line = line.strip()
                        if line and not line.startswith("#") and "=" in line:
                            k, v = line.split("=", 1)
                            k = k.strip()
                            v = v.strip().strip('"').strip("'")
                            if k and k not in os.environ:
                                os.environ[k] = v
            except (OSError, UnicodeDecodeError):
                pass


def main() -> None:
    _load_dotenv_if_needed()
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--base", default=os.environ.get("WORKER_API_BASE_URL", ""))
    # Comma-separated: one scoped credential per workspace this worker serves.
    from sentiment.transformer import CANDIDATES

    p.add_argument(
        "--credential",
        default=os.environ.get("WORKER_CREDENTIAL", ""),
        help="one or more scoped worker credentials, comma-separated",
    )
    default_model = os.environ.get("SENTIMENT_MODEL", "none")
    if default_model not in ["none", "deterministic-test", *CANDIDATES.keys()]:
        default_model = "none"
    p.add_argument(
        "--model", default=default_model, choices=["none", "deterministic-test", *sorted(CANDIDATES.keys())]
    )
    p.add_argument(
        "--topics",
        default=os.environ.get("TOPIC_MODEL", "gemini" if os.environ.get("GEMINI_API_KEY") else "none"),
        choices=["none", "deterministic-test", "gemini", "typesafe"],
        help="topic classifier; gemini needs GEMINI_API_KEY, typesafe needs TYPESAFE_API_KEY",
    )
    p.add_argument(
        "--genres",
        default=os.environ.get("GENRE_MODEL", "gemini" if os.environ.get("GEMINI_API_KEY") else "none"),
        choices=["none", "gemini"],
        help="video genre classifier; gemini needs GEMINI_API_KEY",
    )
    p.add_argument(
        "--idle-seconds",
        type=float,
        default=float(os.environ.get("WORKER_IDLE_SECONDS", "60.0")),
        help="pause after an empty queue",
    )
    p.add_argument(
        "--max-idle",
        type=int,
        default=int(os.environ.get("WORKER_MAX_IDLE", "30")),
        help="exit after this many consecutive empty cycles",
    )
    args = p.parse_args()
    if not args.base or not args.credential:
        raise SystemExit("need WORKER_API_BASE_URL and WORKER_CREDENTIAL")

    signal.signal(signal.SIGTERM, _request_stop)
    signal.signal(signal.SIGINT, _request_stop)

    analyzer = None
    if args.model in CANDIDATES:
        from sentiment.transformer import load_pinned

        _log(f"loading the classifier ({args.model})")
        analyzer = load_pinned(args.model)
        _log(f"loaded {analyzer.model_id}@{analyzer.revision[:12]}")
    elif args.model == "deterministic-test":
        from sentiment.deterministic import DeterministicTestAnalyzer

        analyzer = DeterministicTestAnalyzer()

    client = httpx.Client()
    classifier = None
    if args.topics == "gemini":
        from topics.gemini import GeminiTopicClassifier

        key = os.environ.get("GEMINI_API_KEY", "")
        if not key:
            raise SystemExit("--topics gemini needs GEMINI_API_KEY")
        classifier = GeminiTopicClassifier(key, client)
        _log(f"topic classifier: {classifier.model_id}")
    elif args.topics == "typesafe":
        from topics.typesafe import TypeSafeTopicClassifier

        key = os.environ.get("TYPESAFE_API_KEY", "")
        if not key:
            raise SystemExit("--topics typesafe needs TYPESAFE_API_KEY")
        classifier = TypeSafeTopicClassifier(key, client)
        _log(f"topic classifier: {classifier.model_id}")
    elif args.topics == "deterministic-test":
        from topics.deterministic import DeterministicTestClassifier

        classifier = DeterministicTestClassifier()

    genre_classifier = None
    if args.genres == "gemini":
        from genres.gemini import GeminiGenreClassifier

        key = os.environ.get("GEMINI_API_KEY", "")
        if not key:
            raise SystemExit("--genres gemini needs GEMINI_API_KEY")
        genre_classifier = GeminiGenreClassifier(key, client)
        _log(f"genre classifier: {genre_classifier.model_id}")

    credentials = [c.strip() for c in args.credential.split(",") if c.strip()]
    controls = [ControlPlane(args.base, c, client) for c in credentials]
    # Public channels are collected with the project's API key. Absent, this
    # worker still serves connected channels; a public job it claims ends
    # blocked with a code that names the gap.
    api_key = os.environ.get("YOUTUBE_API_KEY") or None
    telegram_bot_token = os.environ.get("TELEGRAM_BOT_TOKEN") or None
    telegram_api_id = os.environ.get("TELEGRAM_API_ID") or None
    telegram_api_hash = os.environ.get("TELEGRAM_API_HASH") or None
    telegram_session_string = os.environ.get("TELEGRAM_SESSION_STRING") or None
    x_bearer_token = os.environ.get("X_BEARER_TOKEN") or os.environ.get("TWITTER_BEARER_TOKEN") or None
    tiktok_access_token = os.environ.get("TIKTOK_ACCESS_TOKEN") or None
    apify_token = os.environ.get("APIFY_API_TOKEN") or os.environ.get("APIFY_TOKEN") or None
    apify_x_actor = os.environ.get("APIFY_X_ACTOR") or None
    apify_tiktok_actor = os.environ.get("APIFY_TIKTOK_ACTOR") or None
    brightdata_api_key = os.environ.get("BRIGHTDATA_API_KEY") or None
    brightdata_proxy_url = os.environ.get("BRIGHTDATA_PROXY_URL") or None
    brightdata_browser_ws = os.environ.get("BRIGHTDATA_BROWSER_WS") or None
    brightdata_webdriver_url = os.environ.get("BRIGHTDATA_WEBDRIVER_URL") or None
    x_scraper_provider = os.environ.get("X_SCRAPER_PROVIDER") or None
    tiktok_scraper_provider = os.environ.get("TIKTOK_SCRAPER_PROVIDER") or None
    facebook_scraper_provider = os.environ.get("FACEBOOK_SCRAPER_PROVIDER") or None
    instagram_scraper_provider = os.environ.get("INSTAGRAM_SCRAPER_PROVIDER") or None
    apify_facebook_posts_actor = os.environ.get("APIFY_FACEBOOK_POSTS_ACTOR") or None
    apify_facebook_comments_actor = os.environ.get("APIFY_FACEBOOK_COMMENTS_ACTOR") or None
    apify_instagram_posts_actor = os.environ.get("APIFY_INSTAGRAM_POSTS_ACTOR") or None
    apify_instagram_comments_actor = os.environ.get("APIFY_INSTAGRAM_COMMENTS_ACTOR") or None

    build = build_collector(
        client,
        api_key=api_key,
        telegram_bot_token=telegram_bot_token,
        telegram_api_id=telegram_api_id,
        telegram_api_hash=telegram_api_hash,
        telegram_session_string=telegram_session_string,
        x_bearer_token=x_bearer_token,
        tiktok_access_token=tiktok_access_token,
        apify_token=apify_token,
        apify_x_actor=apify_x_actor,
        apify_tiktok_actor=apify_tiktok_actor,
        brightdata_api_key=brightdata_api_key,
        brightdata_proxy_url=brightdata_proxy_url,
        brightdata_browser_ws=brightdata_browser_ws,
        brightdata_webdriver_url=brightdata_webdriver_url,
        x_scraper_provider=x_scraper_provider,
        tiktok_scraper_provider=tiktok_scraper_provider,
        apify_facebook_posts_actor=apify_facebook_posts_actor,
        apify_facebook_comments_actor=apify_facebook_comments_actor,
        apify_instagram_posts_actor=apify_instagram_posts_actor,
        apify_instagram_comments_actor=apify_instagram_comments_actor,
        facebook_scraper_provider=facebook_scraper_provider,
        instagram_scraper_provider=instagram_scraper_provider,
    )
    has_scrapers = bool(
        apify_token
        or brightdata_api_key
        or brightdata_proxy_url
        or brightdata_browser_ws
        or brightdata_webdriver_url
    )
    telegram_auth = bool(telegram_api_id and telegram_session_string)
    _log(
        f"worker up, model={args.model}, tenants={len(controls)}, "
        f"topics={args.topics}, genres={args.genres}, public={'yes' if api_key else 'no'}, "
        f"scrapers={'yes' if has_scrapers else 'no'}, "
        f"telegram_auth={'yes' if telegram_auth else 'no'}"
    )
    why = serve(
        controls,
        build,
        analyzer=analyzer,
        classifier=classifier,
        genre_classifier=genre_classifier,
        idle_seconds=args.idle_seconds,
        max_idle=args.max_idle,
    )
    _log(f"worker down ({why})")
    sys.exit(0)


if __name__ == "__main__":
    main()
