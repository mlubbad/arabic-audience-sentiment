"""Unified enrichment package: sentiment + topic taxonomy + intent via TypeSafe Jev."""
from .protocol import EnrichedVerdict, EnrichmentItem, Enricher

__all__ = ["EnrichedVerdict", "EnrichmentItem", "Enricher"]
