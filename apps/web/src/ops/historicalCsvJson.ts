/**
 * Robust CSV and JSON parser for historical omnichannel data backfill and import.
 *
 * Supports auto-mapping of standard and Arabic column headers for posts/videos
 * and comments, RFC 4180 CSV compliance (quoted strings, embedded commas/newlines),
 * and JSON array/object schemas.
 */
import {
  HistoricalCommentImportSchema,
  HistoricalPostImportSchema,
  type HistoricalCommentImport,
  type HistoricalImportPayload,
  type HistoricalPostImport,
} from "@sentiment/contracts";

export interface ParseResult {
  ok: boolean;
  payload?: HistoricalImportPayload;
  error?: string;
  summary?: {
    postsCount: number;
    commentsCount: number;
  };
}

/** RFC 4180 compliant CSV parser */
export function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentField = "";
  let inQuotes = false;
  let i = 0;

  // Normalize Windows CRLF to LF
  const str = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  while (i < str.length) {
    const char = str[i];

    if (inQuotes) {
      if (char === '"') {
        if (i + 1 < str.length && str[i + 1] === '"') {
          currentField += '"';
          i += 2;
          continue;
        } else {
          inQuotes = false;
          i++;
          continue;
        }
      } else {
        currentField += char;
        i++;
        continue;
      }
    }

    if (char === '"') {
      inQuotes = true;
      i++;
    } else if (char === "," || char === "\t" || char === ";") {
      currentRow.push(currentField.trim());
      currentField = "";
      i++;
    } else if (char === "\n") {
      currentRow.push(currentField.trim());
      if (currentRow.some((f) => f.length > 0)) {
        rows.push(currentRow);
      }
      currentRow = [];
      currentField = "";
      i++;
    } else {
      currentField += char;
      i++;
    }
  }

  if (currentField.length > 0 || currentRow.length > 0) {
    currentRow.push(currentField.trim());
    if (currentRow.some((f) => f.length > 0)) {
      rows.push(currentRow);
    }
  }

  return rows;
}

const COMMENT_ID_ALIASES = [
  "external_comment_id",
  "comment_id",
  "commentid",
  "id",
  "معرف_التعليق",
  "التعليق_id",
];
const VIDEO_ID_ALIASES = [
  "external_video_id",
  "video_id",
  "videoid",
  "post_id",
  "postid",
  "معرف_الفيديو",
  "معرف_المنشور",
];
const TEXT_ALIASES = [
  "text_raw",
  "text",
  "comment",
  "body",
  "content",
  "message",
  "نص_التعليق",
  "التعليق",
  "النص",
];
const PUBLISHED_AT_ALIASES = [
  "published_at",
  "published_time",
  "date",
  "time",
  "timestamp",
  "created_at",
  "تاريخ_النشر",
  "التاريخ",
];
const AUTHOR_ALIASES = [
  "author_name",
  "author_display_name",
  "author",
  "user",
  "username",
  "صاحب_التعليق",
  "الكاتب",
  "المستخدم",
];
const LIKES_ALIASES = [
  "likes_value",
  "likes_raw",
  "likes",
  "like_count",
  "likes_count",
  "الإعجابات",
  "الاعجابات",
];
const PARENT_ID_ALIASES = [
  "external_parent_id",
  "parent_id",
  "parent_comment_id",
  "reply_to",
  "التعليق_الأب",
  "رد_على",
];
const TITLE_ALIASES = [
  "title",
  "post_title",
  "video_title",
  "caption",
  "name",
  "العنوان",
  "عنوان_المنشور",
];

function findColumnIndex(headers: string[], aliases: string[]): number {
  const normalizedHeaders = headers.map((h) =>
    h
      .toLowerCase()
      .replace(/[\s_-]+/g, "_")
      .trim(),
  );
  for (const alias of aliases) {
    const idx = normalizedHeaders.indexOf(alias.toLowerCase());
    if (idx !== -1) return idx;
  }
  return -1;
}

