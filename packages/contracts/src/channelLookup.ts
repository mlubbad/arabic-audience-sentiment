/**
 * What a channel lookup answers, and what registering one takes.
 *
 * The lookup edge function names candidates from a link, a handle or a
 * search; the row is written by `register_public_channel` with the user's own
 * session. The schema here is the browser's check on what the function sent
 * back — a candidate whose id is not a well-formed UC id is dropped at the
 * door, before any registration is attempted with it.
 */
import { z } from "zod";
import { SOURCE_PLATFORMS } from "./selection";

export const ChannelCandidateSchema = z
  .object({
    external_channel_id: z.string().min(1).max(200),
    handle: z.string().nullable(),
    title: z.string().nullable(),
    thumbnail_url: z.string().nullable(),
    platform: z.enum(SOURCE_PLATFORMS).optional(),
  })
  .strict();
export type ChannelCandidate = z.infer<typeof ChannelCandidateSchema>;

export const ChannelLookupResponseSchema = z
  .object({
    candidates: z.array(ChannelCandidateSchema),
    fallback_available: z.boolean().optional(),
  })
  .strict();
export type ChannelLookupResponse = z.infer<typeof ChannelLookupResponseSchema>;

/** What `admin_import_channel` answers for one channel of a bulk import: a
 *  new workspace holding it, or the workspace of the owner's account that
 *  already does. */
export const AdminImportResultSchema = z.discriminatedUnion("status", [
  z
    .object({
      status: z.literal("created"),
      workspace_id: z.string().uuid(),
      workspace_name: z.string(),
      channel_id: z.string().uuid(),
      job_id: z.string().uuid().nullable(),
    })
    .strict(),
  z
    .object({
      status: z.literal("exists"),
      workspace_id: z.string().uuid(),
      workspace_name: z.string(),
    })
    .strict(),
]);
export type AdminImportResult = z.infer<typeof AdminImportResultSchema>;
