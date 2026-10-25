"""11-Point Competitor Intelligence & SWOT Battlecard Analyzer (SKY-207 / ADR-0008).

Combines Yara Gomaa's 11-point Arabic Social & Content Competitor Framework with
global Battlecard (Klue/Crayon), Jobs-to-be-Done Funnel Stage, Audience Capacity
& Anti-Shock Gradual Pacing, and Evidence-Backed SWOT Gap methodologies.

Supports Gemini 3.1 Flash Lite (`serviceTier="flex"` with automatic standard-tier
retry) and a deterministic Arabic/English analytical engine so every competitor
card is populated even when external LLM credits are unavailable.
"""

from __future__ import annotations

from dataclasses import dataclass, field
import json
import re
from typing import Any

import httpx

GEMINI_ENDPOINT = (
    "https://generativelanguage.googleapis.com/v1beta/models/"
    "gemini-3.1-flash-lite-preview:generateContent"
)

VALID_CONNECTIONS = {"tailored_multi", "mirrored_multi", "single_focus", "unknown"}
VALID_FORMATS = {"video", "short", "stream", "carousel", "post", "mixed", "unknown"}
VALID_FUNNELS = {
    "awareness",
    "consideration",
    "engagement",
    "decision",
    "mixed",
    "unknown",
}
VALID_TONES = {
    "formal",
    "semi_formal",
    "casual",
    "irreverent",
    "bilingual_friendly",
    "bilingual_premium",
    "unknown",
}
VALID_THREATS = {"high", "medium", "low"}

_CONSIDERATION_RE = re.compile(
    r"(كيف|إزاي|ازاي|شرح|خطوات|نصائح|تعلم|دليل|طريقة|اسرار|أسرار|how to|guide|tutorial|tips)",
    re.IGNORECASE,
)
_ENGAGEMENT_RE = re.compile(
    r"(رأيك|سؤال|شارك|بث مباشر|لايف|تحدي|مسابقة|live|q&a|poll|اسأل)",
    re.IGNORECASE,
)
_DECISION_RE = re.compile(
    r"(اشترك|احجز|كورس|خصم|عرض|سجل|انضم|شراء|باقة|منتورشيب|course|offer|join|buy|book)",
    re.IGNORECASE,
)
_CASUAL_RE = re.compile(
    r"(إزاي|ازاي|دلوقتي|عشان|بتاع|مفيش|كده|يلا|بجد|جامد|حاجة)",
    re.IGNORECASE,
)
_LATIN_RE = re.compile(r"[A-Za-z]{3,}")
_ARABIC_RE = re.compile(r"[\u0600-\u06FF]{3,}")


@dataclass(frozen=True)
class GradualPacingPlan:
    """Two-week step-up/step-down schedule preventing algorithmic reach shock."""

    current_weekly_posts: float | None
    target_weekly_posts: float
    week_1_schedule: list[int]
    week_2_schedule: list[int]


@dataclass(frozen=True)
class CompetitorIntelligenceVerdict:
    """Complete 11-point competitor intelligence and SWOT battlecard."""

    external_id: str
    connection_between_platforms: str
    primary_platform: str
    capacity_state: str
    dominant_format: str
    funnel_stage: str
    next_funnel_stage: str
    outflanking_play_steps: list[str]
    topics_covered: list[str]
    topic_gaps: list[str]
    tone_of_voice: str
    cta_pattern: str | None
    conversion_channel: str | None
    visual_style: str | None
    strengths: list[str] = field(default_factory=list)
    weaknesses: list[str] = field(default_factory=list)
    opportunity_gap: str = ""
    threat_level: str = "medium"
    analysis_source: str = "automated"

    def to_rpc_payload(self) -> dict[str, Any]:
        return {
            "connection_between_platforms": self.connection_between_platforms,
            "primary_platform": self.primary_platform,
            "dominant_format": self.dominant_format,
            "funnel_stage": self.funnel_stage,
            "tone_of_voice": self.tone_of_voice,
            "cta_pattern": self.cta_pattern,
            "conversion_channel": self.conversion_channel,
            "visual_style": self.visual_style,
            "strengths": self.strengths[:10],
            "weaknesses": self.weaknesses[:10],
            "opportunity_gap": self.opportunity_gap[:500] if self.opportunity_gap else None,
            "threat_level": self.threat_level,
        }


