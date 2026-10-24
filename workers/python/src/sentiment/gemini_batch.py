"""Context-rich, domain-aware Gemini Batch API sentiment classifier and correction engine.

Implements a scientific 4-class sentiment methodology (``positive``, ``negative``,
``neutral``, ``mixed``) tailored to YouTube and social channels across three core domains:
1. ``news_media``: News, journalism, media networks, and advertising (separating event
   tragedy/empathy from stance toward the channel, presenter, guest, or actors).
2. ``entertainment_comedy_kids``: Entertainment, comedy sketches, vlogs, gaming, and
   children/family channels (handling hyperbolic laughter slang, emojis, child typos,
   and playful teasing).
3. ``religion_preaching``: Religious sermons, Quranic recitation, preaching (Da'wah),
   and spiritual nasheeds (handling supplications/du'a, multilingual dhikr, scholarly
   defense with negation particles, and personal-distress confessions).

Feeds Gemini full hierarchical context per video chunk:
- Channel metadata (owner/hosts, domain, description, keywords, topic categories).
- Video/episode metadata (title, description, tags, guests/entities, and transcript/captions excerpt).
- Thread & companion context (parent comment for replies, sibling replies in the same thread,
  and surrounding comments on the same video).

Executes via Google Gemini Batch API (``:batchGenerateContent`` at 50% cost discount) using a
smart two-tier hybrid pipeline:
- Tier 1: ``gemini-3.8-flash`` Batch API over all comment chunks.
- Tier 2: Automatic escalation of low-confidence or complex/ambiguous items to ``gemini-4-argon``
  Batch API with ``thinkingLevel="high"``.
"""

from __future__ import annotations

import hashlib
import html
import json
import math
import re
import time
import urllib.parse
from dataclasses import dataclass
from typing import Any, Literal, Sequence

import httpx

from .preprocess import PREPROCESSING_VERSION, is_analysable, normalize_arabic_text
from .protocol import Label, Prediction
from .registry import LABELS, parameters_digest

PROMPT_VERSION = "gemini-ctx-batch-v1"
DEFAULT_FLASH_MODEL = "gemini-3.8-flash"
DEFAULT_ARGON_MODEL = "gemini-4-argon"
DEFAULT_CHUNK_SIZE = 40
ESCALATION_CONFIDENCE_THRESHOLD = 0.75

DomainKey = Literal[
    "news_media",
    "entertainment_comedy_kids",
    "religion_preaching",
    "education_tech",
]


@dataclass(frozen=True)
class ChannelContext:
    channel_id: str
    workspace_id: str
    title: str
    handle: str = ""
    platform: str = "youtube"
    domain: DomainKey = "entertainment_comedy_kids"
    description: str = ""
    keywords: tuple[str, ...] = ()
    topic_categories: tuple[str, ...] = ()
    genres: tuple[str, ...] = ()


@dataclass(frozen=True)
class VideoContext:
    video_id: str
    external_video_id: str
    title: str
    kind: str = "video"
    published_at: str = ""
    description: str = ""
    tags: tuple[str, ...] = ()
    transcript_excerpt: str = ""


@dataclass(frozen=True)
class ContextualComment:
    comment_id: str
    external_comment_id: str
    content_hash: str
    text: str
    is_reply: bool = False
    external_parent_id: str | None = None
    parent_text: str | None = None
    sibling_texts: tuple[str, ...] = ()
    old_label: str | None = None


@dataclass(frozen=True)
class ContextualVerdict:
    comment_id: str
    external_comment_id: str
    content_hash: str
    status: Literal["succeeded", "skipped", "failed"]
    label: Label | None
    confidence: float
    scores: dict[str, float]
    reason_ar: str
    model_id: str
    revision: str
    escalated_to_argon: bool = False


def infer_channel_domain(
    title: str,
    handle: str = "",
    description: str = "",
    keywords: Sequence[str] = (),
    topic_categories: Sequence[str] = (),
) -> DomainKey:
    """Classify a channel into one of the three core scientific domains (or education_tech)."""
    blob = " ".join([
        title or "",
        handle or "",
        description or "",
        " ".join(keywords or ()),
        " ".join(topic_categories or ()),
    ]).lower()

    religion_markers = (
        "قرآن", "قران", "تفسير", "يتدبرون", "عبد الكافي", "السويدان", "الشيخ",
        "دعوة", "إسلام", "اسلام", "الأناشيد", "ماهر زين", "maher zain", "religion",
        "quran", " خطب", "محاضرات دينية", "سيرة", "الأنبياء", "yahya hawwa", "sky echo",
    )
    news_markers = (
        "الجزيرة", "aj360", "aljazeera", "الشرق", "asharq", "skynews", "أخبار",
        "اخبار", "news", "politics", "military", "عاجل", "بلومبيرغ", "تغطية",
        "سياسة", "حرب", "warlife",
    )
    edu_markers = (
        "الذكاء الاصطناعي", "محمد لبد", "lubbad", "دروس أونلاين", "droosonline",
        "شارع العلوم", "دوباميكافين", "هل تعلم", "فكر تاني", "عمرديزر", "فيصل السيف",
    )
    if any(m in blob for m in religion_markers):
        return "religion_preaching"
    if any(m in blob for m in news_markers):
        return "news_media"
    if any(m in blob for m in edu_markers):
        return "education_tech"
    return "entertainment_comedy_kids"


def fetch_youtube_transcript_excerpt(external_video_id: str, max_chars: int = 1200) -> str:
    """Best-effort extraction of YouTube caption tracks (Arabic or English) without API quota cost."""
    if not external_video_id or not re.match(r"^[A-Za-z0-9_-]{6,20}$", external_video_id):
        return ""
    try:
        watch_url = f"https://www.youtube.com/watch?v={urllib.parse.quote(external_video_id)}"
        headers = {
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
            "Accept-Language": "ar,en-US;q=0.9,en;q=0.8",
        }
        with httpx.Client(timeout=8.0) as client:
            resp = client.get(watch_url, headers=headers)
            if resp.status_code != 200:
                return ""
            html_text = resp.text
            match = re.search(r'"captionTracks":(\[.*?\])', html_text)
            if not match:
                return ""
            tracks = json.loads(match.group(1))
            if not isinstance(tracks, list) or not tracks:
                return ""
            chosen = next(
                (t for t in tracks if str(t.get("languageCode", "")).startswith("ar")),
                tracks[0],
            )
            base_url = chosen.get("baseUrl")
            if not isinstance(base_url, str) or not base_url.startswith("https://www.youtube.com/api/timedtext"):
                return ""
            c_resp = client.get(base_url, headers=headers)
            if c_resp.status_code != 200:
                return ""
            xml_text = c_resp.text
        snippets = [
            html.unescape(seg).replace("\n", " ").strip()
            for seg in re.findall(r"<text[^>]*>(.*?)</text>", xml_text, flags=re.DOTALL)
            if seg and seg.strip()
        ]
        joined = " ".join(snippets)
        joined = re.sub(r"\s+", " ", joined).strip()
        return joined[:max_chars]
    except Exception:  # noqa: BLE001 — optional caption fetch fallback
        return ""


