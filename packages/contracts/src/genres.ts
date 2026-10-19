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
