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

export const ChannelCandidateSchema = z
  .object({
    external_channel_id: z.string().regex(/^UC[A-Za-z0-9_-]{22}$/),
    handle: z.string().nullable(),
    title: z.string().nullable(),
    thumbnail_url: z.string().nullable(),
  })
  .strict();
export type ChannelCandidate = z.infer<typeof ChannelCandidateSchema>;

export const ChannelLookupResponseSchema = z
  .object({
    candidates: z.array(ChannelCandidateSchema),
  })
  .strict();
export type ChannelLookupResponse = z.infer<typeof ChannelLookupResponseSchema>;
