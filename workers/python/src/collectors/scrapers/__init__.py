"""Scraper providers for social media platforms (Apify, Bright Data)."""

from .apify import ApifyClient
from .brightdata import BrightDataClient

__all__ = ["ApifyClient", "BrightDataClient"]