_DOMAIN_GUIDELINES_AR: dict[DomainKey, str] = {
    "news_media": (
        "مجال القناة: الإعلام والأخبار والمنصات الوثائقية والحوارية.\n"
        "قواعد التصنيف العلمي لهذا المجال (Target-Dependent Stance vs. Event Emotion):\n"
        "1. افصل بين عاطفة الخبر/الحدث المأساوي وبين موقف المعلّق: التعليقات التي تتضمن حوقلة أو استرجاعاً "
        "أو دعاءً عاماً عند سماع خبر مؤلم (مثل: 'لا حول ولا قوة إلا بالله'، 'حسبي الله ونعم الوكيل'، 'رحمهم الله') "
        "هي تعاطف إنساني مع الحدث وليست هجوماً على القناة؛ تُصنَّف `neutral` إذا كانت تفاعلاً خبرياً مجرداً، "
        "أو `positive` إذا تضمنت إشادة بالتغطية أو البرنامج أو الضيف أو دعماً واضحاً لرسالة الحلقة.\n"
        "2. يُصنَّف التعليق `negative` عندما يحمل سخطاً، هجوماً، تكذيباً ('هذا كذب'، اتهام بالتضليل)، شتيمة بأي لغة "
        "(مثل 'she is stupid 😂' حتى لو احتوى على إيموجي ضحك ساخر)، أو هجوماً سياسياً/شخصياً على القناة أو المذيع أو الضيف أو الفاعل المذموم.\n"
        "3. يُصنَّف `mixed` عندما يجمع التعليق بين الإشادة بالبرنامج/المقدم وانتقاد ضيف أو فقرة أو موقف سياسي معين، "
        "أو يطرح تأييداً مشروطاً بنقد واضح.\n"
        "4. الاستفسارات البحتة عن موعد الحلقة أو رابط المشاهدة ('وين نشوف الحلقة كاملة؟') تُصنَّف `neutral`."
    ),
    "entertainment_comedy_kids": (
        "مجال القناة: الترفيه، الكوميديا، التحديات، الفلوقات العائلية، الألعاب، وقنوات الأطفال.\n"
        "قواعد التصنيف العلمي لهذا المجال (Pragmatic Polarity & Child/Comedy Discourse):\n"
        "1. المبالغات الكوميدية والدارجة الإيجابية (مثل: 'قتلتني ضحك'، 'موووت 😂'، 'دمرتني'، 'أوللللل'، 'الأفضل') "
        "والتعليقات المكونة من إيموجي الضحك والقلوب والتصفيق (😂❤️👏🔥🎉) هي تعبير عن الاستمتاع والبهجة وتُصنَّف `positive`.\n"
        "2. تعليقات الأطفال العفوية التي تحتوي على أخطاء إملائية كثيرة أو حروف غير مرتبة ممزوجة بقلوب أو عبارات حب "
        "(مثل: 'يا سفا انا زمان اتابعك... ماشاءالله كبرتي'، أو حروف عشوائية من طفل مع '❤') تُصنَّف `positive` لأنها تعبّر عن محبة وولاء للقناة.\n"
        "3. الطلبات الحماسية من الجمهور ('مشان الله العب ببجي'، 'نزل الجزء الرابع') تعكس شغفاً بالمحتوى وتُصنَّف `positive` (أو `neutral` إن كانت طلباً مجرداً بلا عاطفة)، ولا تُصنَّف `negative` أبداً.\n"
        "4. يُصنَّف التعليق `negative` فقط عند وجود انتقاد حقيقي، تذمّر، تنمّر/سخرية جارحة ضد صاحب القناة، أو شكوى من تراجع المحتوى.\n"
        "5. يُصنَّف `mixed` عندما يمدح المتابع الفيديو أو صانع المحتوى لكنه يبدي عتباً أو ملاحظة سلبية ('الفيديو رهيب بس الصوت واطي' أو 'أحبكم بس المقلب هذا مبالغ فيه')."
    ),
    "religion_preaching": (
        "مجال القناة: الخطاب الديني، الوعظي، التلاوات القرآنية، السيرة النبوية، والأناشيد الروحانية.\n"
        "قواعد التصنيف العلمي لهذا المجال (Religious & Spiritual Speech Acts):\n"
        "1. الأدعية، الأذكار، التأمين، الصلاة على النبي، والثناء على الداعية أو القارئ (مثل: 'اللهم آمين'، 'جزاك الله خيراً'، "
        "'اللهم اجعل القرآن ربيع قلوبنا'، أو الأذكار المكتوبة بالحروف اللاتينية/الإندونيسية مثل 'Subhanallah Alhamdulillah Aamiin 🤲❤') "
        "تعبّر عن خشوع وتفاعل إيماني إيجابي وتُصنَّف `positive`.\n"
        "2. الدفاع عن الشيخ أو القارئ وتوضيح مقصده العلمي أمام المنتقدين (مثل: 'الشيخ ما حكى رأيه الشخصي بل نقل إجماع الفقهاء') "
        "هو موقف مؤيد ومدافع عن القناة ويُصنَّف `positive` (احذر من تصنيفه سلبياً بسبب أداة النفي 'ما حكى').\n"
        "3. التعليقات التي تصدّق كلام الواعظ وتثني عليه لكنها تشتكي من ألم شخصي أو مشكلة أسرية/اجتماعية "
        "(مثل: 'صدقت يا شيخ كل هذه الصفات في زوجي وأنا أنتظر فرج الله أنقذوني' أو 'فعلاً لك فضل كبير علي بس كيف أثبت أمام الانتقادات') "
        "تُصنَّف `mixed` لأنها تمزج بين التأييد الإيجابي للخطاب الوعظي والشكوى/الألم في التجربة الواقعية.\n"
        "4. الأسئلة الفقهية أو الاستفسارات المجردة ('من هو القارئ؟'، 'ما اسم السورة؟') تُصنَّف `neutral` ما لم يغلب عليها الدعاء والثناء الصريح.\n"
        "5. الهجوم الطائفي، التكذيب، الشتم، أو الانتقاد اللاذع للداعية أو الشخصيات التاريخية يُصنَّف `negative`."
    ),
    "education_tech": (
        "مجال القناة: التعليم، تبسيط العلوم، الذكاء الاصطناعي، التقنية، وتطوير الذات.\n"
        "قواعد التصنيف العلمي لهذا المجال:\n"
        "1. الشكر، الإشادة بوضوح الشرح، التصفيق والقلوب (👏❤️)، والدعاء لصاحب القناة بالتوفيق يُصنَّف `positive`.\n"
        "2. الأسئلة العلمية والتقنية المجردة وطلبات شرح مواضيع إضافية بدون ثناء عاطفي تُصنَّف `neutral`.\n"
        "3. الإشادة بالحلقة مع استدراك علمي أو ملاحظة على الصوت/الإيقاع أو تخوّف من مخاطر التقنية المطروحة يُصنَّف `mixed`.\n"
        "4. التشكيك في صحة المعلومات، السخرية الجارحة، أو الهجوم على المقدم يُصنَّف `negative`."
    ),
}

_SYSTEM_INSTRUCTION_AR = (
    "أنت خبير أكاديمي في اللسانيات الحاسوبية وتحليل المشاعر السياقي (Context-Aware & Target-Dependent Sentiment Analysis) "
    "لتعليقات يوتيوب ومنصات التواصل باللغة العربية (بفصحاها وجميع لهجاتها: الخليجية، المصرية، الشامية، المغاربية، العراقية، والسودانية) "
    "والتعليقات متعددة اللغات أو المعرّبة (Arabizi / الإندونيسية الإسلامية / الإنجليزية) والإيموجي.\n"
    "مهمتك: قراءة السياق الكامل للقناة، والمؤلف/المقدم، والفيديو/الحلقة، وسلسلة الردود والرفاق، ثم تصنيف كل تعليق بدقة عالية إلى إحدى الفئات الأربع:\n"
    "- `positive`: مشاعر إيجابية، إعجاب، حب، ضحك واستمتاع، دعاء وتفاعل إيماني، تأييد، أو دفاع عن القناة/المحتوى.\n"
    "- `negative`: مشاعر سلبية، هجوم، سخرية جارحة، تكذيب، غضب، شكوى حادة، أو ذم.\n"
    "- `neutral`: استفسار معلوماتي مجرد، إشارة لصديق (mention)، ختم حضور محايد ('أول'، 'ثالث') بدون شحنة عاطفية، أو حوقلة خبرية عامة دون موقف.\n"
    "- `mixed`: امتزاج حقيقي بين مشاعر إيجابية وسلبية في نفس التعليق (مثل: مدح الحلقة مع نقد نقطة فيها، أو تصديق كلام الشيخ مع بثّ شكوى ومعاناة شخصية).\n\n"
    "شروط صارمة للمخرجات:\n"
    "1. أجب بمصفوفة JSON فقط تطابق المخطط المطلوب، بعنصر واحد لكل تعليق بنفس رقم `index`.\n"
    "2. إذا اختلف تصنيفك `label` عن `التصنيف القديم` المرفق مع التعليق (أو لم يكن للتعليق تصنيف قديم)، فاكتب في `reason_ar` جملة عربية فصيحة وموجزة تشرح سبب التصنيف في ضوء سياق القناة والحلقة والرفاق (دون استخدام الشرطة الطويلة em dash)؛ أما إذا تطابق تصنيفك مع التصنيف القديم تماماً فاجعل `reason_ar` نصاً فارغاً `\"\"`.\n"
    "3. ضع `ambiguous: true` فقط إذا كان التعليق معقداً جداً أو يحمل تهكماً خفياً أو التباساً سياقياً يحتاج تدقيقاً أعمق."
)

