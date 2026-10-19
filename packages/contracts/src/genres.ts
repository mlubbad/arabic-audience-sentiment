import { z } from "zod";

export const GenreStatusSchema = z.enum([
  "succeeded",
  "skipped",
  "failed",
  "unsupported",
]);

export const GenrePredictionRecordSchema = z
  .object({
    external_video_id: z.string().min(1),
    classification_key: z.string().min(1),
    taxonomy_version: z.number().int().positive(),
    status: GenreStatusSchema,
    genre_key: z.string().nullable(),
    confidence: z.number().min(0).max(1).nullable(),
    model_id: z.string().min(1),
    prompt_version: z.string().min(1),
    error_code: z.string().nullable(),
  })
  .strict()
  .refine(
    (record) => (record.status === "succeeded") === (record.genre_key !== null),
    "only a successful prediction carries a genre",
  );

const ChannelGenreWeightSchema = z
  .object({
    genre_key: z.string(),
    level: z.number().int().min(1).max(3),
    weight: z.number().min(0).max(1),
    name_ar: z.string(),
    name_en: z.string(),
  })
  .strict();

export const ChannelGenreProfileSchema = z.union([
  z.object({ blocked: z.literal("genre_classification_off") }).strict(),
  z
    .object({
      taxonomy_version: z.number().int().positive().nullable(),
      classification_key: z.string().nullable(),
      source: z.enum(["reviewed", "model"]).nullable(),
      main: z.string().nullable(),
      primary: z.string().nullable(),
      secondary: z.array(z.string()),
      weights: z.array(ChannelGenreWeightSchema),
      videos: z.number().int().positive().nullable(),
      computed_at: z.string().datetime({ offset: true }).nullable(),
    })
    .strict(),
]);

export const GenresDueSchema = z.union([
  z.object({ blocked: z.literal("genre_classification_off") }).passthrough(),
  z
    .object({
      classification_key: z.string().min(1),
      taxonomy_version: z.number().int().positive(),
      taxonomy: z.array(
        z.object({
          key: z.string(),
          parent_key: z.string().nullable(),
          level: z.number().int().min(1).max(3),
          name_en: z.string(),
          description: z.string(),
        }),
      ),
      rows: z.array(
        z.object({
          external_video_id: z.string(),
          title: z.string(),
          description: z.string().max(500),
          tags: z.array(z.string()),
          category_id: z.string().nullable(),
          duration_sec: z.number().int().nonnegative().nullable(),
        }),
      ),
    })
    .strict(),
]);
