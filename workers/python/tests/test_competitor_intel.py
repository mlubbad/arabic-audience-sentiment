"""Unit tests for the 11-Point Competitor Intelligence & SWOT Battlecard Analyzer."""

from __future__ import annotations

import json
import httpx

from enrichment.competitor_intel import (
    CompetitorIntelligenceAnalyzer,
    analyze_competitor_deterministic,
    build_gradual_pacing_plan,
)


def test_build_gradual_pacing_plan_steps_smoothly():
    plan = build_gradual_pacing_plan(1.0, 3.0)
    assert plan.target_weekly_posts == 3.0
    assert plan.week_1_schedule == [1, 2, 1, 2]
    assert plan.week_2_schedule == [3, 3, 3, 3]


def test_deterministic_analysis_detects_dormant_giant_and_bilingual_casual_tone():
    own = {
        "subscribers": 10_000,
        "views_per_video": 5_000,
        "topics_covered": ["Tech", "AI", "Cloud"],
    }
    comp = {
        "external_id": "UC_comp_01",
        "subscribers": 50_000,
        "views_per_video": 2_000,
        "videos_per_week": 0.4,
        "subscribers_change": -10,
        "topics_covered": ["Tech"],
        "default_language": "ar",
    }
    titles = [
        "إزاي تبدأ في الـ AI خطوة بخطوة للمبتدئين",
        "شرح عملي لـ Cloud Computing عشان توفر وقتك",
    ]
    verdict = analyze_competitor_deterministic(own, comp, recent_titles=titles)
    assert verdict.capacity_state == "dormant_brand_opportunity"
    assert verdict.funnel_stage == "consideration"
    assert verdict.next_funnel_stage == "decision"
    assert verdict.tone_of_voice == "bilingual_friendly"
    assert verdict.topic_gaps == ["AI", "Cloud"]
    assert "strong_subscriber_base" in verdict.strengths
    assert "low_publishing_frequency" in verdict.weaknesses
    assert verdict.opportunity_gap == "dormant_giant_capture"


def test_analyzer_uses_gemini_flex_and_falls_back_cleanly():
    def handler(request: httpx.Request) -> httpx.Response:
        payload = json.loads(request.content.decode("utf-8"))
        assert payload.get("serviceTier") == "flex"
        return httpx.Response(
            200,
            json={
                "candidates": [
                    {
                        "content": {
                            "parts": [
                                {
                                    "text": json.dumps(
                                        {
                                            "funnel_stage": "consideration",
                                            "tone_of_voice": "casual",
                                            "cta_pattern": "اكتب كورس محتوى في التعليقات",
                                            "strengths": ["محتوى تعليمي تطبيقي"],
                                            "weaknesses": ["غياب الفيديوهات القصيرة"],
                                            "opportunity_gap": "التفوق عبر سلسلة Reels يومية مركزة",
                                            "threat_level": "high",
                                        }
                                    )
                                }
                            ]
                        }
                    }
                ]
            },
        )

    client = httpx.Client(transport=httpx.MockTransport(handler))
    analyzer = CompetitorIntelligenceAnalyzer(api_key="test-key", http=client)
    verdict = analyzer.analyze(
        {"subscribers": 1000, "views_per_video": 500, "topics_covered": ["AI"]},
        {"external_id": "UC_comp_02", "subscribers": 2000, "views_per_video": 800},
        recent_titles=["كيف تكتب محتوى تسويقي ناجح؟"],
    )
    assert verdict.analysis_source == "ai_enriched"
    assert verdict.funnel_stage == "consideration"
    assert verdict.next_funnel_stage == "decision"
    assert verdict.tone_of_voice == "casual"
    assert verdict.cta_pattern == "اكتب كورس محتوى في التعليقات"
    assert verdict.opportunity_gap == "التفوق عبر سلسلة Reels يومية مركزة"
    assert verdict.threat_level == "high"