export function parseHistoricalCsv(
  csvText: string,
  defaultVideoId?: string,
): ParseResult {
  const rows = parseCsvRows(csvText);
  if (rows.length < 2) {
    return { ok: false, error: "empty_or_no_header" };
  }

  const headers = rows[0];
  const textIdx = findColumnIndex(headers, TEXT_ALIASES);
  const commentIdIdx = findColumnIndex(headers, COMMENT_ID_ALIASES);
  const videoIdIdx = findColumnIndex(headers, VIDEO_ID_ALIASES);
  const publishedAtIdx = findColumnIndex(headers, PUBLISHED_AT_ALIASES);
  const authorIdx = findColumnIndex(headers, AUTHOR_ALIASES);
  const likesIdx = findColumnIndex(headers, LIKES_ALIASES);
  const parentIdIdx = findColumnIndex(headers, PARENT_ID_ALIASES);
  const titleIdx = findColumnIndex(headers, TITLE_ALIASES);

  // If there's no text column, check if this is a posts-only CSV
  if (textIdx === -1) {
    if (videoIdIdx !== -1 && titleIdx !== -1) {
      const posts: HistoricalPostImport[] = [];
      for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        const vid = row[videoIdIdx]?.trim();
        const title = row[titleIdx]?.trim();
        if (!vid || !title) continue;
        posts.push(
          HistoricalPostImportSchema.parse({
            external_video_id: vid,
            title,
            published_at:
              publishedAtIdx !== -1 && row[publishedAtIdx]?.trim()
                ? row[publishedAtIdx].trim()
                : null,
          }),
        );
      }
      return {
        ok: true,
        payload: { posts, comments: [] },
        summary: { postsCount: posts.length, commentsCount: 0 },
      };
    }
    return { ok: false, error: "missing_text_column" };
  }

  const comments: HistoricalCommentImport[] = [];
  const postsMap = new Map<string, HistoricalPostImport>();

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const text = row[textIdx]?.trim();
    if (!text) continue;

    const vid =
      (videoIdIdx !== -1 ? row[videoIdIdx]?.trim() : null) ||
      defaultVideoId ||
      "imported_post_1";

    const commentId =
      (commentIdIdx !== -1 ? row[commentIdIdx]?.trim() : null) ||
      `imp_c_${i}_${Date.now().toString(36)}`;

    const publishedAt =
      publishedAtIdx !== -1 && row[publishedAtIdx]?.trim()
        ? row[publishedAtIdx].trim()
        : new Date().toISOString();

    const author =
      authorIdx !== -1 && row[authorIdx]?.trim() ? row[authorIdx].trim() : "";

    const likesRaw =
      likesIdx !== -1 && row[likesIdx]?.trim()
        ? row[likesIdx].trim()
        : undefined;
    const likesVal = likesRaw ? parseInt(likesRaw, 10) : 0;

    const parentId =
      parentIdIdx !== -1 && row[parentIdIdx]?.trim()
        ? row[parentIdIdx].trim()
        : null;

    comments.push(
      HistoricalCommentImportSchema.parse({
        external_comment_id: commentId,
        external_video_id: vid,
        external_parent_id: parentId,
        is_reply: Boolean(parentId),
        text_raw: text,
        text_plain: text,
        author_name: author,
        published_at: publishedAt,
        likes_value: Number.isFinite(likesVal) ? Math.max(0, likesVal) : 0,
      }),
    );

    if (!postsMap.has(vid)) {
      const title =
        titleIdx !== -1 && row[titleIdx]?.trim()
          ? row[titleIdx].trim()
          : `منشور ${vid}`;
      postsMap.set(
        vid,
        HistoricalPostImportSchema.parse({
          external_video_id: vid,
          title,
          published_at: publishedAt,
        }),
      );
    }
  }

  return {
    ok: true,
    payload: {
      posts: Array.from(postsMap.values()),
      comments,
    },
    summary: {
      postsCount: postsMap.size,
      commentsCount: comments.length,
    },
  };
}

