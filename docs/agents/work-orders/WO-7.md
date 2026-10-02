# WO-7 (Codex): full-entropy deterministic comment IDs

Mirror of GitHub issue #37. **The issue is the source of truth**; this copy exists for agents
whose token can't read issues. If they differ, ask.

- **Start only after** your WO-5b PR (#16) is merged. Owner decision, 2026-10-02.
- **Branch:** `codex/wo-7-hash-entropy`
- **PR title:** `WO-7: full-entropy deterministic comment IDs` (body starts `Closes #37`)
- **No migration** in this work order.

## Why
`generateDeterministicCommentId` in `apps/web/src/ops/historicalCsvJson.ts` (lines 33-51 on
`f47fe97`) builds a 64-bit id from two 32-bit FNV-1a halves, but the second half mixes
`code >> 8`:

```ts
h2 = Math.imul(h2 ^ (code >> 8), 0x01000193);
```

For every character below U+0100 (all ASCII and Latin text), `code >> 8` is `0`, so `h2` never
varies on that input. The effective hash drops from 64 to 32 bits. A 32-bit collision inside one
import of up to 1,000 rows would let one comment silently overwrite another on the
`(workspace_id, platform, external_comment_id)` conflict key. That is a latent data-loss path.

## Fix (small)
- Make `h2` mix the **full** character code with its own seed or rotation, so the two halves are
  independent. Keep both halves 32-bit (`Math.imul`, `>>> 0`).
- **Change the prefix to `imp2_`** so the output is `imp2_<16 hex>`. The current scheme is
  `imp_<16 hex>`. A new prefix keeps the two schemes distinguishable if rows created under the
  old one ever need cleanup. The PM runs a production check before merge, so that is not your
  task.

## Owned paths
- `apps/web/src/ops/historicalCsvJson.ts` (the `generateDeterministicCommentId` function and its
  doc comment only)
- Its unit test. Create `apps/web/src/ops/historicalCsvJson.test.ts` if none exists.

## Acceptance criteria
- [ ] Two different same-length pure-ASCII inputs give different values in **both** 32-bit
      halves. Show this test failing on the current code, then passing.
- [ ] Determinism: the same `(vid, author, publishedAt, index, text)` gives the same id across
      runs, and the id matches `^imp2_[0-9a-f]{16}$`.
- [ ] Existing `historicalCsvJson` behavior and tests are unchanged apart from the id value.
- [ ] `npm run check` passes. Paste the summary line.
- [ ] No deploy, no remote migration, never push to `main`.
