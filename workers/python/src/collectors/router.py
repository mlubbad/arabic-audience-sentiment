"""Collector router for multi-platform support.

Maps lease platform ('youtube', 'telegram', 'x', 'tiktok', etc.)
to the corresponding collector implementation.
"""
from typing import Any, Callable
from .protocol import Collector, CollectionError
from .telegram_collector import TelegramCollector

SUPPORTED_PLATFORMS = ("youtube", "telegram", "x", "tiktok", "facebook", "instagram")


class CollectorRouter:
    """Routes collection requests to platform-specific collector adapters."""

    def __init__(
        self,
        youtube_builder: Callable[..., Any] | None = None,
        telegram_builder: Callable[..., Any] | None = None,
    ):
        self.youtube_builder = youtube_builder
        self.telegram_builder = telegram_builder

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

        # Omnichannel scaffolding: platform known, but collector adapter not yet active
        raise CollectionError(f"platform_{target_platform}_collector_not_configured", "blocked")