BATCH_ITEM_RESPONSE_SCHEMA: dict[str, Any] = {
    "type": "ARRAY",
    "items": {
        "type": "OBJECT",
        "properties": {
            "index": {"type": "INTEGER"},
            "label": {
                "type": "STRING",
                "enum": ["positive", "negative", "neutral", "mixed"],
            },
            "confidence": {"type": "NUMBER"},
            "positive_score": {"type": "NUMBER"},
            "negative_score": {"type": "NUMBER"},
            "neutral_score": {"type": "NUMBER"},
            "mixed_score": {"type": "NUMBER"},
            "ambiguous": {"type": "BOOLEAN"},
            "reason_ar": {"type": "STRING"},
        },
        "required": [
            "index",
            "label",
            "confidence",
            "positive_score",
            "negative_score",
            "neutral_score",
            "mixed_score",
            "ambiguous",
            "reason_ar",
        ],
    },
}


def build_contextual_sentiment_prompt(
    channel: ChannelContext,
    video: VideoContext,
    items: Sequence[ContextualComment],
) -> str:
    """Build the rich context-aware prompt for a chunk of comments on a single video."""
    domain_guide = _DOMAIN_GUIDELINES_AR.get(channel.domain, _DOMAIN_GUIDELINES_AR["entertainment_comedy_kids"])
    lines: list[str] = [
        "=== أولاً: المنهجية العلمية الخاصة بمجال القناة ===",
        domain_guide,
        "",
        "=== ثانياً: سياق القناة وأصحابها وتخصصها (Channel Meta) ===",
        f"- اسم القناة: {channel.title} ({channel.handle or channel.platform})",
        f"- المنصة: {channel.platform} | التصنيف المنهجي: {channel.domain}",
    ]
    if channel.description:
        lines.append(f"- وصف القناة والتعريف بصاحبها/مقدميها: {channel.description[:500].strip()}")
    if channel.keywords:
        lines.append(f"- الكلمات المفتاحية للقناة والشخصيات المرتبطة: {', '.join(channel.keywords[:20])}")
    if channel.topic_categories:
        clean_cats = [c.rsplit("/", 1)[-1].replace("_", " ") for c in channel.topic_categories]
        lines.append(f"- مجالات القناة (Meta Categories): {', '.join(clean_cats)}")
    if channel.genres:
        lines.append(f"- التصنيفات الفرعية للقناة: {', '.join(channel.genres)}")

    lines.extend([
        "",
        "=== ثالثاً: سياق الفيديو / الحلقة والضيوف والموضوع (Episode & Meta Details) ===",
        f"- عنوان الفيديو/الحلقة: {video.title}",
        f"- نوع المنشور: {video.kind}" + (f" | تاريخ النشر: {video.published_at}" if video.published_at else ""),
    ])
    if video.description:
        lines.append(f"- وصف الحلقة وتفاصيلها (Meta Description): {video.description[:700].strip()}")
    if video.tags:
        lines.append(f"- وسوم الحلقة والأشخاص/الضيوف المذكورون (Meta Tags): {', '.join(video.tags[:25])}")
    if video.transcript_excerpt:
        lines.append(f"- مقتطف من النص المفرّغ للحلقة (YouTube Transcript): {video.transcript_excerpt[:900].strip()}")

    lines.extend([
        "",
        "=== رابعاً: قائمة التعليقات المطلوب تحليلها (مع سياق الردود والرفاق في نفس الفيديو) ===",
        "ملاحظة: جميع هذه التعليقات كُتبت تحت هذا الفيديو تحديداً؛ خذ سياق التعليقات المجاورة وسلسلة الردود بعين الاعتبار.",
        "",
    ])

    for idx, item in enumerate(items):
        norm_text = normalize_arabic_text(item.text) or item.text.strip()
        old_tag = f" [التصنيف القديم: {item.old_label}]" if item.old_label else ""
        entry_lines = [f"[{idx}]{old_tag}"]
        if item.is_reply and item.parent_text:
            parent_clean = normalize_arabic_text(item.parent_text)[:240]
            entry_lines.append(f"    (ردّاً على التعليق الأب: «{parent_clean}»)")
        elif item.is_reply:
            entry_lines.append("    (ردّ داخل سلسلة تعليقات)")
        if item.sibling_texts:
            siblings_preview = " | ".join(normalize_arabic_text(s)[:120] for s in item.sibling_texts[:2] if s)
            if siblings_preview:
                entry_lines.append(f"    (تعليقات رفاق السلسلة: «{siblings_preview}»)")
        entry_lines.append(f"    نص التعليق: {norm_text}")
        lines.append("\n".join(entry_lines))

    return "\n".join(lines)


def _normalize_class_scores(raw_item: dict[str, Any], chosen_label: Label) -> dict[str, float]:
    raw_scores = {
        "positive": max(0.0, float(raw_item.get("positive_score") or 0.0)),
        "negative": max(0.0, float(raw_item.get("negative_score") or 0.0)),
        "neutral": max(0.0, float(raw_item.get("neutral_score") or 0.0)),
        "mixed": max(0.0, float(raw_item.get("mixed_score") or 0.0)),
    }
    total = sum(raw_scores.values())
    if total <= 0.0 or not math.isfinite(total):
        conf = min(max(float(raw_item.get("confidence") or 0.85), 0.5), 0.99)
        rem = round((1.0 - conf) / 3.0, 4)
        return {k: (round(conf, 4) if k == chosen_label else rem) for k in LABELS}
    normalized = {k: round(v / total, 4) for k, v in raw_scores.items()}
    # Ensure chosen_label has the highest score
    max_other = max(v for k, v in normalized.items() if k != chosen_label)
    if normalized[chosen_label] <= max_other:
        conf = min(max(float(raw_item.get("confidence") or 0.8), 0.55), 0.98)
        rem = round((1.0 - conf) / 3.0, 4)
        normalized = {k: (round(conf, 4) if k == chosen_label else rem) for k in LABELS}
    return normalized


def clean_reason_ar(reason: str, label: Label, old_label: str | None = None) -> str:
    """Sanitize the Arabic explanation and ensure no em dashes or invalid lengths."""
    text = (reason or "").replace("—", "، ").replace("–", "، ").strip()
    text = re.sub(r"\s+", " ", text)
    if not text:
        label_ar = {
            "positive": "إيجابي",
            "negative": "سلبي",
            "neutral": "محايد",
            "mixed": "مختلط",
        }[label]
        text = f"تصنيف سياقي ({label_ar}) بناءً على موضوع الحلقة وسياق القناة."
    if old_label and old_label != label:
        prefix = f"[تصحيح سياقي من {old_label} إلى {label}] "
        if not text.startswith("[تصحيح"):
            text = prefix + text
    return text[:480]


def build_gemini_batch_request_body(
    channel: ChannelContext,
    video: VideoContext,
    items: Sequence[ContextualComment],
    *,
    thinking_level: str = "low",
    service_tier: str | None = None,
) -> dict[str, Any]:
    """Construct a complete GenerateContentRequest dict for a chunk of video comments."""
    prompt_text = build_contextual_sentiment_prompt(channel, video, items)
    body: dict[str, Any] = {
        "systemInstruction": {
            "parts": [{"text": _SYSTEM_INSTRUCTION_AR}],
        },
        "contents": [
            {
                "role": "user",
                "parts": [{"text": prompt_text}],
            }
        ],
        "safetySettings": [
            {"category": cat, "threshold": "BLOCK_NONE"}
            for cat in (
                "HARM_CATEGORY_HARASSMENT",
                "HARM_CATEGORY_HATE_SPEECH",
                "HARM_CATEGORY_SEXUALLY_EXPLICIT",
                "HARM_CATEGORY_DANGEROUS_CONTENT",
            )
        ],
        "generationConfig": {
            "maxOutputTokens": 32768,
            "thinkingConfig": {
                "thinkingLevel": thinking_level,
                "includeThoughts": False,
            },
            "responseMimeType": "application/json",
            "responseSchema": BATCH_ITEM_RESPONSE_SCHEMA,
        },
    }
    if service_tier in ("flex", "priority", "standard"):
        body["service_tier"] = service_tier
    return body


