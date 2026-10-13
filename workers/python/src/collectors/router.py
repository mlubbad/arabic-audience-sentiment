"""Collector router for multi-platform support.

Maps lease platform ('youtube', 'telegram', 'x', 'tiktok', etc.)
to the corresponding collector implementation.
"""

from typing import Any, Callable
from .protocol import Collector, CollectionError
from .facebook_collector import FacebookCollector
from .instagram_collector import InstagramCollector
from .telegram_collector import TelegramCollector
from .tiktok_collector import TikTokCollector
from .x_collector import XCollector

SUPPORTED_PLATFORMS = ("youtube", "telegram", "x", "tiktok", "facebook", "instagram")


class CollectorRouter:
    """Routes collection requests to platform-specific collector adapters."""

    def __init__(
        self,
        youtube_builder: Callable[..., Any] | None = None,
        telegram_builder: Callable[..., Any] | None = None,
        x_builder: Callable[..., Any] | None = None,
        tiktok_builder: Callable[..., Any] | None = None,
        facebook_builder: Callable[..., Any] | None = None,
        instagram_builder: Callable[..., Any] | None = None,
    ):
        self.youtube_builder = youtube_builder
        self.telegram_builder = telegram_builder
        self.x_builder = x_builder
        self.tiktok_builder = tiktok_builder
        self.facebook_builder = facebook_builder
        self.instagram_builder = instagram_builder

    def get_collector(
        self,
        platform: str | None = None,
        token: str | None = None,
        expires_at: str | None = None,
        renew: Any = None,
        channel_id: str | None = None,
    ) -> Collector | None:
        target_platform = (platform or "youtube").lower()

        if target_platform not in SUPPORTED_PLATFORMS:
            raise ValueError(f"unsupported_platform: {target_platform}")

        if target_platform == "youtube":
            if self.youtube_builder:
                return self.youtube_builder(
                    token=token,
                    expires_at=expires_at,
                    renew=renew,
                    channel_id=channel_id,
                )
            return None

        if target_platform == "telegram":
            if self.telegram_builder:
                return self.telegram_builder(
                    channel_id=channel_id,
                    token=token,
                )
            return TelegramCollector(channel_id=channel_id)

        if target_platform == "x":
            if self.x_builder:
                return self.x_builder(
                    channel_id=channel_id,
                    token=token,
                )
            return XCollector(channel_id=channel_id, bearer_token=token)

        if target_platform == "tiktok":
            if self.tiktok_builder:
                return self.tiktok_builder(
                    channel_id=channel_id,
                    token=token,
                )
            return TikTokCollector(channel_id=channel_id, access_token=token)

        if target_platform == "facebook":
            if self.facebook_builder:
                return self.facebook_builder(channel_id=channel_id, token=token)
            return FacebookCollector(channel_id=channel_id, access_token=token)

        if target_platform == "instagram":
            if self.instagram_builder:
                return self.instagram_builder(channel_id=channel_id, token=token)
            return InstagramCollector(channel_id=channel_id, access_token=token)

        # A platform the constraint names but no adapter serves yet.
        raise CollectionError(f"platform_{target_platform}_collector_not_configured", "blocked")
