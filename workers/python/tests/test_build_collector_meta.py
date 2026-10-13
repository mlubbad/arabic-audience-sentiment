"""The server loop's builder hands Facebook and Instagram leases their collectors."""

import httpx
from collectors.facebook_collector import FacebookCollector
from collectors.instagram_collector import InstagramCollector
from server.loop import build_collector


def test_build_collector_routes_meta_platforms():
    build = build_collector(
        httpx.Client(),
        apify_token="apify-token",
        apify_facebook_posts_actor="custom/fb-posts",
        apify_instagram_comments_actor="custom/ig-comments",
        facebook_scraper_provider="brightdata",
        instagram_scraper_provider="apify",
        brightdata_api_key="bd",
    )
    fb = build(None, channel_id="aljazeera", platform="facebook")
    assert isinstance(fb, FacebookCollector)
    assert fb.channel_id == "aljazeera" and fb.access_token is None
    assert fb.preferred_scraper == "brightdata"
    assert fb.apify_client.facebook_posts_actor == "custom/fb-posts"
    assert fb.brightdata_client is not None

    ig = build("ig-token", channel_id=None, platform="instagram")
    assert isinstance(ig, InstagramCollector)
    assert ig.access_token == "ig-token" and ig.channel_id is None
    assert ig.preferred_scraper == "apify"
    assert ig.apify_client.instagram_comments_actor == "custom/ig-comments"


def test_build_collector_meta_without_any_scraper_still_builds():
    # A worker with no scraper keys still serves connected Meta channels (Graph only);
    # a public lease then ends blocked with a named gap, decided by the collector.
    build = build_collector(httpx.Client())
    fb = build(None, channel_id="aljazeera", platform="facebook")
    assert isinstance(fb, FacebookCollector) and fb.apify_client is None and fb.brightdata_client is None
