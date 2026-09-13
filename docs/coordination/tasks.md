# Allocated work

The integrator is the only writer of this board. Lane progress goes in separate agent reports.
Do not claim a task already owned below, even if you find the same defect independently.

| ID | Owner | Task | Acceptance / dependencies |
| --- | --- | --- | --- |
| W1 | Codex worker | Fix analysis identity and immutable model revision validation | Real model cards reject moving/non-commit refs; a separately explicit fixture identity remains allowed. Fingerprint includes label mapping, preprocessing and inference parameters; parameter changes change identity. Tests first. No model download. |
| W2 | Codex worker | Discovery/collector design and bounded implementation | Verify channel identity, distinct discovery/enrichment stages, metadata only, resumable per-video state, honest terminal statuses. Specify required server contracts before implementing a transport. |
| W3 | Codex worker | Collector robustness | Preserve observations/source provenance and recover invalid continuations without losing committed data; meaningful synthetic transport/rollback tests. |
| P1 | Claude platform | Separate fixture and live data modes | Configuring product Auth does not redirect fixture corrections to live UUID RPCs or falsely claim persistence. Test configured Auth plus fixture data explicitly. |
| P2 | Claude platform | Complete atomic ingestion/analysis billing server operation | Depends on I1. New migration: one transaction writes validated predictions, checkpoint and successful usage charges; replay fingerprints entire payload. Test rollback, stale leases, tenant scope, duplicate keys and conflicting replay. |
| P3 | Claude platform | Enforce plan limits and worker lifecycle | Server-checked channel/sync limits and scoped worker gateway/finish; no tenant service-role credentials. Depends on I1 where payloads are shared. |
| I1 | Integrator | Approve and publish worker↔server batch contract | Freeze fields, identity/provenance, lease scope, idempotency, metering and errors in packages/contracts with fixtures usable by Python. Collect proposals from W2/P2 first. |
| I2 | Integrator | Reconcile progress claims and full-stack validation | After reviewed lane commits, update central evidence, run full checks and genuine concurrent PostgreSQL tests where available. |

Current status: worktrees/protocol being initialized. W1 is the first Codex task; Claude should finish/checkpoint the original checkout and acknowledge P1 before starting in the platform worktree. P2 must not race a speculative Python server client.
