/** Shared building blocks. Changing these affects every module. */
import { z } from "zod";

export const LabelSchema = z.enum(["positive", "negative", "neutral", "mixed"]);
export type Label = z.infer<typeof LabelSchema>;
export const timestamp = z.string().datetime({ offset: true });
