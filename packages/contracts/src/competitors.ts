import { z } from "zod";

export const FeaturedCandidateSchema = z
  .object({
    candidate_external_id: z.string().regex(/^UC[A-Za-z0-9_-]{22}$/),
    title: z.string().max(200).nullable(),
    handle: z.string().max(200).nullable(),
  })
  .strict();

export const FeaturedCandidatesCommitSchema = z
  .object({
    job_id: z.string().uuid(),
    lease_token: z.string().uuid(),
    batch_key: z.string().min(1).max(200),
    candidates: z.array(FeaturedCandidateSchema).max(100),
  })
  .strict();

export type FeaturedCandidate = z.infer<typeof FeaturedCandidateSchema>;
export type FeaturedCandidatesCommit = z.infer<
  typeof FeaturedCandidatesCommitSchema
>;
