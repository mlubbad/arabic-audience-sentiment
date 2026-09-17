/** Types for demo-content.mjs — the content itself lives there, in plain ESM,
 *  so the generator script and this project's tests read one file. */
export interface DemoVideo {
  id: string;
  kind: "video" | "short" | "stream";
  title: string;
}
export const CHANNEL: { id: string; name: string; handle: string };
export const VIDEOS: DemoVideo[];
export const E2E_VIDEOS: DemoVideo[];
export const AUTHORS: Record<string, string>;

export interface DemoComment {
  id: string;
  video: string;
  author: string;
  date: string | null;
  likes: number | null;
  label: "positive" | "negative" | "neutral" | "mixed" | null;
  topic: string | null;
  text: string;
  reply?: string | null;
  owner?: boolean;
}
export const COMMENTS: DemoComment[];
export const STALE_OLD_TEXT: Record<string, string>;

export interface DemoReview {
  id: string;
  label: "positive" | "negative" | "neutral" | "mixed";
  reason: string;
  by: string;
  at: string;
}
export const REVIEWS: DemoReview[];

export interface DemoTopicReview {
  id: string;
  topic: string;
  reason: string;
  by: string;
  at: string;
}
export const TOPIC_REVIEWS: DemoTopicReview[];

export interface E2ECommentContent {
  author: string;
  text: string;
}
export const E2E_COMMENTS: Record<string, E2ECommentContent>;
export const E2E_STALE_OLD_TEXT: Record<string, string>;

export interface DemoTopic {
  key: string;
  name_ar: string;
  name_en: string;
  description: string;
  position: number;
  retired: boolean;
}
export const TOPICS: DemoTopic[];
