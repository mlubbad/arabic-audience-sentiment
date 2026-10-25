"""Unit tests for the context-rich, domain-aware Gemini Batch sentiment classifier."""

from __future__ import annotations

import json
from types import SimpleNamespace

from sentiment.gemini_batch import (
    ChannelContext,
    ContextualComment,
    GeminiContextualSentimentAdapter,
    VideoContext,
    build_contextual_sentiment_prompt,
    infer_channel_domain,
    parse_chunk_verdicts,
)


def test_infer_channel_domain_across_three_domains():
    assert (
        infer_channel_domain(
            "AJ360 - الجزيرة 360",
            "@aljazeera360",
            "الواجهة الرقمية الشاملة لشبكة الجزيرة الإعلامية",
            ["الجزيرة 360"],
            ["Politics"],
        )
        == "news_media"
    )
    assert (
        infer_channel_domain(
            "افلا يتدبرون",
            "@afala_yatadabaron",
            "قناة أفلا يتدبرون القرآن",
            ["تفسير القران", "دروس دينية"],
            ["Religion"],
        )
        == "religion_preaching"
    )
    assert (
        infer_channel_domain(
            "shfa",
            "@shfa-1",
            "محتوى تعليمي ترفيهي فلوقات وتحديات",
            ["شفا"],
            ["Lifestyle"],
        )
        == "entertainment_comedy_kids"
    )
    assert (
        infer_channel_domain(
            "Dr. Mohammed Lubbad | د. محمد لبد",
            "@mohammedalubbad",
            "الذكاء الاصطناعي بالعربي",
            ["الذكاء الاصطناعي", "تعلم الآلة"],
            ["Technology"],
        )
        == "education_tech"
    )


def test_build_contextual_prompt_includes_all_hierarchy_layers():
    ch = ChannelContext(
        channel_id="ch-1",
        workspace_id="ws-1",
        title="AJ360 - الجزيرة 360",
        handle="@aljazeera360",
        domain="news_media",
        description="منصة الجزيرة 360 للبرامج الوثائقية والحوارية",
        keywords=("الجزيرة", "وثائقي"),
        topic_categories=("https://en.wikipedia.org/wiki/Politics",),
    )
    vid = VideoContext(
        video_id="v-1",
        external_video_id="rnY-vHTBhAA",
        title="العالمة السعودية حياة سندي.. كيف سخّرت ابتكاراتها لخدمة المرضى؟ | ما الجدوى؟ مع أمجد النور",
        description="حوار مع حياة سندي حول الابتكار الطبي",
        tags=("حياة سندي", "أمجد النور"),
        transcript_excerpt="في هذه الحلقة نستضيف العالمة حياة سندي للحديث عن أجهزة التشخيص الميسرة.",
    )
    comments = [
        ContextualComment(
            comment_id="c-1",
            external_comment_id="ext-1",
            content_hash="h-1",
            text="لا حول ولا قوة إلا بالله، اللهم اشفِ كل مريض",
            is_reply=True,
            parent_text="ثمن التحاليل يقف عائقاً أمام علاج الفقراء",
            sibling_texts=("فعلاً كلام مؤثر جداً",),
            old_label="negative",
        )
    ]
    prompt = build_contextual_sentiment_prompt(ch, vid, comments)
    assert "AJ360 - الجزيرة 360" in prompt
    assert "حياة سندي" in prompt
    assert "أمجد النور" in prompt
    assert "النص المفرّغ للحلقة" in prompt
    assert "ردّاً على التعليق الأب" in prompt
    assert "تعليقات رفاق السلسلة" in prompt