def build_gradual_pacing_plan(
    current_weekly: float | None, benchmark_weekly: float | None
) -> GradualPacingPlan:
    """Apply Yara Gomaa's Point-3 gradual pacing rule to avoid sudden reach drops."""
    cur = float(current_weekly) if current_weekly is not None else 2.0
    bench = float(benchmark_weekly) if benchmark_weekly is not None else 3.0
    target = max(1.0, min(max(cur, bench), 7.0))
    mid = max(1, round((cur + target) / 2.0))
    start = max(1, round(cur))
    goal = max(1, round(target))
    return GradualPacingPlan(
        current_weekly_posts=current_weekly,
        target_weekly_posts=round(target, 1),
        week_1_schedule=[start, mid, start, mid],
        week_2_schedule=[goal, goal, goal, goal],
    )


def next_funnel_stage(stage: str) -> str:
    if stage == "awareness":
        return "consideration"
    if stage in ("consideration", "engagement"):
        return "decision"
    return "engagement"


def outflanking_play_steps(stage: str) -> list[str]:
    """3-step funnel outflanking play (Problem -> Self-Serve Tip -> Product Bridge)."""
    if stage == "awareness":
        return [
            "طرح المشكلة الحقيقية التي يواجهها الجمهور بلغة مباشرة",
            "تقديم نصيحة عملية قابلة للتطبيق الذاتي فوراً (Consideration)",
            "ربط النصيحة بالحل المتكامل الذي تقدمه قناتك أو خدمتك",
        ]
    if stage == "consideration":
        return [
            "تسمية العقبة التنفيذية التي تعيق الجمهور رغم معرفته بالنصائح العامة",
            "عرض خطوة تطبيقية مختصرة تثبت الخبرة العملية",
            "تقديم دعوة مباشرة لاتخاذ القرار (Decision CTA) مع دليل اجتماعي واضح",
        ]
    return [
            "الانطلاق من سؤال متكرر في تعليقات الجمهور",
            "تقديم مقارنة عملية شفافة توضح الفرق في النتيجة",
            "توجيه المتابع إلى مسار تحويل واضح ومباشر في الوصف أو التعليق المثبت",
        ]