export function parseHistoricalJson(
  jsonText: string,
  defaultVideoId?: string,
): ParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    return { ok: false, error: "invalid_json" };
  }

  if (!parsed || typeof parsed !== "object") {
    return { ok: false, error: "invalid_json_structure" };
  }

  const posts: HistoricalPostImport[] = [];
  const comments: HistoricalCommentImport[] = [];
  const postsMap = new Map<string, HistoricalPostImport>();

  // Case 1: Standard payload { posts?: [...], comments?: [...] }
  if (!Array.isArray(parsed) && ("comments" in parsed || "posts" in parsed)) {
    const raw = parsed as { posts?: unknown[]; comments?: unknown[] };
    if (Array.isArray(raw.posts)) {
      for (const p of raw.posts) {
        if (p && typeof p === "object") {
          const rec = p as Record<string, unknown>;
          const vid = String(
            rec.external_video_id ||
              rec.video_id ||
              rec.post_id ||
              rec.id ||
              "",
          ).trim();
          const title = String(
            rec.title || rec.name || rec.caption || "",
          ).trim();
          if (vid && title) {
            postsMap.set(
              vid,
              HistoricalPostImportSchema.parse({
                external_video_id: vid,
                title,
                published_at: rec.published_at
                  ? String(rec.published_at)
                  : null,
              }),
            );
          }
        }
      }
    }

    if (Array.isArray(raw.comments)) {
      for (let i = 0; i < raw.comments.length; i++) {
        const c = raw.comments[i];
        if (c && typeof c === "object") {
          const rec = c as Record<string, unknown>;
          const text = String(
            rec.text_raw ||
              rec.text ||
              rec.comment ||
              rec.body ||
              rec.content ||
              "",
          ).trim();
          if (!text) continue;

          const vid = String(
            rec.external_video_id ||
              rec.video_id ||
              rec.post_id ||
              defaultVideoId ||
              "imported_post_1",
          ).trim();

          const cid = String(
            rec.external_comment_id ||
              rec.comment_id ||
              rec.id ||
              `imp_c_${i}_${Date.now().toString(36)}`,
          ).trim();

          const parentId =
            rec.external_parent_id || rec.parent_id
              ? String(rec.external_parent_id || rec.parent_id)
              : null;

          const author = String(
            rec.author_name || rec.author_display_name || rec.author || "",
          ).trim();

          const likesVal =
            typeof rec.likes_value === "number"
              ? rec.likes_value
              : typeof rec.likes_raw === "string"
                ? parseInt(rec.likes_raw, 10)
                : 0;

          comments.push(
            HistoricalCommentImportSchema.parse({
              external_comment_id: cid,
              external_video_id: vid,
              external_parent_id: parentId,
              is_reply: Boolean(parentId),
              text_raw: text,
              text_plain: text,
              author_name: author,
              published_at: rec.published_at
                ? String(rec.published_at)
                : new Date().toISOString(),
              likes_value: Number.isFinite(likesVal)
                ? Math.max(0, likesVal)
                : 0,
            }),
          );

          if (!postsMap.has(vid)) {
            postsMap.set(
              vid,
              HistoricalPostImportSchema.parse({
                external_video_id: vid,
                title: `منشور ${vid}`,
              }),
            );
          }
        }
      }
    }

    return {
      ok: true,
      payload: {
        posts: Array.from(postsMap.values()),
        comments,
      },
      summary: {
        postsCount: postsMap.size,
        commentsCount: comments.length,
      },
    };
  }

  // Case 2: Direct array of comments or posts
  const arr = Array.isArray(parsed) ? parsed : [];
  if (arr.length === 0) {
    return { ok: false, error: "empty_records" };
  }

  for (let i = 0; i < arr.length; i++) {
    const item = arr[i];
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;

    const text = String(
      rec.text_raw || rec.text || rec.comment || rec.body || rec.content || "",
    ).trim();

    if (text) {
      const vid = String(
        rec.external_video_id ||
          rec.video_id ||
          rec.post_id ||
          defaultVideoId ||
          "imported_post_1",
      ).trim();

      const cid = String(
        rec.external_comment_id ||
          rec.comment_id ||
          rec.id ||
          `imp_c_${i}_${Date.now().toString(36)}`,
      ).trim();

      const parentId =
        rec.external_parent_id || rec.parent_id
          ? String(rec.external_parent_id || rec.parent_id)
          : null;

      const author = String(
        rec.author_name || rec.author_display_name || rec.author || "",
      ).trim();

      const likesVal =
        typeof rec.likes_value === "number"
          ? rec.likes_value
          : typeof rec.likes_raw === "string"
            ? parseInt(rec.likes_raw, 10)
            : 0;

      comments.push(
        HistoricalCommentImportSchema.parse({
          external_comment_id: cid,
          external_video_id: vid,
          external_parent_id: parentId,
          is_reply: Boolean(parentId),
          text_raw: text,
          text_plain: text,
          author_name: author,
          published_at: rec.published_at
            ? String(rec.published_at)
            : new Date().toISOString(),
          likes_value: Number.isFinite(likesVal) ? Math.max(0, likesVal) : 0,
        }),
      );

      if (!postsMap.has(vid)) {
        postsMap.set(
          vid,
          HistoricalPostImportSchema.parse({
            external_video_id: vid,
            title: `منشور ${vid}`,
          }),
        );
      }
    } else if (rec.title || rec.video_title) {
      const vid = String(
        rec.external_video_id || rec.video_id || rec.post_id || rec.id || "",
      ).trim();
      const title = String(rec.title || rec.video_title || "").trim();
      if (vid && title) {
        posts.push(
          HistoricalPostImportSchema.parse({
            external_video_id: vid,
            title,
            published_at: rec.published_at ? String(rec.published_at) : null,
          }),
        );
      }
    }
  }

  return {
    ok: true,
    payload: {
      posts: posts.length > 0 ? posts : Array.from(postsMap.values()),
      comments,
    },
    summary: {
      postsCount: posts.length > 0 ? posts.length : postsMap.size,
      commentsCount: comments.length,
    },
  };
}

export function parseHistoricalFile(
  content: string,
  filename: string,
  defaultVideoId?: string,
): ParseResult {
  const isJson = filename.toLowerCase().endsWith(".json");
  if (isJson) {
    return parseHistoricalJson(content, defaultVideoId);
  }
  return parseHistoricalCsv(content, defaultVideoId);
}

export function generateSampleCsvTemplate(): string {
  return [
    "external_video_id,external_comment_id,text_raw,published_at,author_name,likes_value",
    'vid_001,comm_001,"محتوى رائع جدا ومفيد، شكرا لكم!",2026-03-01T12:00:00Z,"أحمد محمد",15',
    'vid_001,comm_002,"هل يمكن توضيح النقطة الثانية بشكل أوسع؟",2026-03-01T12:30:00Z,"سارة علي",3',
    'vid_002,comm_003,"الفيديو طويل بعض الشيء لكن الشرح ممتاز",2026-03-02T15:00:00Z,"خالد",8',
  ].join("\n");
}