def parse_chunk_verdicts(
    raw_json_text: str,
    items: Sequence[ContextualComment],
    *,
    model_id: str,
    revision: str = PROMPT_VERSION,
    escalated: bool = False,
) -> tuple[list[ContextualVerdict], list[int]]:
    """Parse Gemini's JSON array response into ContextualVerdicts and return indices needing Argon escalation."""
    try:
        parsed = json.loads(raw_json_text)
    except ValueError:
        parsed = []
    if not isinstance(parsed, list):
        parsed = []

    by_idx: dict[int, dict[str, Any]] = {}
    for entry in parsed:
        if isinstance(entry, dict) and isinstance(entry.get("index"), int):
            by_idx[int(entry["index"])] = entry

    verdicts: list[ContextualVerdict] = []
    escalate_indices: list[int] = []

    for idx, item in enumerate(items):
        plain = normalize_arabic_text(item.text) or item.text.strip()
        if not is_analysable(plain):
            verdicts.append(
                ContextualVerdict(
                    comment_id=item.comment_id,
                    external_comment_id=item.external_comment_id,
                    content_hash=item.content_hash,
                    status="skipped",
                    label=None,
                    confidence=0.0,
                    scores={},
                    reason_ar="",
                    model_id=model_id,
                    revision=revision,
                    escalated_to_argon=escalated,
                )
            )
            continue

        ans = by_idx.get(idx)
        raw_label = str((ans or {}).get("label") or "").strip().lower()
        if not ans or raw_label not in LABELS:
            verdicts.append(
                ContextualVerdict(
                    comment_id=item.comment_id,
                    external_comment_id=item.external_comment_id,
                    content_hash=item.content_hash,
                    status="failed",
                    label=None,
                    confidence=0.0,
                    scores={},
                    reason_ar="",
                    model_id=model_id,
                    revision=revision,
                    escalated_to_argon=escalated,
                )
            )
            if not escalated:
                escalate_indices.append(idx)
            continue

        chosen_label: Label = raw_label  # type: ignore[assignment]
        conf = min(max(float(ans.get("confidence") or 0.8), 0.0), 1.0)
        scores = _normalize_class_scores(ans, chosen_label)
        reason = clean_reason_ar(str(ans.get("reason_ar") or ""), chosen_label, item.old_label)
        is_ambiguous = bool(ans.get("ambiguous")) or conf < ESCALATION_CONFIDENCE_THRESHOLD

        if is_ambiguous and not escalated:
            escalate_indices.append(idx)

        verdicts.append(
            ContextualVerdict(
                comment_id=item.comment_id,
                external_comment_id=item.external_comment_id,
                content_hash=item.content_hash,
                status="succeeded",
                label=chosen_label,
                confidence=conf,
                scores=scores,
                reason_ar=reason,
                model_id=model_id,
                revision=revision,
                escalated_to_argon=escalated,
            )
        )

    return verdicts, escalate_indices


class GeminiContextualSentimentAdapter:
    """Implements SentimentAdapter protocol for live worker batches using Gemini Contextual Engine."""

    model_id = f"google/{DEFAULT_FLASH_MODEL}+{DEFAULT_ARGON_MODEL}-hybrid"
    revision = PROMPT_VERSION
    label_mapping: dict[int, Label] = {0: "positive", 1: "negative", 2: "neutral", 3: "mixed"}

    def __init__(
        self,
        api_key: str,
        client: httpx.Client,
        *,
        channel: ChannelContext | None = None,
        video: VideoContext | None = None,
        flash_model: str = DEFAULT_FLASH_MODEL,
        argon_model: str = DEFAULT_ARGON_MODEL,
        chunk_size: int = DEFAULT_CHUNK_SIZE,
        service_tier: str = "flex",
    ) -> None:
        if not api_key:
            raise ValueError("missing_gemini_api_key")
        self._api_key = api_key
        self._client = client
        self.channel = channel or ChannelContext(
            channel_id="default",
            workspace_id="default",
            title="YouTube Channel",
        )
        self.video = video or VideoContext(
            video_id="default",
            external_video_id="",
            title="YouTube Video",
        )
        self.flash_model = flash_model
        self.argon_model = argon_model
        self.chunk_size = chunk_size
        self.service_tier = service_tier
        self.parameters: dict[str, object] = {
            "chunk": chunk_size,
            "context": "channel+video+transcript+thread",
            "flash_model": flash_model,
            "argon_model": argon_model,
        }

    @property
    def analysis_key(self) -> str:
        return (
            f"{self.model_id}@{self.revision}"
            f"+{PREPROCESSING_VERSION}+{parameters_digest(self.parameters)}"
        )

    def _call_generate(self, model: str, body: dict[str, Any]) -> str:
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
        headers = {"x-goog-api-key": self._api_key, "Content-Type": "application/json"}
        resp = self._client.post(url, headers=headers, json=body, timeout=90.0)
        if resp.status_code in (429, 503, 529) and body.get("service_tier") == "flex":
            fallback_body = {k: v for k, v in body.items() if k != "service_tier"}
            resp = self._client.post(url, headers=headers, json=fallback_body, timeout=90.0)
        if resp.status_code != 200:
            raise RuntimeError(f"gemini_http_{resp.status_code}")
        data = resp.json()
        parts = ((data.get("candidates") or [{}])[0].get("content") or {}).get("parts") or []
        for p in parts:
            if isinstance(p, dict) and not p.get("thought") and isinstance(p.get("text"), str):
                return p["text"]
        raise RuntimeError("gemini_empty_response")

    def classify_contextual(
        self,
        items: Sequence[ContextualComment],
        *,
        channel: ChannelContext | None = None,
        video: VideoContext | None = None,
    ) -> list[ContextualVerdict]:
        ch_ctx = channel or self.channel
        v_ctx = video or self.video
        all_verdicts: list[ContextualVerdict] = []
        for start in range(0, len(items), self.chunk_size):
            chunk = list(items[start : start + self.chunk_size])
            body = build_gemini_batch_request_body(
                ch_ctx,
                v_ctx,
                chunk,
                thinking_level="low",
                service_tier=self.service_tier,
            )
            try:
                raw_text = self._call_generate(self.flash_model, body)
                verdicts, escalate_idxs = parse_chunk_verdicts(
                    raw_text, chunk, model_id=self.model_id, revision=self.revision, escalated=False
                )
            except Exception:  # noqa: BLE001 — escalate chunk on Tier-1 failure
                verdicts = [
                    ContextualVerdict(
                        comment_id=c.comment_id,
                        external_comment_id=c.external_comment_id,
                        content_hash=c.content_hash,
                        status="failed",
                        label=None,
                        confidence=0.0,
                        scores={},
                        reason_ar="",
                        model_id=self.model_id,
                        revision=self.revision,
                    )
                    for c in chunk
                ]
                escalate_idxs = list(range(len(chunk)))

            if escalate_idxs:
                esc_items = [chunk[i] for i in escalate_idxs if is_analysable(normalize_arabic_text(chunk[i].text))]
                esc_positions = [i for i in escalate_idxs if is_analysable(normalize_arabic_text(chunk[i].text))]
                if esc_items:
                    argon_body = build_gemini_batch_request_body(
                        ch_ctx,
                        v_ctx,
                        esc_items,
                        thinking_level="high",
                        service_tier=self.service_tier,
                    )
                    try:
                        argon_text = self._call_generate(self.argon_model, argon_body)
                        argon_verdicts, _ = parse_chunk_verdicts(
                            argon_text,
                            esc_items,
                            model_id=self.model_id,
                            revision=self.revision,
                            escalated=True,
                        )
                        for pos, av in zip(esc_positions, argon_verdicts):
                            if av.status == "succeeded":
                                verdicts[pos] = av
                    except Exception:  # noqa: BLE001 — keep Tier-1 verdict on Tier-2 error
                        pass

            all_verdicts.extend(verdicts)
        return all_verdicts

    def predict_contextual(
        self,
        comments: Sequence[Any],
        *,
        video: dict[str, Any] | None = None,
        channel: dict[str, Any] | None = None,
    ) -> list[Prediction]:
        ch_ctx = self.channel
        if isinstance(channel, dict) and channel:
            ch_title = str(channel.get("title") or ch_ctx.title)
            ch_handle = str(channel.get("handle") or ch_ctx.handle)
            ch_desc = str(channel.get("description") or ch_ctx.description)
            raw_kw = channel.get("keywords")
            ch_kw = tuple(str(x) for x in raw_kw) if isinstance(raw_kw, (list, tuple)) else ch_ctx.keywords
            raw_topics = channel.get("topic_categories")
            ch_topics = (
                tuple(str(x) for x in raw_topics)
                if isinstance(raw_topics, (list, tuple))
                else ch_ctx.topic_categories
            )
            domain = channel.get("domain") or infer_channel_domain(
                ch_title, ch_handle, ch_desc, ch_kw, ch_topics
            )
            ch_ctx = ChannelContext(
                channel_id=str(channel.get("channel_id") or channel.get("external_channel_id") or ch_ctx.channel_id),
                workspace_id=str(channel.get("workspace_id") or ch_ctx.workspace_id),
                title=ch_title,
                handle=ch_handle,
                platform=str(channel.get("platform") or ch_ctx.platform),
                domain=domain,  # type: ignore[arg-type]
                description=ch_desc,
                keywords=ch_kw,
                topic_categories=ch_topics,
            )

        v_ctx = self.video
        if isinstance(video, dict) and video:
            ext_vid = str(video.get("external_video_id") or v_ctx.external_video_id)
            v_ctx = VideoContext(
                video_id=str(video.get("video_id") or ext_vid or v_ctx.video_id),
                external_video_id=ext_vid,
                title=str(video.get("title") or v_ctx.title),
                kind=str(video.get("kind") or v_ctx.kind),
                published_at=str(video.get("published_at") or v_ctx.published_at),
                description=str(video.get("description") or v_ctx.description),
                transcript_excerpt=str(video.get("transcript_excerpt") or v_ctx.transcript_excerpt),
            )

        by_id: dict[str, str] = {}
        replies_by_parent: dict[str, list[tuple[str, str]]] = {}
        for idx, c in enumerate(comments):
            cid = str(getattr(c, "id", idx))
            txt = str(getattr(c, "text", ""))
            parent_id = getattr(c, "parent_id", None)
            by_id[cid] = txt
            if isinstance(parent_id, str) and parent_id:
                replies_by_parent.setdefault(parent_id, []).append((cid, txt))

        wrapped: list[ContextualComment] = []
        for idx, c in enumerate(comments):
            cid = str(getattr(c, "id", idx))
            txt = str(getattr(c, "text", ""))
            parent_id = getattr(c, "parent_id", None)
            is_reply = bool(getattr(c, "is_reply", False) or (isinstance(parent_id, str) and parent_id))
            parent_text = by_id.get(parent_id) if isinstance(parent_id, str) and parent_id else None
            siblings: tuple[str, ...] = ()
            if isinstance(parent_id, str) and parent_id in replies_by_parent:
                siblings = tuple(
                    stxt for scid, stxt in replies_by_parent[parent_id] if scid != cid and stxt
                )[:3]
            wrapped.append(
                ContextualComment(
                    comment_id=cid,
                    external_comment_id=cid,
                    content_hash=hashlib.sha256(txt.encode("utf-8")).hexdigest(),
                    text=txt,
                    is_reply=is_reply,
                    external_parent_id=parent_id if isinstance(parent_id, str) else None,
                    parent_text=parent_text,
                    sibling_texts=siblings,
                )
            )

        verdicts = self.classify_contextual(wrapped, channel=ch_ctx, video=v_ctx)
        return [
            Prediction(
                status=v.status,
                label=v.label,
                scores=v.scores if v.status == "succeeded" else {},
                model_id=self.model_id,
                revision=self.revision,
            )
            for v in verdicts
        ]

    def predict(self, texts: list[str]) -> list[Prediction]:
        wrapped = [
            ContextualComment(
                comment_id=str(i),
                external_comment_id=str(i),
                content_hash=hashlib.sha256(t.encode("utf-8")).hexdigest(),
                text=t,
            )
            for i, t in enumerate(texts)
        ]
        verdicts = self.classify_contextual(wrapped)
        return [
            Prediction(
                status=v.status,
                label=v.label,
                scores=v.scores if v.status == "succeeded" else {},
                model_id=self.model_id,
                revision=self.revision,
            )
            for v in verdicts
        ]