def analyze_competitor_deterministic(
    own_profile: dict[str, Any],
    candidate: dict[str, Any],
    recent_titles: list[str] | None = None,
) -> CompetitorIntelligenceVerdict:
    """Evidence-backed deterministic 11-point analysis when LLM is unavailable."""
    ext_id = str(candidate.get("external_id") or "")
    own_subs = own_profile.get("subscribers")
    own_vpv = own_profile.get("views_per_video")
    own_topics = list(own_profile.get("topics_covered") or [])

    c_subs = candidate.get("subscribers")
    c_vpv = candidate.get("views_per_video")
    c_vpw = candidate.get("videos_per_week")
    c_sub_change = candidate.get("subscribers_change")
    c_topics = list(candidate.get("topics_covered") or candidate.get("topic_categories") or [])
    c_lang = str(candidate.get("default_language") or "ar").lower()

    size_ratio: float | None = None
    if isinstance(own_subs, (int, float)) and own_subs > 0 and isinstance(c_subs, (int, float)):
        size_ratio = round(float(c_subs) / float(own_subs), 2)

    # Point 3: Capacity state
    capacity_state = "balanced_growth"
    if isinstance(c_vpw, (int, float)) and c_vpw >= 3.0:
        if isinstance(c_vpv, (int, float)) and (
            not isinstance(own_vpv, (int, float)) or c_vpv >= own_vpv
        ):
            capacity_state = "high_trust_high_frequency"
        elif isinstance(c_vpv, (int, float)) and isinstance(own_vpv, (int, float)) and c_vpv < own_vpv * 0.6:
            capacity_state = "volume_diluted"
    elif (
        size_ratio is not None
        and size_ratio >= 1.5
        and isinstance(c_vpw, (int, float))
        and c_vpw < 1.0
    ):
        capacity_state = "dormant_brand_opportunity"

    # Point 6 & 8 from recent titles or profile metadata
    titles = [t for t in (recent_titles or []) if t and t.strip()]
    joined_titles = " \n ".join(titles)
    if titles:
        cons = sum(1 for t in titles if _CONSIDERATION_RE.search(t))
        eng = sum(1 for t in titles if _ENGAGEMENT_RE.search(t))
        dec = sum(1 for t in titles if _DECISION_RE.search(t))
        aware = max(0, len(titles) - (cons + eng + dec))
        if cons >= aware and cons >= dec:
            funnel_stage = "consideration"
        elif dec > aware and dec > cons:
            funnel_stage = "decision"
        elif eng > aware:
            funnel_stage = "engagement"
        else:
            funnel_stage = "awareness"

        has_ar = bool(_ARABIC_RE.search(joined_titles))
        has_en = bool(_LATIN_RE.search(joined_titles))
        is_casual = bool(_CASUAL_RE.search(joined_titles))
        if has_ar and has_en:
            tone = "bilingual_friendly"
        elif is_casual:
            tone = "casual"
        elif c_lang.startswith("en"):
            tone = "bilingual_premium"
        else:
            tone = "semi_formal"
    else:
        if (
            isinstance(c_vpv, (int, float))
            and isinstance(own_vpv, (int, float))
            and c_vpv > own_vpv
        ):
            funnel_stage = "consideration"
        else:
            funnel_stage = "awareness"
        tone = "bilingual_premium" if c_lang.startswith("en") else "semi_formal"

    topic_gaps = [t for t in own_topics if t not in c_topics]

    # Point 11: Evidence-backed Strengths & Weaknesses
    strengths: list[str] = []
    weaknesses: list[str] = []

    if size_ratio is not None and size_ratio > 1.2:
        strengths.append("strong_subscriber_base")
    if (
        isinstance(c_vpv, (int, float))
        and isinstance(own_vpv, (int, float))
        and c_vpv > own_vpv * 1.15
    ):
        strengths.append("high_views_per_video")
    if isinstance(c_vpw, (int, float)) and c_vpw >= 2.0:
        strengths.append("consistent_publishing_cadence")
    if isinstance(c_sub_change, (int, float)) and c_sub_change > 0:
        strengths.append("positive_subscriber_momentum")
    if len(c_topics) >= 3:
        strengths.append("broad_topic_coverage")

    if isinstance(c_vpw, (int, float)) and c_vpw < 1.0:
        weaknesses.append("low_publishing_frequency")
    if (
        isinstance(c_vpv, (int, float))
        and isinstance(own_vpv, (int, float))
        and c_vpv < own_vpv * 0.85
    ):
        weaknesses.append("lower_views_per_video_than_own")
    if capacity_state == "volume_diluted":
        weaknesses.append("volume_diluted_reach")
    if topic_gaps:
        weaknesses.append("uncovered_audience_topics")
    if isinstance(c_sub_change, (int, float)) and c_sub_change <= 0:
        weaknesses.append("stagnant_subscriber_growth")

    if capacity_state == "dormant_brand_opportunity":
        opportunity_gap = "dormant_giant_capture"
    elif capacity_state == "volume_diluted":
        opportunity_gap = "quality_over_quantity_outflank"
    elif topic_gaps:
        opportunity_gap = "own_uncovered_topic_clusters"
    elif funnel_stage == "awareness":
        opportunity_gap = "advance_funnel_to_consideration_and_decision"
    else:
        opportunity_gap = "differentiate_with_short_video_and_direct_cta"

    if (
        size_ratio is not None
        and size_ratio >= 1.5
        and isinstance(c_vpv, (int, float))
        and (not isinstance(own_vpv, (int, float)) or c_vpv >= own_vpv)
    ):
        threat_level = "high"
    elif size_ratio is not None and size_ratio >= 0.6:
        threat_level = "medium"
    else:
        threat_level = "low"

    return CompetitorIntelligenceVerdict(
        external_id=ext_id,
        connection_between_platforms="single_focus",
        primary_platform=str(candidate.get("primary_platform") or "youtube"),
        capacity_state=capacity_state,
        dominant_format=str(candidate.get("dominant_format") or "video"),
        funnel_stage=funnel_stage,
        next_funnel_stage=next_funnel_stage(funnel_stage),
        outflanking_play_steps=outflanking_play_steps(funnel_stage),
        topics_covered=c_topics,
        topic_gaps=topic_gaps,
        tone_of_voice=tone,
        cta_pattern=candidate.get("cta_pattern"),
        conversion_channel=candidate.get("conversion_channel"),
        visual_style=candidate.get("visual_style"),
        strengths=strengths,
        weaknesses=weaknesses,
        opportunity_gap=opportunity_gap,
        threat_level=threat_level,
        analysis_source="automated",
    )