def test_parse_chunk_verdicts_and_escalation():
    items = [
        ContextualComment(
            comment_id="c-1",
            external_comment_id="ext-1",
            content_hash="h-1",
            text="يا سفا انا زمان اتابعك ماشاءالله كبرتي ❤",
            old_label="negative",
        ),
        ContextualComment(
            comment_id="c-2",
            external_comment_id="ext-2",
            content_hash="h-2",
            text="حلقة عجيبة بس فيها تناقض غريب",
            old_label="neutral",
        ),
    ]
    raw_response = json.dumps([
        {
            "index": 0,
            "label": "positive",
            "confidence": 0.96,
            "positive_score": 0.96,
            "negative_score": 0.01,
            "neutral_score": 0.02,
            "mixed_score": 0.01,
            "ambiguous": False,
            "reason_ar": "تعليق طفولي عفوي يعبّر عن الحب والحنين وإعجاب المتابعة بنمو صانعة المحتوى شفا.",
        },
        {
            "index": 1,
            "label": "mixed",
            "confidence": 0.65,
            "positive_score": 0.30,
            "negative_score": 0.25,
            "neutral_score": 0.05,
            "mixed_score": 0.40,
            "ambiguous": True,
            "reason_ar": "يجمع بين الإعجاب بالحلقة وملاحظة التناقض فيها — يحتاج تدقيقاً.",
        },
    ])
    verdicts, esc_idxs = parse_chunk_verdicts(raw_response, items, model_id="test-model")
    assert len(verdicts) == 2
    assert verdicts[0].label == "positive"
    assert verdicts[0].reason_ar.startswith("[تصحيح سياقي من negative إلى positive]")
    assert "—" not in verdicts[1].reason_ar
    assert esc_idxs == [1]


def test_predict_contextual_and_analyse_pass_thread_and_video_context():
    from collectors.protocol import RawComment
    from server.analysis import analyse

    captured_bodies = []

    class FakeHttpClient:
        def post(self, url, headers=None, json=None, timeout=None):
            captured_bodies.append(json)
            resp_payload = [
                {
                    "index": 0,
                    "label": "negative",
                    "confidence": 0.91,
                    "positive_score": 0.02,
                    "negative_score": 0.91,
                    "neutral_score": 0.05,
                    "mixed_score": 0.02,
                    "ambiguous": False,
                    "reason_ar": "شكوى من ارتفاع الأسعار.",
                },
                {
                    "index": 1,
                    "label": "positive",
                    "confidence": 0.93,
                    "positive_score": 0.93,
                    "negative_score": 0.02,
                    "neutral_score": 0.03,
                    "mixed_score": 0.02,
                    "ambiguous": False,
                    "reason_ar": "إشادة بتغطية البرنامج للمشكلة في الرد على التعليق الأب.",
                },
            ]
            return SimpleNamespace(
                status_code=200,
                json=lambda: {
                    "candidates": [
                        {"content": {"parts": [{"text": __import__("json").dumps(resp_payload)}]}}
                    ]
                },
            )

    adapter = GeminiContextualSentimentAdapter("test-key", FakeHttpClient())  # type: ignore[arg-type]
    comments = [
        RawComment(id="parent-1", video_id="vid-1", text="الأسعار صارت نار", published_at="2026-10-20T10:00:00Z"),
        RawComment(
            id="reply-1",
            video_id="vid-1",
            text="شكراً للقناة على تسليط الضوء على هذا الملف",
            published_at="2026-10-20T10:05:00Z",
            parent_id="parent-1",
            is_reply=True,
        ),
    ]
    records = analyse(
        adapter,
        comments,
        video={"external_video_id": "vid-1", "title": "تحقيق خاص عن غلاء المعيشة"},
        channel={"title": "الجزيرة 360", "handle": "@aljazeera360", "platform": "youtube"},
    )
    assert len(records) == 2
    assert records[0]["label"] == "negative"
    assert records[1]["label"] == "positive"
    assert len(captured_bodies) == 1
    prompt_sent = captured_bodies[0]["contents"][0]["parts"][0]["text"]
    assert "تحقيق خاص عن غلاء المعيشة" in prompt_sent
    assert "الجزيرة 360" in prompt_sent
    assert "ردّاً على التعليق الأب: «الأسعار صارت نار»" in prompt_sent

