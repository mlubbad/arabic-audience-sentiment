"""Unit tests for CollectorRouter and multi-platform runner resolution."""

import pytest
from collectors.router import CollectorRouter, SUPPORTED_PLATFORMS
from server.runner import _collector_for


def test_supported_platforms_coverage():
    assert "youtube" in SUPPORTED_PLATFORMS
    assert "telegram" in SUPPORTED_PLATFORMS
    assert "x" in SUPPORTED_PLATFORMS
    assert "tiktok" in SUPPORTED_PLATFORMS
    assert "facebook" in SUPPORTED_PLATFORMS
    assert "instagram" in SUPPORTED_PLATFORMS


def test_collector_router_routing():
    yt_called = []
    tg_called = []
    x_called = []
    tt_called = []

    router = CollectorRouter(
        youtube_builder=lambda **kwargs: yt_called.append(kwargs) or "fake_youtube",
        telegram_builder=lambda **kwargs: tg_called.append(kwargs) or "fake_telegram",
        x_builder=lambda **kwargs: x_called.append(kwargs) or "fake_x",
        tiktok_builder=lambda **kwargs: tt_called.append(kwargs) or "fake_tiktok",
    )

    # Route YouTube
    col_yt = router.get_collector("youtube", channel_id="UC1234567890123456789012")
    assert col_yt == "fake_youtube"
    assert len(yt_called) == 1

    # Route Telegram
    col_tg = router.get_collector("telegram", channel_id="@arabic_channel")
    assert col_tg == "fake_telegram"
    assert len(tg_called) == 1

    # Route X
    col_x = router.get_collector("x", channel_id="@x_channel")
    assert col_x == "fake_x"
    assert len(x_called) == 1

    # Route TikTok
    col_tt = router.get_collector("tiktok", channel_id="@tiktok_creator")
    assert col_tt == "fake_tiktok"
    assert len(tt_called) == 1

    # Facebook and Instagram route like the others, with their own builders
    fb_called, ig_called = [], []
    router = CollectorRouter(
        facebook_builder=lambda **kwargs: fb_called.append(kwargs) or "fake_facebook",
        instagram_builder=lambda **kwargs: ig_called.append(kwargs) or "fake_instagram",
    )
    assert router.get_collector("facebook", channel_id="aljazeera") == "fake_facebook"
    assert fb_called == [{"channel_id": "aljazeera", "token": None}]
    assert router.get_collector("instagram", channel_id="natgeo", token="ig") == "fake_instagram"
    assert ig_called == [{"channel_id": "natgeo", "token": "ig"}]
    # Without a builder, the default collectors are built rather than refused
    from collectors.facebook_collector import FacebookCollector
    from collectors.instagram_collector import InstagramCollector

    assert isinstance(CollectorRouter().get_collector("facebook", channel_id="aljazeera"), FacebookCollector)
    assert isinstance(CollectorRouter().get_collector("instagram", channel_id="natgeo"), InstagramCollector)

    # Route unknown platform raises ValueError
    with pytest.raises(ValueError, match="unsupported_platform"):
        router.get_collector("myspace")


def test_runner_collector_for_platform_resolution():
    class DummyPlane:
        pass

    plane = DummyPlane()

    # YouTube lease
    yt_lease = {
        "external_channel_id": "UC1234567890123456789012",
        "platform": "youtube",
    }
    col, reason, ch = _collector_for(
        plane,
        yt_lease,
        build_collector=lambda tok, exp=None, ren=None, channel_id=None, platform="youtube": (
            "built_yt" if platform == "youtube" else None
        ),
    )
    assert col == "built_yt"
    assert reason is None
    assert ch == "UC1234567890123456789012"

    # Telegram lease
    tg_lease = {
        "external_channel_id": "@aljazeera",
        "platform": "telegram",
    }
    col, reason, ch = _collector_for(
        plane,
        tg_lease,
        build_collector=lambda tok, exp=None, ren=None, channel_id=None, platform="youtube": (
            "built_tg" if platform == "telegram" else None
        ),
    )
    assert col == "built_tg"
    assert reason is None
    assert ch == "@aljazeera"

    # X lease
    x_lease = {
        "external_channel_id": "@elonmusk",
        "platform": "x",
    }
    col, reason, ch = _collector_for(
        plane,
        x_lease,
        build_collector=lambda tok, exp=None, ren=None, channel_id=None, platform="youtube": (
            "built_x" if platform == "x" else None
        ),
    )
    assert col == "built_x"
    assert reason is None
    assert ch == "@elonmusk"

    # TikTok lease
    tt_lease = {
        "external_channel_id": "@khaby.lame",
        "platform": "tiktok",
    }
    col, reason, ch = _collector_for(
        plane,
        tt_lease,
        build_collector=lambda tok, exp=None, ren=None, channel_id=None, platform="youtube": (
            "built_tt" if platform == "tiktok" else None
        ),
    )
    assert col == "built_tt"
    assert reason is None
    assert ch == "@khaby.lame"