class CompetitorIntelligenceAnalyzer:
    """Hybrid Gemini Flex + Deterministic 11-Point Competitor Intelligence Analyzer."""

    def __init__(
        self,
        api_key: str | None = None,
        http: httpx.Client | None = None,
        *,
        service_tier: str | None = "flex",
    ) -> None:
        self._key = (api_key or "").strip()
        self._http = http
        self._service_tier = service_tier

    def analyze(
        self,
        own_profile: dict[str, Any],
        candidate: dict[str, Any],
        recent_titles: list[str] | None = None,
    ) -> CompetitorIntelligenceVerdict:
        baseline = analyze_competitor_deterministic(
            own_profile, candidate, recent_titles=recent_titles
        )
        if not self._key or self._http is None or not recent_titles:
            return baseline

        prompt = (
            "أنت خبير استراتيجي في تحليل المنافسين وصناعة المحتوى الرقمي وفق منهجية الـ 11 نقطة.\n"
            f"قناتنا: {json.dumps(own_profile, ensure_ascii=False)}\n"
            f"المنافس: {json.dumps(candidate, ensure_ascii=False)}\n"
            f"أحدث عناوين المنافس: {json.dumps(recent_titles[:15], ensure_ascii=False)}\n"
            "أرجع JSON فقط بالحقول: funnel_stage (awareness|consideration|engagement|decision), "
            "tone_of_voice (formal|semi_formal|casual|irreverent|bilingual_friendly|bilingual_premium), "
            "cta_pattern, strengths (قائمة نصية قصيرة), weaknesses (قائمة نصية قصيرة), "
            "opportunity_gap (فرصة التفوق المباشرة), threat_level (high|medium|low)."
        )
        body: dict[str, Any] = {
            "contents": [{"parts": [{"text": prompt}]}],
            "generationConfig": {
                "temperature": 0.0,
                "responseMimeType": "application/json",
            },
        }
        if self._service_tier:
            body["serviceTier"] = self._service_tier

        try:
            resp = self._http.post(
                GEMINI_ENDPOINT,
                headers={"x-goog-api-key": self._key},
                json=body,
                timeout=30.0,
            )
            if (
                resp.status_code == 400
                and "serviceTier" in body
                and ("serviceTier" in resp.text or "service_tier" in resp.text)
            ):
                fallback_body = {k: v for k, v in body.items() if k != "serviceTier"}
                resp = self._http.post(
                    GEMINI_ENDPOINT,
                    headers={"x-goog-api-key": self._key},
                    json=fallback_body,
                    timeout=30.0,
                )
            if resp.status_code != 200:
                return baseline
            text = (
                resp.json()
                .get("candidates", [{}])[0]
                .get("content", {})
                .get("parts", [{}])[0]
                .get("text", "")
            )
            parsed = json.loads(text)
            if not isinstance(parsed, dict):
                return baseline
            f_stage = str(parsed.get("funnel_stage") or baseline.funnel_stage)
            if f_stage not in VALID_FUNNELS:
                f_stage = baseline.funnel_stage
            tone = str(parsed.get("tone_of_voice") or baseline.tone_of_voice)
            if tone not in VALID_TONES:
                tone = baseline.tone_of_voice
            threat = str(parsed.get("threat_level") or baseline.threat_level)
            if threat not in VALID_THREATS:
                threat = baseline.threat_level
            strengths = [
                str(x).strip()
                for x in (parsed.get("strengths") or baseline.strengths)
                if str(x).strip()
            ][:10]
            weaknesses = [
                str(x).strip()
                for x in (parsed.get("weaknesses") or baseline.weaknesses)
                if str(x).strip()
            ][:10]
            gap = str(parsed.get("opportunity_gap") or baseline.opportunity_gap).strip()
            cta = str(parsed.get("cta_pattern") or "").strip() or baseline.cta_pattern
            return CompetitorIntelligenceVerdict(
                external_id=baseline.external_id,
                connection_between_platforms=baseline.connection_between_platforms,
                primary_platform=baseline.primary_platform,
                capacity_state=baseline.capacity_state,
                dominant_format=baseline.dominant_format,
                funnel_stage=f_stage,
                next_funnel_stage=next_funnel_stage(f_stage),
                outflanking_play_steps=outflanking_play_steps(f_stage),
                topics_covered=baseline.topics_covered,
                topic_gaps=baseline.topic_gaps,
                tone_of_voice=tone,
                cta_pattern=cta,
                conversion_channel=baseline.conversion_channel,
                visual_style=baseline.visual_style,
                strengths=strengths or baseline.strengths,
                weaknesses=weaknesses or baseline.weaknesses,
                opportunity_gap=gap or baseline.opportunity_gap,
                threat_level=threat,
                analysis_source="ai_enriched",
            )
        except Exception:  # noqa: BLE001 — fallback cleanly to deterministic baseline
            return baseline