class GeminiBatchReclassifier:
    """End-to-end Gemini Batch API reclassification + dual-write correction pipeline for Supabase."""

    model_id = f"google/{DEFAULT_FLASH_MODEL}+{DEFAULT_ARGON_MODEL}-hybrid"
    revision = PROMPT_VERSION

    def __init__(
        self,
        *,
        supabase_url: str,
        supabase_service_key: str,
        gemini_api_key: str,
        flash_model: str = DEFAULT_FLASH_MODEL,
        argon_model: str = DEFAULT_ARGON_MODEL,
        chunk_size: int = DEFAULT_CHUNK_SIZE,
        http_client: httpx.Client | None = None,
    ) -> None:
        self.supabase_url = supabase_url.rstrip("/")
        self.supabase_key = supabase_service_key
        self.gemini_key = gemini_api_key
        self.flash_model = flash_model
        self.argon_model = argon_model
        self.chunk_size = chunk_size
        self.parameters: dict[str, object] = {
            "chunk": chunk_size,
            "context": "channel+video+transcript+thread",
            "flash_model": flash_model,
            "argon_model": argon_model,
        }
        self.analysis_key = (
            f"{self.model_id}@{self.revision}"
            f"+{PREPROCESSING_VERSION}+{parameters_digest(self.parameters)}"
        )
        self._owns_http = http_client is None
        self._http = http_client or httpx.Client(
            timeout=httpx.Timeout(connect=15.0, read=120.0, write=120.0, pool=30.0)
        )
        # Keyset pagination state per workspace_id: (cursor_video_id, initial_pub_at_floor, processed_comment_ids_set)
        self._keyset_cursors: dict[str, str] = {}
        self._keyset_pub_floor: dict[str, str] = {}
        self._processed_cids: dict[str, set[str]] = {}

    def close(self) -> None:
        if self._owns_http:
            self._http.close()

    def __enter__(self) -> "GeminiBatchReclassifier":
        return self

    def __exit__(self, exc_type, exc_val, exc_tb) -> None:
        self.close()

    def _supa_headers(self, extra: dict[str, str] | None = None) -> dict[str, str]:
        h = {
            "apikey": self.supabase_key,
            "Authorization": f"Bearer {self.supabase_key}",
            "Content-Type": "application/json",
        }
        if extra:
            h.update(extra)
        return h

    def _gemini_headers(self) -> dict[str, str]:
        return {
            "x-goog-api-key": self.gemini_key,
            "Content-Type": "application/json",
        }

    def fetch_channel_context(self, handle_or_id: str) -> ChannelContext:
        if handle_or_id.startswith("@"):
            url = f"{self.supabase_url}/rest/v1/channels?handle=eq.{urllib.parse.quote(handle_or_id)}&select=*"
        else:
            url = f"{self.supabase_url}/rest/v1/channels?id=eq.{urllib.parse.quote(handle_or_id)}&select=*"
        resp = self._http.get(url, headers=self._supa_headers())
        resp.raise_for_status()
        rows = resp.json()
        if not rows:
            raise ValueError(f"Channel not found: {handle_or_id}")
        # Prefer connected channel if multiple workspaces hold the same handle
        rows.sort(key=lambda r: (r.get("status") == "connected", r.get("active_analysis_key") is not None), reverse=True)
        ch = rows[0]
        domain = infer_channel_domain(
            ch.get("title") or "",
            ch.get("handle") or "",
            ch.get("description") or "",
            ch.get("keywords") or (),
            ch.get("topic_categories") or (),
        )
        return ChannelContext(
            channel_id=ch["id"],
            workspace_id=ch["workspace_id"],
            title=ch.get("title") or "",
            handle=ch.get("handle") or "",
            platform=ch.get("platform") or "youtube",
            domain=domain,
            description=ch.get("description") or "",
            keywords=tuple(ch.get("keywords") or ()),
            topic_categories=tuple(ch.get("topic_categories") or ()),
        )

    def fetch_channel_videos_and_comments(
        self,
        channel: ChannelContext,
        *,
        max_comments: int | None = 200,
        comment_offset: int = 0,
        fetch_transcripts: bool = True,
    ) -> list[tuple[VideoContext, list[ContextualComment]]]:
        wid = channel.workspace_id

        # 1. Keyset Video-Batch Pagination (O(1) B-Tree lookup on (workspace_id, video_id) with ZERO deep OFFSET scan)
        limit_param = max_comments if max_comments is not None else 1000
        cm_rows: list[dict[str, Any]] = []
        seen_cids = self._processed_cids.setdefault(wid, set())
        enc_self_key = urllib.parse.quote(self.analysis_key)

        if int(comment_offset) > 0 and wid not in self._keyset_cursors:
            # Auto-discover the exact (video_id, published_at) cursor from the latest reviews written for this workspace
            r_last = self._http.get(
                f"{self.supabase_url}/rest/v1/comment_reviews"
                f"?workspace_id=eq.{wid}&select=comment_id,created_at&order=created_at.desc&limit=50",
                headers=self._supa_headers(),
            )
            if r_last.status_code == 200 and r_last.json():
                last_cids = ",".join(x["comment_id"] for x in r_last.json())
                r_v = self._http.get(
                    f"{self.supabase_url}/rest/v1/comments"
                    f"?workspace_id=eq.{wid}&id=in.({last_cids})&select=id,video_id,published_at",
                    headers=self._supa_headers(),
                )
                if r_v.status_code == 200 and r_v.json():
                    best_row = max(
                        r_v.json(),
                        key=lambda x: (str(x.get("video_id") or ""), str(x.get("published_at") or "")),
                    )
                    self._keyset_cursors[wid] = best_row["video_id"]
                    if best_row.get("published_at"):
                        self._keyset_pub_floor[wid] = best_row["published_at"]

        cursor_vid = self._keyset_cursors.get(wid, "")
        vid_batch_size = 30
        while len(cm_rows) < limit_param:
            if cursor_vid == "ffffffff-ffff-ffff-ffff-ffffffffffff":
                break
            vid_filter = f"&id=gte.{cursor_vid}" if cursor_vid else ""
            r_vids = self._http.get(
                f"{self.supabase_url}/rest/v1/videos"
                f"?workspace_id=eq.{wid}{vid_filter}&select=id&order=id.asc&limit={vid_batch_size}",
                headers=self._supa_headers(),
            )
            r_vids.raise_for_status()
            v_rows = r_vids.json()
            if not v_rows:
                break
            vid_list = [v["id"] for v in v_rows]
            vids_csv = ",".join(vid_list)
            cm_page_offset = 0
            while len(cm_rows) < limit_param:
                r_cm = self._http.get(
                    f"{self.supabase_url}/rest/v1/comments"
                    f"?workspace_id=eq.{wid}&video_id=in.({vids_csv})&content_purged_at=is.null"
                    f"&select=id,video_id,external_comment_id,external_parent_id,is_reply,text_plain,text_raw,content_hash,published_at"
                    f"&order=video_id.asc,published_at.asc.nullslast,id.asc&limit=500&offset={cm_page_offset}",
                    headers=self._supa_headers(),
                )
                r_cm.raise_for_status()
                batch = r_cm.json()
                if not batch:
                    break

                # Filter out comments on the initial resume video that precede the resume published_at floor
                pub_floor = self._keyset_pub_floor.get(wid)
                candidates = []
                for row in batch:
                    cid_val = row["id"]
                    if cid_val in seen_cids:
                        continue
                    if pub_floor and row["video_id"] == cursor_vid and row.get("published_at") and row["published_at"] < pub_floor:
                        seen_cids.add(cid_val)
                        continue
                    if not str(row.get("text_plain") or row.get("text_raw") or "").strip():
                        seen_cids.add(cid_val)
                        continue
                    candidates.append(row)

                # Exclude any comment in candidates that already has a prediction under self.analysis_key
                if candidates:
                    cand_ids = [r["id"] for r in candidates]
                    already_done: set[str] = set()
                    for i in range(0, len(cand_ids), 150):
                        sl = ",".join(cand_ids[i : i + 150])
                        r_done = self._http.get(
                            f"{self.supabase_url}/rest/v1/sentiment_predictions"
                            f"?workspace_id=eq.{wid}&comment_id=in.({sl})&analysis_key=eq.{enc_self_key}&select=comment_id",
                            headers=self._supa_headers(),
                        )
                        if r_done.status_code == 200:
                            for d in r_done.json():
                                already_done.add(d["comment_id"])
                    for row in candidates:
                        cid_val = row["id"]
                        seen_cids.add(cid_val)
                        if cid_val in already_done:
                            continue
                        cm_rows.append(row)
                        self._keyset_cursors[wid] = row["video_id"]
                        if row["video_id"] != cursor_vid:
                            self._keyset_pub_floor.pop(wid, None)
                        if len(cm_rows) >= limit_param:
                            break

                if len(batch) < 500:
                    break
                cm_page_offset += 500

            if len(cm_rows) >= limit_param:
                break
            if len(vid_list) < vid_batch_size:
                # Reached the final video of this channel
                self._keyset_cursors[wid] = "ffffffff-ffff-ffff-ffff-ffffffffffff"
                break
            # Advance cursor past the last video in vid_list
            last_v = vid_list[-1]
            if last_v == cursor_vid:
                break
            cursor_vid = last_v
            self._keyset_cursors[wid] = cursor_vid
            self._keyset_pub_floor.pop(wid, None)

        if not cm_rows:
            return []

        # 2. Fetch existing baseline predictions (excluding our own analysis_key) so we know old_label
        comment_ids = [c["id"] for c in cm_rows]
        old_labels: dict[str, str] = {}
        encoded_self_key = urllib.parse.quote(self.analysis_key)
        for i in range(0, len(comment_ids), 150):
            slice_ids = ",".join(comment_ids[i : i + 150])
            r_pr = self._http.get(
                f"{self.supabase_url}/rest/v1/sentiment_predictions"
                f"?workspace_id=eq.{wid}&comment_id=in.({slice_ids})&status=eq.succeeded"
                f"&analysis_key=neq.{encoded_self_key}&select=comment_id,label",
                headers=self._supa_headers(),
            )
            if r_pr.status_code == 200:
                for p in r_pr.json():
                    if p.get("label"):
                        old_labels[p["comment_id"]] = p["label"]

        # 3. Fetch videos referenced by these comments
        video_ids = sorted({c["video_id"] for c in cm_rows if c.get("video_id")})
        videos_by_id: dict[str, VideoContext] = {}
        for i in range(0, len(video_ids), 100):
            slice_vids = ",".join(video_ids[i : i + 100])
            r_v = self._http.get(
                f"{self.supabase_url}/rest/v1/videos"
                f"?workspace_id=eq.{wid}&id=in.({slice_vids})&select=id,external_video_id,title,kind,published_at,description,tags",
                headers=self._supa_headers(),
            )
            r_v.raise_for_status()
            for v in r_v.json():
                ext_vid = v.get("external_video_id") or ""
                transcript = (
                    fetch_youtube_transcript_excerpt(ext_vid)
                    if (fetch_transcripts and channel.platform == "youtube" and len(videos_by_id) < 15)
                    else ""
                )
                videos_by_id[v["id"]] = VideoContext(
                    video_id=v["id"],
                    external_video_id=ext_vid,
                    title=v.get("title") or "",
                    kind=v.get("kind") or "video",
                    published_at=str(v.get("published_at") or "")[:10],
                    description=v.get("description") or "",
                    tags=tuple(v.get("tags") or ()),
                    transcript_excerpt=transcript,
                )

        # 4. Build thread context (parent_text + sibling_texts) per video
        by_ext_id: dict[str, str] = {
            c["external_comment_id"]: (c.get("text_plain") or c.get("text_raw") or "")
            for c in cm_rows
            if c.get("external_comment_id")
        }
        siblings_by_parent: dict[str, list[str]] = {}
        for c in cm_rows:
            p_ext = c.get("external_parent_id")
            if p_ext:
                siblings_by_parent.setdefault(p_ext, []).append(c.get("text_plain") or c.get("text_raw") or "")

        grouped: dict[str, list[ContextualComment]] = {}
        for c in cm_rows:
            vid = c.get("video_id")
            if not vid or vid not in videos_by_id:
                continue
            txt = c.get("text_plain") or c.get("text_raw") or ""
            p_ext = c.get("external_parent_id")
            parent_txt = by_ext_id.get(p_ext) if p_ext else None
            sibs = tuple(s for s in siblings_by_parent.get(p_ext or "", ()) if s != txt)[:2]
            grouped.setdefault(vid, []).append(
                ContextualComment(
                    comment_id=c["id"],
                    external_comment_id=c["external_comment_id"],
                    content_hash=c["content_hash"],
                    text=txt,
                    is_reply=bool(c.get("is_reply")),
                    external_parent_id=p_ext,
                    parent_text=parent_txt,
                    sibling_texts=sibs,
                    old_label=old_labels.get(c["id"]),
                )
            )

        return [(videos_by_id[vid], comments) for vid, comments in grouped.items()]

    def submit_and_wait_gemini_batch(
        self,
        requests_with_keys: list[tuple[str, dict[str, Any]]],
        *,
        model: str,
        display_name: str,
        poll_interval_s: float = 5.0,
        timeout_s: float = 900.0,
    ) -> tuple[str, dict[str, str]]:
        """Submit inline requests to Google Gemini `:batchGenerateContent` (50% discount) and wait for results."""
        if not requests_with_keys:
            return "", {}

        inline_entries = [
            {"request": req_body, "metadata": {"key": key}}
            for key, req_body in requests_with_keys
        ]
        batch_payload = {
            "batch": {
                "display_name": display_name,
                "input_config": {
                    "requests": {"requests": inline_entries}
                },
            }
        }
        create_url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:batchGenerateContent"
        resp = self._http.post(create_url, headers=self._gemini_headers(), json=batch_payload)
        resp.raise_for_status()
        op = resp.json()
        job_name = str(op.get("name") or (op.get("metadata") or {}).get("name") or "")
        if not job_name:
            raise RuntimeError(f"Gemini Batch API returned no job name: {op}")

        deadline = time.monotonic() + timeout_s
        while True:
            st_resp = self._http.get(
                f"https://generativelanguage.googleapis.com/v1beta/{job_name}",
                headers=self._gemini_headers(),
            )
            st_resp.raise_for_status()
            st_data = st_resp.json()
            meta = st_data.get("metadata") or {}
            state = str(meta.get("state") or st_data.get("state") or "")
            if st_data.get("done") is True or state in (
                "BATCH_STATE_SUCCEEDED",
                "BATCH_STATE_FAILED",
                "BATCH_STATE_CANCELLED",
                "BATCH_STATE_EXPIRED",
            ):
                if state != "BATCH_STATE_SUCCEEDED":
                    raise RuntimeError(f"Batch job {job_name} ended with state {state}: {st_data.get('error')}")
                resp_block = st_data.get("response") or {}
                inlined = (resp_block.get("inlinedResponses") or {}).get("inlinedResponses") or []
                outputs_by_key: dict[str, str] = {}
                for idx, entry in enumerate(inlined):
                    k = str((entry.get("metadata") or {}).get("key") or requests_with_keys[idx][0])
                    cand_parts = (
                        (((entry.get("response") or {}).get("candidates") or [{}])[0].get("content") or {}).get("parts")
                        or []
                    )
                    for part in cand_parts:
                        if isinstance(part, dict) and not part.get("thought") and isinstance(part.get("text"), str):
                            outputs_by_key[k] = part["text"]
                            break
                return job_name, outputs_by_key

            if time.monotonic() >= deadline:
                raise TimeoutError(f"Batch job {job_name} did not finish within {timeout_s}s (last state: {state})")
            time.sleep(poll_interval_s)

    def ensure_analysis_run(self, workspace_id: str) -> str:
        """Create or fetch the `public.analysis_runs` UUID for this hybrid Gemini model."""
        r_get = self._http.get(
            f"{self.supabase_url}/rest/v1/analysis_runs"
            f"?workspace_id=eq.{workspace_id}&model_id=eq.{urllib.parse.quote(self.model_id)}"
            f"&revision_sha=eq.{urllib.parse.quote(self.revision)}&select=id",
            headers=self._supa_headers(),
        )
        if r_get.status_code == 200 and r_get.json():
            return r_get.json()[0]["id"]

        payload = {
            "workspace_id": workspace_id,
            "model_id": self.model_id,
            "revision_sha": self.revision,
            "preprocessing_version": PREPROCESSING_VERSION,
            "parameters": self.parameters,
            "status": "succeeded",
        }
        r_ins = self._http.post(
            f"{self.supabase_url}/rest/v1/analysis_runs",
            headers=self._supa_headers({"Prefer": "return=representation,resolution=merge-duplicates"}),
            json=payload,
        )
        r_ins.raise_for_status()
        return r_ins.json()[0]["id"]

    def resolve_workspace_reviewer_id(self, workspace_id: str) -> str:
        r_mem = self._http.get(
            f"{self.supabase_url}/rest/v1/memberships?workspace_id=eq.{workspace_id}&select=user_id,role",
            headers=self._supa_headers(),
        )
        r_mem.raise_for_status()
        rows = r_mem.json()
        if rows:
            owners = [r["user_id"] for r in rows if r.get("role") == "workspace_owner"]
            return owners[0] if owners else rows[0]["user_id"]
        # Fallback to any platform owner user_id
        r_any = self._http.get(
            f"{self.supabase_url}/rest/v1/memberships?role=eq.workspace_owner&select=user_id&limit=1",
            headers=self._supa_headers(),
        )
        r_any.raise_for_status()
        return r_any.json()[0]["user_id"]

    def apply_dual_write(
        self,
        channel: ChannelContext,
        items_and_verdicts: Sequence[tuple[ContextualComment, ContextualVerdict]],
        *,
        update_active_key: bool = False,
    ) -> dict[str, int]:
        """Write predictions to `sentiment_predictions` AND insert corrections with Arabic reasons into `comment_reviews`."""
        if not items_and_verdicts:
            return {"predictions_written": 0, "corrections_written": 0}

        wid = channel.workspace_id
        run_id = self.ensure_analysis_run(wid)
        reviewer_id = self.resolve_workspace_reviewer_id(wid)

        # Fetch existing human reviews for these comments to avoid duplicate review insertions
        comment_ids = [item.comment_id for item, _ in items_and_verdicts]
        existing_reviews: dict[str, tuple[str, str]] = {}
        for i in range(0, len(comment_ids), 150):
            slice_ids = ",".join(comment_ids[i : i + 150])
            r_rev = self._http.get(
                f"{self.supabase_url}/rest/v1/comment_reviews"
                f"?workspace_id=eq.{wid}&comment_id=in.({slice_ids})&select=comment_id,content_hash,label,created_at"
                f"&order=created_at.desc",
                headers=self._supa_headers(),
            )
            if r_rev.status_code == 200:
                for rv in r_rev.json():
                    cid = rv["comment_id"]
                    if cid not in existing_reviews:
                        existing_reviews[cid] = (rv["content_hash"], rv["label"])

        pred_rows: list[dict[str, Any]] = []
        review_rows: list[dict[str, Any]] = []

        for item, verdict in items_and_verdicts:
            if verdict.status != "succeeded" or not verdict.label:
                continue
            pred_rows.append({
                "workspace_id": wid,
                "comment_id": item.comment_id,
                "content_hash": item.content_hash,
                "analysis_run_id": run_id,
                "analysis_key": self.analysis_key,
                "status": "succeeded",
                "label": verdict.label,
                "class_scores": verdict.scores,
            })

            # Write a correction into comment_reviews whenever Gemini's contextual verdict
            # differs from the old CAMeLBERT-DA label (or if old_label was missing/wrong)
            needs_correction = item.old_label is not None and item.old_label != verdict.label
            prev_rev = existing_reviews.get(item.comment_id)
            already_same_review = prev_rev is not None and prev_rev == (item.content_hash, verdict.label)

            if needs_correction and not already_same_review:
                review_rows.append({
                    "workspace_id": wid,
                    "comment_id": item.comment_id,
                    "content_hash": item.content_hash,
                    "label": verdict.label,
                    "reviewer_id": reviewer_id,
                    "reason": verdict.reason_ar,
                    "origin": "human",
                })

        # Batch upsert sentiment_predictions
        preds_written = 0
        for i in range(0, len(pred_rows), 200):
            chunk = pred_rows[i : i + 200]
            r_up = self._http.post(
                f"{self.supabase_url}/rest/v1/sentiment_predictions?on_conflict=workspace_id,comment_id,content_hash,analysis_key",
                headers=self._supa_headers({"Prefer": "resolution=merge-duplicates,return=minimal"}),
                json=chunk,
            )
            r_up.raise_for_status()
            preds_written += len(chunk)

        # Batch insert comment_reviews (append-only table)
        revs_written = 0
        for i in range(0, len(review_rows), 200):
            chunk = review_rows[i : i + 200]
            r_rv = self._http.post(
                f"{self.supabase_url}/rest/v1/comment_reviews",
                headers=self._supa_headers({"Prefer": "return=minimal"}),
                json=chunk,
            )
            r_rv.raise_for_status()
            revs_written += len(chunk)

        if update_active_key:
            r_ch = self._http.patch(
                f"{self.supabase_url}/rest/v1/channels?workspace_id=eq.{wid}&id=eq.{channel.channel_id}",
                headers=self._supa_headers({"Prefer": "return=minimal"}),
                json={"active_analysis_key": self.analysis_key},
            )
            r_ch.raise_for_status()

        return {
            "predictions_written": preds_written,
            "corrections_written": revs_written,
        }

    def fetch_completed_batch_outputs(
        self, job_name: str, *, poll_interval_s: float = 5.0, timeout_s: float = 900.0
    ) -> dict[str, str]:
        """Wait for (if still running) and fetch outputs map `{key: json_text}` from a `batches/...` job."""
        clean = job_name.strip().lstrip("/")
        if not clean.startswith("batches/"):
            clean = f"batches/{clean}"
        deadline = time.monotonic() + timeout_s
        while True:
            st_resp = self._http.get(
                f"https://generativelanguage.googleapis.com/v1beta/{clean}",
                headers=self._gemini_headers(),
            )
            st_resp.raise_for_status()
            st_data = st_resp.json()
            meta = st_data.get("metadata") or {}
            state = str(meta.get("state") or st_data.get("state") or "")
            if st_data.get("done") is True or state in (
                "BATCH_STATE_SUCCEEDED",
                "BATCH_STATE_FAILED",
                "BATCH_STATE_CANCELLED",
                "BATCH_STATE_EXPIRED",
            ):
                if state != "BATCH_STATE_SUCCEEDED":
                    raise RuntimeError(f"Batch job {clean} ended with state {state}: {st_data.get('error')}")
                resp_block = st_data.get("response") or {}
                inlined = (resp_block.get("inlinedResponses") or {}).get("inlinedResponses") or []
                outputs_by_key: dict[str, str] = {}
                for idx, entry in enumerate(inlined):
                    k = str((entry.get("metadata") or {}).get("key") or f"request-{idx + 1}")
                    cand_parts = (
                        (((entry.get("response") or {}).get("candidates") or [{}])[0].get("content") or {}).get("parts")
                        or []
                    )
                    for part in cand_parts:
                        if isinstance(part, dict) and not part.get("thought") and isinstance(part.get("text"), str):
                            outputs_by_key[k] = part["text"]
                            break
                return outputs_by_key
            if time.monotonic() >= deadline:
                raise TimeoutError(f"Batch job {clean} did not finish within {timeout_s}s (last state: {state})")
            time.sleep(poll_interval_s)

    def reclassify_channels_via_batch(
        self,
        handles_or_ids: Sequence[str],
        *,
        max_comments_per_channel: int = 120,
        comment_offset: int = 0,
        fetch_transcripts: bool = True,
        apply_to_db: bool = True,
        poll_interval_s: float = 5.0,
        timeout_s: float = 900.0,
        reuse_flash_job: str | None = None,
        reuse_argon_job: str | None = None,
    ) -> dict[str, Any]:
        """Run the two-tier hybrid Gemini Batch API pipeline across multiple channels and write corrections."""
        chunk_registry: dict[str, tuple[ChannelContext, VideoContext, list[ContextualComment]]] = {}
        tier1_requests: list[tuple[str, dict[str, Any]]] = []
        channels_map: dict[str, ChannelContext] = {}

        for h in handles_or_ids:
            ch_ctx = self.fetch_channel_context(h)
            channels_map[ch_ctx.channel_id] = ch_ctx
            video_groups = self.fetch_channel_videos_and_comments(
                ch_ctx,
                max_comments=max_comments_per_channel,
                comment_offset=comment_offset,
                fetch_transcripts=fetch_transcripts and not reuse_flash_job,
            )
            for v_ctx, cm_list in video_groups:
                for start in range(0, len(cm_list), self.chunk_size):
                    chunk = cm_list[start : start + self.chunk_size]
                    chunk_key = f"{ch_ctx.channel_id[:8]}:{v_ctx.video_id[:8]}:{start}"
                    chunk_registry[chunk_key] = (ch_ctx, v_ctx, chunk)
                    if not reuse_flash_job:
                        req_body = build_gemini_batch_request_body(
                            ch_ctx, v_ctx, chunk, thinking_level="low"
                        )
                        tier1_requests.append((chunk_key, req_body))

        if not chunk_registry:
            return {"status": "empty", "channels": 0, "total_comments": 0}

        # Stage 1: Submit or reuse Gemini Batch API job on gemini-3.8-flash (50% discount)
        if reuse_flash_job:
            flash_job_name = reuse_flash_job
            flash_outputs = self.fetch_completed_batch_outputs(reuse_flash_job)
        else:
            flash_job_name, flash_outputs = self.submit_and_wait_gemini_batch(
                tier1_requests,
                model=self.flash_model,
                display_name=f"sentiment-ctx-tier1-{int(time.time())}",
                poll_interval_s=poll_interval_s,
                timeout_s=timeout_s,
            )

        verdicts_by_chunk: dict[str, list[ContextualVerdict]] = {}
        escalation_registry: dict[str, tuple[str, list[int], ChannelContext, VideoContext, list[ContextualComment]]] = {}
        tier2_requests: list[tuple[str, dict[str, Any]]] = []

        for chunk_key, (ch_ctx, v_ctx, chunk) in chunk_registry.items():
            raw_out = flash_outputs.get(chunk_key, "[]")
            v_list, esc_idxs = parse_chunk_verdicts(
                raw_out, chunk, model_id=self.model_id, revision=self.revision, escalated=False
            )
            verdicts_by_chunk[chunk_key] = v_list

            valid_esc_idxs = [
                i for i in esc_idxs if is_analysable(normalize_arabic_text(chunk[i].text))
            ]
            if valid_esc_idxs:
                esc_items = [chunk[i] for i in valid_esc_idxs]
                esc_key = f"esc:{chunk_key}"
                escalation_registry[esc_key] = (chunk_key, valid_esc_idxs, ch_ctx, v_ctx, esc_items)
                if not reuse_argon_job:
                    argon_req = build_gemini_batch_request_body(
                        ch_ctx, v_ctx, esc_items, thinking_level="high"
                    )
                    tier2_requests.append((esc_key, argon_req))

        # Stage 2: Escalate ambiguous / complex items to gemini-4-argon Batch API (50% discount)
        argon_job_name = reuse_argon_job
        if escalation_registry:
            if reuse_argon_job:
                argon_outputs = self.fetch_completed_batch_outputs(reuse_argon_job)
            else:
                argon_job_name, argon_outputs = self.submit_and_wait_gemini_batch(
                    tier2_requests,
                    model=self.argon_model,
                    display_name=f"sentiment-ctx-argon-tier2-{int(time.time())}",
                    poll_interval_s=poll_interval_s,
                    timeout_s=timeout_s,
                )
            for esc_key, (orig_chunk_key, idxs, ch_ctx, v_ctx, esc_items) in escalation_registry.items():
                raw_argon = argon_outputs.get(esc_key, "[]")
                argon_verdicts, _ = parse_chunk_verdicts(
                    raw_argon, esc_items, model_id=self.model_id, revision=self.revision, escalated=True
                )
                orig_verdicts = verdicts_by_chunk[orig_chunk_key]
                for pos, av in zip(idxs, argon_verdicts):
                    if av.status == "succeeded":
                        orig_verdicts[pos] = av

        # Group final verdicts by channel and apply Dual-Write to Supabase
        by_channel: dict[str, list[tuple[VideoContext, ContextualComment, ContextualVerdict]]] = {}
        for chunk_key, (ch_ctx, v_ctx, chunk) in chunk_registry.items():
            for item, verdict in zip(chunk, verdicts_by_chunk[chunk_key]):
                by_channel.setdefault(ch_ctx.channel_id, []).append((v_ctx, item, verdict))

        channel_reports: list[dict[str, Any]] = []
        total_comments = 0
        total_preds_written = 0
        total_corrections_written = 0

        for cid, triples in by_channel.items():
            ch_ctx = channels_map[cid]
            pairs = [(item, verdict) for _, item, verdict in triples]
            total_comments += len(pairs)
            db_counts = {"predictions_written": 0, "corrections_written": 0}
            if apply_to_db:
                db_counts = self.apply_dual_write(ch_ctx, pairs, update_active_key=False)
            total_preds_written += db_counts["predictions_written"]
            total_corrections_written += db_counts["corrections_written"]

            dist = {lbl: 0 for lbl in LABELS}
            sample_corrections: list[dict[str, Any]] = []
            for v_ctx, item, verdict in triples:
                if verdict.label in dist:
                    dist[verdict.label] += 1
                if item.old_label and verdict.label and item.old_label != verdict.label:
                    if len(sample_corrections) < 6:
                        sample_corrections.append({
                            "video_title": v_ctx.title[:80],
                            "comment_text": (item.text or "").replace("\n", " ")[:120],
                            "old_label": item.old_label,
                            "new_label": verdict.label,
                            "reason_ar": verdict.reason_ar,
                            "escalated_to_argon": verdict.escalated_to_argon,
                        })

            channel_reports.append({
                "channel_title": ch_ctx.title,
                "handle": ch_ctx.handle,
                "domain": ch_ctx.domain,
                "analysed_comments": len(pairs),
                "predictions_written": db_counts["predictions_written"],
                "corrections_written": db_counts["corrections_written"],
                "distribution": dist,
                "sample_corrections": sample_corrections,
            })

        return {
            "status": "succeeded",
            "flash_batch_job": flash_job_name,
            "argon_batch_job": argon_job_name,
            "tier1_chunks": len(tier1_requests),
            "tier2_escalated_chunks": len(tier2_requests),
            "total_comments": total_comments,
            "total_predictions_written": total_preds_written,
            "total_corrections_written": total_corrections_written,
            "channels": channel_reports,
        }



