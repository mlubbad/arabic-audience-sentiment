# Codex Build Handoff — Arabic Audience Sentiment SaaS

Owner: Mohammed Lubbad  
Prepared: 2026-09-12  
Purpose: transfer the product conversation, decisions, evidence, and implementation instructions into a self-contained Markdown entry point for Codex.

This is an implementation handoff, not a claim that the application has been built. It consolidates the supplied conversation and the complete existing SpecTech v1.1, preserved in Part B. It is not a verbatim transcript of unavailable earlier messages. Credentials have deliberately not been copied.

## Read this first

1. Read Part A, then all of Part B before implementing.
2. Inspect the actual repository and attached source files; inventory what exists before creating a replacement.
3. Use the latest explicit user instructions to resolve deployment preferences. The current recorded preference is a **private Sites MVP**, with no public publication or paid services without approval. Shared hosting remains an available later deployment target.
4. Treat Part B as the detailed technical baseline. Part A resolves historical contradictions and adds handoff/setup requirements.
5. Continue useful local implementation if an external service is unavailable. Record the blocked live integration separately; do not represent a mock as a working integration.

# Part A — Context, resolved decisions, and Codex setup

## A1. Product and business intent

Build a usable subscription-oriented product for small and midsize marketing agencies and influencers. Evolve the existing YouTube-comment workflow and the visual prototype at https://dashboard.sky-develop.net rather than inventing an unrelated product.

The core value is helping customers understand audience sentiment, discover complaints/questions, compare videos and time periods, and inspect the underlying comments. The product must automate collection and analysis and expose trustworthy, consistently filtered results.

Primary language: Arabic, RTL. Prepare localization for English/LTR. Reuse the supplied brand assets, typography, colors, Chart.js visuals, and storytelling where suitable. Exact visual matching depends on receiving the original assets; do not guess unspecified brand values.

The first platform is YouTube. Workspace membership, agency clients, and tenant isolation are core architecture. Other platforms, AI chat, automated replies, advanced aspect-based sentiment, and real payment processing are later work.

### Pilot

- Collaborating creator: Alaa Jaber.
- Channel URL: https://www.youtube.com/@alaa_jaber_official
- Channel ID recorded in the earlier investigation: `UCTPIL6f7yNpK8yc-H3cEtFg`.
- Begin public-data collection before the creator completes OAuth.
- Include actual YouTube account connection from the user's account in the MVP. Entering a URL alone does not satisfy this requirement.
- Match ownership using the channel identity returned by the authorized YouTube connection, not email, display name, or a claimed channel URL.
- Collect metadata and comments/replies, not video/audio files.

## A2. What is known, and what is not yet complete

The following results are recorded in the source conversation and SpecTech. They were not rerun during this handoff preparation.

| Item | Recorded evidence | Implementation implication |
|---|---|---|
| Legacy dataset | 4,899 comments across five analyzed videos | Inspect source rows and mappings before importing |
| Legacy timestamps | 4,808 include seconds; 91 include minutes only | Support both formats; recover all 4,899 if the exact source matches |
| Catalog discovery | 35 Videos + 157 Shorts + 2 Streams = 194 unique IDs | Reuse catalog as a dated snapshot; refresh discovery for a new run |
| Comment collection smoke test | 30 comments from `DGA2hlrwB8g`, including two replies | Limited sample only; full collection remains unfinished |
| Full channel comments | Not collected in the recorded delivery | Must implement resumable collection and honest coverage reporting |
| New model inference / benchmark | Not run on the new comments | No measured winning model |
| Existing notebooks | Model-loading examples, no end-to-end inference/evaluation evidence | Convert to a versioned worker pipeline |
| SaaS/Auth/OAuth/deployment | Specified, not implemented in the recorded SpecTech delivery | Inspect any newer repository before assuming zero progress |
| Shared hosting | Available; runtime features and login not verified | Do not assume long-running Python, Docker, SSH, or cron support |

A successful sample fetch is not evidence that all replies can be retrieved. A source's displayed total is not proof of the number of retrievable comments. Never describe the 194-item catalog as permanently exhaustive.

## A3. Legacy dashboard findings that must become regression checks

The earlier review reported these topic aggregation discrepancies:

| Topic | Applying supplied changes | Dashboard |
|---|---:|---:|
| استفسارات وأسئلة | 448 | 351 |
| نقاش وتحليل الموضوع / تعليق عام | 982 | 1,082 |
| ثبات ودعاء وذكر الله | 1,016 | 1,035 |

These are diagnostic observations, not targets to hard-code. Recompute from the original rows and imported revisions. Preserve unresolved differences in a reconciliation report.

Other recorded findings:

- Standalone HTML uses HTML/CSS/JavaScript, Chart.js 4.4.1, a slide-like presentation, and embedded `const D`.
- ZIP version uses an `x-dc` template with a React-based runtime, Chart.js, `data.js`, and brand assets.
- Both versions contained matching aggregate data at the time of review.
- Video filters changed some KPIs and sentiment visuals while topics and temporal charts remained global.
- Author search was limited to preselected top-25 lists.
- Comment browsing searched preselected subsets instead of all comments.
- Some insights/recommendations were static text and could not adapt to another customer.
- The earlier review was of code/data; it did not establish interactive browser correctness.

Required outcome: one authoritative effective-classification definition and one shared filter contract across KPIs, charts, tables, search, comparisons, and exports. Search must query all authorized matching records with pagination. Recommendations must be computed and supported by available data, or omitted.

Legacy label changes are not automatically human-reviewed truth. Store their origin as unverified legacy amendments unless independent evidence identifies a human review.

## A4. Resolve the architecture history explicitly

| Earlier idea | Current baseline |
|---|---|
| Python FastAPI backend | Supabase Edge Functions/RPC for short control operations; separate Python worker pulls jobs. No FastAPI unless a concrete requirement justifies an ADR |
| Cloud Run Jobs + Scheduler immediately | Local/persistent developer worker first; choose a hosted worker after measuring runtime and cost |
| Cloudflare Pages/shared hosting as first publication | Private Sites pilot is the recorded current delivery preference; preserve shared-hosting export as an alternative |
| One supposedly best Arabic model | AraBERT baseline with a measured model selection experiment |
| Only scraping until creator authorizes | Public API-key collection can precede creator OAuth; separate collector adapters |
| URL-based connection only | Precollection plus genuine user OAuth connection |
| Subscription payment immediately | Server-enforced limits and manually activated pilot plans; payment integration deferred |

The fixed application stack from SpecTech is React + TypeScript + Vite, Chart.js/react-chartjs-2, Tailwind, optional Radix/shadcn, TanStack Query, React Router, Zod, Supabase Auth/Postgres/Storage/Edge Functions, and Python 3.12 with uv/PyTorch/Transformers. Use a PostgreSQL job table with atomic leases; no Redis/Celery initially.

Deployment provider and application architecture are separate decisions. Before Sites deployment, inspect its actual capabilities and private-access flow. Do not attempt to run the Python worker inside a static frontend or imply that hosting the UI supplies a continuously running worker. Keep OAuth callback on the backend and return to the private frontend; validate the complete redirect flow.

If private Sites hosting cannot support a required integration as configured, complete the local product and document the precise limitation. Do not silently publish publicly or switch to a paid platform.

## A5. Collection and sentiment decisions

### Collection

- Initial tested adapter in the source: `yt-dlp` version `2026.8.19`. Treat it as a historical tested version; verify availability/compatibility and lock the version actually used.
- Separate channel discovery, video enrichment, comment pagination, and reply coverage.
- API paths: uploads playlist discovery, video metadata, comment threads, and explicit reply pagination. API key is for public-data collection; OAuth proves account authorization and enables the connected workflow.
- `youtube-comment-downloader` remains a fallback candidate, not a second mandatory collector implementation. Reference commit and specific defects are in Part B.
- Never silently switch sources following token revocation, quota exhaustion, or a partial failure.
- Persist source/revision, per-video progress, checkpoints, retries, raw timestamps, parent provenance, and explicit completion status.
- Preserve TLS verification. The earlier certificate issue was addressed using the system trust store, not by disabling certificate checks.
- Stop cleanly on unavailable/blocked access. Do not introduce proxy rotation, session theft, or access-control bypass as an implementation strategy.

The user asked to focus on technical MVP work instead of repeating policy discussions. Keep execution focused; this does not mean inventing collection coverage or removing data/security controls.

### Sentiment

Baseline: `PRAli22/AraBert-Arabic-Sentiment-Analysis`, with positive/negative/neutral/mixed. Its earlier nomination was based on continuity and explicit labels, not demonstrated superiority.

Candidates:
- `RafatMohammed/arabic-sentiment-marbertv2`
- `CAMeL-Lab/bert-base-arabic-camelbert-da-sentiment`
- `CAMeL-Lab/bert-base-arabic-camelbert-mix-sentiment`

The earlier model-card review reported AraBERT accuracy 80.03% and Macro-F1 65.43%; MARBERT accuracy 80.93% and F1 80.69% with the averaging method unclear. These are historical card claims on different datasets/tasks, not comparable evidence and not product accuracy claims.

Verify label mappings against the exact pinned revisions; never infer numerical labels from another model. CAMeLBERT-Mix means mixed language varieties, not a Mixed sentiment output class.

Create about 600 independently labeled evaluation comments, including commercial content. Separate development and held-out testing; keep duplicated/near-duplicated texts together. Evaluate shared three-class behavior on non-mixed examples and mixed behavior separately. Report Macro-F1, per-class recall/precision, dialect sample counts, confusion matrix, latency, and memory. Human labeling is still required; Codex should prepare the annotation workflow without pretending to supply independent human ground truth.

Keep sentiment, topic, and comment type separate. Preserve original text, text hash/version, model/rules/preprocessing revision, analysis time, scores, and append-only corrections. Mixed is never neutral. Skipped, failed, unsupported, or stale analysis is never silently neutral.

## A6. Assets to bring into the coding workspace

This Markdown contains the full specification; it cannot substitute for the source datasets and visual assets.

| Input | Handoff status | Required handling |
|---|---|---|
| `SpecTech-YouTube-Sentiment-MVP.md` | Located and read in full; preserved below | No separate copy required to understand the spec |
| `SpecTech-YouTube-MVP-Package.zip` | Located by exact filename; archive bytes not inspected in this handoff | Attach/extract; inventory manifest, JSONL catalog, and sample before relying on them |
| Original comments CSV/data files | Discussed in source conversation; not re-inspected here | Supply the exact files; compute hashes, row counts, and mappings |
| Classification amendment file | Discussed in source conversation | Preserve separate provenance; do not call it verified human truth |
| Standalone dashboard HTML and dashboard ZIP | Discussed and previously reviewed | Supply both if available; use original brand assets and inspect runtime dependencies |
| Two model notebooks | Previously reviewed in conversation | Preserve as references; replace loading snippets with tested worker code |
| Any newer code/repository/deployment | Not inventoried during handoff preparation | Inspect first; do not overwrite or restart blindly |

Create `docs/input-inventory.md` with filename, hash, role, provenance, and availability. Keep real raw comment data in private storage or ignored local data directories; commit only intentionally sanitized test fixtures. Do not put user passwords, API keys, OAuth tokens, or notebook outputs containing credentials into Git.

## A7. Do you need custom Codex setup?

**No custom model, custom plugin, or elaborate global configuration is required to start.** The high-value setup is a private project workspace/repository, actual source files, concise repository instructions, reproducible dependencies, browser tests, and access to the specific development services when they are needed.

Recommendations below are project setup choices, not claims that this session has already configured them.

| Setup | Needed when | Who/what provides it |
|---|---|---|
| Private Git repository or local Git workspace | Start | Owner selects repository; Codex scaffolds and maintains code |
| This file plus reference package/assets | Start | Attach files or place them in the selected workspace |
| Node/npm, Python 3.12, uv, Git | Start | Existing runtime or project setup script; pin compatible versions |
| Browser test runtime | UI verification | Playwright or the available browser capability |
| PostgreSQL/Supabase test environment | Tenant/security integration tests | Local Supabase if Docker works, otherwise dedicated development project |
| Supabase development project access | Live Auth, storage, Edge Functions | Owner-managed access; migrations and configuration created by Codex within authorization |
| YouTube Data API project key | Public API collection | Google Cloud project configuration; keep key server-side |
| Google OAuth web client/test users/redirect URI | Live account linking | Owner configures consent/account access; Codex prepares callback and tests |
| Python worker runtime with writable persistent cache/data | Real collection and model inference | Developer machine initially; separately selected hosted runtime later |
| Sites access with private deployment capability | Private pilot delivery | Existing Sites integration; verify access mode before publishing |
| SMTP/deliverability setup | Real invitation and account-email flow | Configure when needed; local test mail is sufficient for early development |
| Human-reviewed evaluation labels | Selecting the best model | Human annotators; coding work can proceed before completion |

A GPU is not an initial requirement. Start CPU inference with small batches, cache one model at a time, and measure memory/time before buying hardware or hosting. An OpenAI API key is not required by the specified open-source sentiment pipeline; Codex access and application inference are separate.

### Recommended execution arrangement

Use Codex in a local desktop/IDE/CLI workspace for lengthy collection and model downloads if managed cloud network/runtime constraints prevent them. Use a private repository as the common project state. The current handoff environment has restricted network access; the availability of web browsing does not prove shell access to YouTube, package registries, or Hugging Face.

If using Codex cloud, configure the repository environment and dependency setup there. Official documentation says setup scripts run before the agent phase, agent internet access is controlled separately, and cloud secrets are available only to setup scripts. Therefore, do not assume a cloud setup secret will exist during live OAuth tests; do not persist it to a file simply to bypass that boundary. Keep runtime service secrets in the application backend, and use an authorized local environment for credential-dependent tests where appropriate. [Codex cloud environments](https://learn.chatgpt.com/docs/environments/cloud-environment)

Allow only the network access required by the selected workflow: package registries, the selected Git host, model downloads, the specific development Supabase project, and YouTube/Google endpoints. Model/package downloads may use additional CDN hosts; diagnose actual failures instead of promising a universal fixed allowlist. If access is blocked, finish fixture-based work and record which live checks remain blocked.

### Codex configuration files

Use a short repository-root `AGENTS.md` that points to this specification. Do not rename the entire long specification to `AGENTS.md`: automatic instruction loading has a documented default aggregate limit of 32 KiB. Keep the detailed document under `docs/` and explicitly instruct the agent to read it. [AGENTS.md guidance](https://learn.chatgpt.com/docs/agent-configuration/agents-md)

No `config.toml` edits are necessary for this handoff. If a local CLI/IDE customization later becomes useful, keep it project-scoped where supported. Official documentation distinguishes user configuration at `~/.codex/config.toml` from trusted project overrides at `.codex/config.toml`; hosted environments have their own settings. Do not blindly copy local configuration into ChatGPT Work. [Config basics](https://learn.chatgpt.com/docs/config-file/config-basic)

Optional integrations: GitHub for repository work, Supabase for development database management, and Sites for the private pilot. Their availability does not grant every external mutation. No additional recommended-plugin installation is needed merely to start coding.

## A8. Repository instructions to materialize during M0

Save this complete handoff as `docs/Codex-Build-Handoff.md`. Create the following concise root `AGENTS.md` (merge with existing instructions; do not overwrite unrelated rules):

```markdown
# Project instructions

Read docs/Codex-Build-Handoff.md completely before implementation.
The latest explicit user instructions take precedence over historical proposals.

Build the Arabic-first, multi-tenant YouTube sentiment MVP described there.
Inspect existing code/assets first. Reuse the design and repair its data flow.
Use React/TypeScript/Vite + Chart.js, Supabase control functions/Postgres/Auth,
and a separate Python worker. Do not add FastAPI or extra infrastructure
without a concrete need recorded in docs/decisions.md.

Keep UI publication private. Do not enable paid services or real billing
without explicit approval. Never expose tokens or server keys in VITE_*.
Keep real raw datasets out of tracked source; use sanitized test fixtures.

All dashboard views and exports share the same filter and effective-label rules.
Preserve Mixed sentiment, timestamp precision, text versions, and provenance.
Treat collection failures as partial/failed, never as successful empty datasets.
Make ingestion, analysis, job retries, and metering idempotent.
Test tenant isolation against direct requests, not just hidden UI controls.

Proceed through M0–M6 with reviewable increments. Continue local work if external
credentials are missing. Distinguish mocked, fixture-tested, and live-tested flows.
Update docs/progress.md, docs/decisions.md, and docs/verification.md after milestones.
Use the repository's actual lint/build/test commands and report real results.
Do not stop at planning or leave clickable controls without working behavior.
```

Create `CLAUDE.md` as a short instruction to read `AGENTS.md` and this document if Claude Code is also used. Avoid having two agents concurrently mutate the same branch or files.

### Environment contract to create, with placeholders only

Names below are proposed application variables; align them with actual implementation and document changes.

| Variable | Location | Purpose |
|---|---|---|
| `VITE_SUPABASE_URL` | Frontend | Development/project endpoint |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Frontend | Public client key, protected by RLS |
| `APP_BASE_URL` | Backend | Exact authorized frontend redirect origin |
| `SUPABASE_URL` | Backend | Project endpoint |
| `SUPABASE_SERVICE_ROLE_KEY` | Backend only | Privileged control functions; never browser/tenant-managed worker |
| `YOUTUBE_API_KEY` | Collector/backend secret store | Optional public Data API path |
| `GOOGLE_CLIENT_ID` | OAuth backend configuration | OAuth web client identifier |
| `GOOGLE_CLIENT_SECRET` | OAuth backend secret store | Token exchange |
| `GOOGLE_REDIRECT_URI` | OAuth backend | Exact registered backend callback |
| `TOKEN_ENCRYPTION_KEY` | Backend secret store | Authenticated token encryption |
| `TOKEN_ENCRYPTION_KEY_VERSION` | Backend configuration | Key rotation/provenance |
| `WORKER_API_BASE_URL` | Worker | Authorized control endpoint |
| `WORKER_CREDENTIAL` | Worker secret store | Separate scoped worker identity |
| `SENTIMENT_MODEL_ID` | Worker | Selected model repository |
| `SENTIMENT_MODEL_REVISION` | Worker | Actual pinned model commit |
| `MODEL_DEVICE` | Worker | CPU initially |
| `HF_HOME` | Worker | Persistent model cache |
| `RAW_DATA_DIR` | Worker | Persistent checkpoint/raw data path |

Do not ask the owner to paste secrets into chat. Request the variable name and secure destination only when the related live integration becomes the next real blocker.

### Reproducible setup

During M0, implement and verify setup scripts after creating the actual package manifests. They must install pinned Node dependencies from the committed lockfile and Python dependencies from `uv.lock`, prepare browser tests, and explain whether database integration tests require Docker or a remote development project. Setup must be repeatable and must not automatically scrape a channel, apply production migrations, deploy publicly, or create paid resources.

Expected command interfaces to implement and document, not commands claimed to exist today:

- `npm run dev`, `npm run build`, `npm run lint`, `npm run typecheck`
- `npm run test`, `npm run test:e2e`
- From `workers/python`: `uv sync --frozen`, `uv run pytest`
- Separate documented commands for migration tests, collection smoke tests, resumable full collection, and model inference

Use a persistent process/runtime for the worker. A finished Codex chat or a closed laptop is not a background scheduling service.

## A9. Implementation sequence and checkpoints

Use the full M0–M6 criteria in Part B. The practical first iteration should establish a small vertical flow before widening the interface.

1. **M0: inspect and scaffold.** Inventory source files and existing code; initialize the selected private workspace; create instructions, manifests, contracts, fixtures, and CI. Record actual commands and runtime capabilities.
2. **M1: preserve and collect.** Import the recorded catalog/sample, verify identifiers, implement per-video collection with durable checkpoints and explicit status. A full backfill must be resumable; never let one failing video block unrelated development.
3. **M2: secure SaaS foundation.** Migrations, Auth, workspace/client/channel ownership, private storage, RLS, and role-checked control operations.
4. **M3: ingestion and analysis.** Legacy import/reconciliation, job leases, real baseline inference, immutable provenance, effective labels, and idempotent metering. A deterministic test analyzer can support tests but must be clearly identified.
5. **M4: product exploration.** Reused visual identity, one filter contract, KPIs/charts, complete comment search, human correction, CSV export, and sync health.
6. **M5: real OAuth.** Server callback, verified channel selection, encrypted tokens, revocation/reconnect, and safe reconciliation with pilot data.
7. **M6: private pilot.** Manual plan activation, enforced usage limits, actual worker scheduling on the selected runtime, private deployment, browser walkthrough, and handover.

M1 and M2 have independent dependencies and may progress without waiting on each other. This is scheduling guidance, not a requirement to activate multiple agents.

For each milestone, record changed files, commands, observed results, blocked live checks, and next action. Keep the owner informed with concise updates; do not repeatedly ask for approval for already-authorized reversible coding work.

### Critical acceptance evidence

| Area | Evidence required |
|---|---|
| Tenant isolation | A user cannot read/update/export/claim workspace B data through direct API, RPC, or storage calls |
| Collector durability | Interrupt and resume after a committed batch; no duplicated comments or false completion |
| Reply coverage | Validate a thread with more replies than the initial page exposes; preserve unknown parents honestly |
| Dates | Minute/second legacy examples accepted; unknown/relative dates preserved; timezone assumption explicit |
| Labels | Mixed preserved; empty/failed/stale predictions excluded from sentiment denominator |
| Dashboard | Independent expected counts match all filtered views and export; stale requests cannot overwrite newer filters |
| Search | A comment/author outside a top-N list can be found |
| OAuth | Invalid/expired/reused state rejected; wrong channel cannot claim pilot data; live test separately evidenced |
| Secrets | No refresh/service-role/encryption secrets in browser bundles, logs, exports, or Git |
| Quotas | Concurrent requests cannot overspend; retries and reimports do not double charge |
| UX | Arabic RTL, responsive layout, loading/retry/empty states, keyboard access, usable buttons |
| Deployment | Access actually private; working URL and a recorded authorized browser smoke test |
| Worker | Last successful run and outage/queued status visible; scheduled execution verified if claimed |
| Model quality | Human benchmark report, or explicit provisional baseline status without invented accuracy |

A fixture-backed private preview is a useful interim milestone. It is not the finished live SaaS while OAuth, persisted tenant data, or the real worker remains mocked.

## A10. Ready-to-paste kickoff prompt

```text
Read docs/Codex-Build-Handoff.md completely, including the preserved SpecTech.
Inspect the selected repository and all supplied reference assets before editing.

Implement this Arabic-first YouTube sentiment SaaS MVP. Start with M0 and
continue through the available milestones; do not stop after writing a plan.
Preserve the existing brand/design and replace static data with a coherent,
tested ingestion -> analysis -> dashboard -> correction/export workflow.

Use the resolved stack and data contracts in the handoff. Keep actual YouTube
OAuth in scope, independent of product login. Begin public pilot collection
before creator authorization, with durable checkpoints and honest coverage.
AraBERT is a provisional baseline; do not invent benchmark results.

Create concise AGENTS.md, placeholder-only environment examples, reproducible
setup commands, and progress/verification records. Test the failure cases,
tenant isolation, calculations, retries, and usage limits described in the spec.
Continue with fixtures and local integration work when external credentials
are missing; identify exactly which live checks remain blocked.

Keep the deployment private using Sites where available and authorized.
Do not publish publicly, enable paid services, or activate real payments
without my approval. Ask for secure service configuration only when needed
for a concrete next integration, and never ask me to paste secrets into chat.

At each milestone report what works, what was actually tested, what remains
blocked, and the next step. At completion provide the private working URL,
source/repository location, startup instructions, and remaining limitations.
```

## A11. Source and status notes

- The complete original SpecTech below was read from the existing `SpecTech-YouTube-Sentiment-MVP.md`, version 1.1, dated 2026-09-12.
- Added conversation context supplies the legacy data discrepancies and the model/downloader review history.
- Codex setup guidance was checked against the linked official OpenAI documentation on 2026-09-12.
- Third-party model metrics, library versions, pricing, and service limits within Part B are historical statements from the original specification. Verify changeable facts at implementation/deployment time.
- This handoff does not include the ZIP's binary assets or raw datasets and does not claim they were revalidated.
- No hosting login, secret configuration, database creation, scraping, model inference, repository modification, or application deployment was performed to prepare this document.

# Part B — Complete preserved SpecTech v1.1

The following original specification is preserved in full. Read it together with Part A's explicit resolution of the hosting preference and superseded architecture proposals.

---

# SpecTech — Arabic Audience Sentiment SaaS

الإصدار: 1.1 • تاريخ الإعداد: 2026-09-12 • المالك: Mohammed Lubbad

هذه مواصفة تنفيذية للـMVP، موجهة إلى Codex وClaude Code. القرارات أدناه هي نقطة البدء؛ البنود الموسومة «لاحقًا» لا تدخل في الإصدار الأول. لا تعني هذه الوثيقة أن التطبيق أو OAuth أو الجمع الكامل قد نُفّذ.

## 1. النتيجة المطلوبة

منتج عربي متعدد المستخدمين يساعد المؤثر ووكالة التسويق على متابعة مشاعر التعليقات، اكتشاف الاعتراضات والأسئلة، ومقارنة الفيديوهات والفترات. يبدأ بيوتيوب وبقناة علاء جابر كشريك تجربة.

- القناة: https://www.youtube.com/@alaa_jaber_official
- معرّف القناة الذي استُخرج من صفحتها العامة: `UCTPIL6f7yNpK8yc-H3cEtFg`.
- الموارد الحالية: استضافة مشتركة، بيانات سابقة وخمسة فيديوهات محللة، نموذج واجهة HTML، ودفتران لتحميل نماذج المشاعر.
- التطوير: Codex أو Claude Code؛ مستودع Git واحد، وتغييرات صغيرة قابلة للمراجعة.
- المدخل النهائي: يسجل المستخدم في المنتج، ينشئ مساحة عمل، ثم يربط قناته من إعدادات حسابه عبر Google OAuth.
- المسار الموازي المبكر: جمع البيانات العامة للقناة قبل الحصول على OAuth، دون الحاجة إلى انتظار بناء كامل التطبيق.

تعني «كل الفيديوهات» كل الفيديوهات العامة القابلة للاكتشاف في تبويبات Videos وShorts وStreams وقت الجمع، بعد إزالة تكرار المعرّفات. لا تشمل ملفات الفيديو نفسها، ولا البث المباشر الحي أو سجل الدردشة، ولا المحتوى الخاص أو المحذوف أو غير المدرج غير المكتشف. وتعني «كل التعليقات» كل التعليقات والردود التي أتاحها المصدر فعليًا، مع إعلان حدود التغطية والفشل الجزئي.

## 2. قرارات معمارية ملزمة

| الجزء | الاختيار | سبب الاختيار |
|---|---|---|
| واجهة المستخدم | React + TypeScript + Vite | بناء ملفات ثابتة قابلة للرفع إلى الاستضافة المشتركة |
| التصميم | Tailwind CSS + مكونات Radix/shadcn عند الحاجة | RTL وإمكانية وصول ومكونات قابلة للتعديل |
| الرسوم | Chart.js + react-chartjs-2 | الاستفادة من الرسوم الموجودة بدل إعادة بنائها بلا حاجة |
| بيانات الواجهة | TanStack Query + React Router + Zod | التخزين المؤقت، حالات الطلب، توحيد الفلاتر والتحقق من المدخلات |
| الحسابات | Supabase Auth | تسجيل ودخول واستعادة كلمة المرور |
| قاعدة البيانات | Supabase PostgreSQL | بيانات مترابطة، معاملات، RLS، تقارير SQL |
| الملفات | Supabase Storage بحاويات خاصة | CSV وملفات الاستيراد والتصدير الصغيرة |
| وظائف الخادم القصيرة | Supabase Edge Functions / TypeScript | OAuth، إنشاء المهام، الإجراءات الحساسة |
| الجمع والتحليل | Python 3.12 في عامل مستقل | توافق PyTorch وTransformers وأدوات الجمع |
| إدارة اعتماديات Python | uv وملف uv.lock | تثبيت البيئة وإعادة إنتاج النتائج |
| المهام | جدول jobs في PostgreSQL وحجز ذري بمهلة | طابور بسيط دون Redis أو Celery في البداية |
| حصر الفيديوهات العامة | yt-dlp بوضع استخراج البيانات فقط | حصر Videos وShorts وStreams دون تنزيل وسائط |
| التعليقات العامة دون API Key | yt-dlp داخل adapter مثبت الإصدار | نجح اختبار تعليقات فعلي؛ حصر وردود وبيانات في مكتبة واحدة |
| بديل التعليقات | youtube-comment-downloader بعد إصلاحه، عند الحاجة | بديل صريح قابل للاختبار؛ لا fallback صامت |
| الجمع العام عند توفر API Key | YouTube Data API بمفتاح مشروعنا | لا يحتاج موافقة صاحب القناة لقراءة البيانات العامة؛ تواريخ وparentId منظمة |
| الربط والمزامنة المصرح بها | YouTube Data API + OAuth readonly | ربط هوية القناة بالمستخدم وتحديث البيانات المنظمة |
| التحليل الأولي | PRAli22/AraBert-Arabic-Sentiment-Analysis | مرجع مؤقت قابل للاستبدال، وليس فائزًا مثبتًا بالدقة |
| التحقق | Vitest + Playwright + pytest | اختبارات العزل وOAuth والمزامنة والحسابات الأساسية |

تُثبت الإصدارات المتوافقة عند تهيئة المستودع في package-lock.json وuv.lock؛ لا تعتمد أوامر ترقية مفتوحة داخل التشغيل. لا نفترض أن الاستضافة المشتركة تدعم Node أو Docker أو Python أو عمليات طويلة.

### توزيع التشغيل

1. الاستضافة المشتركة: مجلد `dist/` للواجهة، HTTPS، وإعادة توجيه مسارات SPA. إذا تعذر إعداد rewrite، استخدم HashRouter مؤقتًا ووثّق ذلك.
2. Supabase: Auth وPostgres وStorage ووظائف التحكم القصيرة.
3. جهاز المطور: جمع البيانات وتحليلها أولًا، دون منفذ عام، باستخدام اتصال خارجي بالخادم.
4. عند الحاجة لتحديث تلقائي مستمر: نفس عامل Python داخل حاوية على خدمة Jobs أو خادم صغير؛ لا نفترض رصيدًا مجانيًا دائمًا. يحدد النشر بعد قياس استهلاك تجربة القناة.

تفاصيل المزود المتاحة تشير إلى لوحة استضافة على المنفذ 2222 وخدمة بريد منفصلة. بيانات الدخول لا تدخل هذه الوثيقة أو المستودع. لم يُختبر الدخول إلى اللوحة أو قدرات SSH/cron/Python، ولم تتغير DNS أو ملفات الموقع. نشر الواجهة يتم إلى مجلد التطبيق بعد تحديد النطاق والـdocument root من اللوحة، مع نسخة رجوع قبل الاستبدال. تهيئة SMTP تخص Supabase Auth أو مزود بريد؛ لا نفترض أن كلمة مرور لوحة الاستضافة هي كلمة مرور صندوق بريد، ولا نرسل SMTP من Edge Functions على المنافذ المحظورة لديها.

عامل يعمل على جهاز مغلق لا يوفر تحديثًا على مدار الساعة. تعرض الواجهة وقت آخر تشغيل وحالة انتظار العامل بصدق. لا يشغّل PyTorch داخل Edge Functions أو المتصفح. لا حاجة إلى FastAPI في الإصدار الأول لأن العامل يسحب المهام ولا يقدم API عامًا.

### حدود التكلفة

الخطة المجانية الحالية لـSupabase تعرض 500MB لقاعدة البيانات و1GB للملفات و5GB للخروج، وتوقف المشاريع بعد أسبوع من عدم النشاط. هذه حدود تجربة وليست ضمانًا لاستيعاب القناة كاملة. لا تعني مجانية الاستضافة مجانية الحوسبة غير المحدودة. المصدر: https://supabase.com/pricing

نقيس أولًا الحجم بعد 1000 تعليق مع الفهارس، ثم نقدّر الحجم الإجمالي بعد حصر الفيديوهات. لا نخزن الصور المصغرة أو الأوزان في قاعدة البيانات. ملفات الجمع الخام تضغط وتبقى خارج جداول الخدمة، وتحمّل على دفعات ضمن السعة. تظهر تنبيهات داخلية عند 70% و85% من ميزانية التخزين، ويوقف الاستيراد عند الحد المخصص دون فقد الملفات الخام.

## 3. نطاق المنتج والأدوار

| الدور | الصلاحيات |
|---|---|
| workspace_owner | إدارة مساحة العمل، الأعضاء، العملاء، الاتصالات وحدود الخطة |
| analyst | قراءة البيانات والتحليل والتصحيح وإنشاء تقارير وتشغيل مزامنة ضمن الحدود |
| viewer | عرض اللوحات والتقارير المصرح بها فقط |

الشريحة الأولى: مالك قناة ووكالة تدير عدة عملاء. تنشأ مساحة عمل شخصية تلقائيًا عند التسجيل. جميع الجداول التجارية تحمل workspace_id، والعملاء ينتمون لمساحة العمل. لا توجد لوحة عامة تكشف التعليقات أو بيانات عملاء آخرين.

يشمل الإصدار الأول: التسجيل، عميل وقناة، OAuth، الاستيراد، المهام، تحليل المشاعر، لوحة تفاعلية، قائمة التعليقات، التصحيح البشري، مقارنة فيديوهات، تصدير CSV، وخطط استخدام قابلة للإدارة اليدوية.

لاحقًا: المنصات الأخرى، نشر الردود، دردشة AI، تقرير توليدي طويل، sentiment على مستوى جوانب متعددة، بوابة دفع حقيقية، ونظام تخصيص كامل لعلامة كل وكالة. لا تُعرض ميزات لاحقة كأزرار فعالة أو نتائج مصطنعة.

## 4. تسجيل الدخول وربط يوتيوب

تسجيل الدخول إلى المنتج عملية مستقلة عن منح صلاحية يوتيوب. يبدأ المستخدم ببريد وكلمة مرور؛ يمكن إضافة Google Sign-in لاحقًا دون ربط يوتيوب تلقائيًا.

المسار المطلوب:

1. يضغط owner على «ربط قناة يوتيوب» داخل عميل محدد.
2. وظيفة OAuth start تتحقق من جلسة Supabase وعضويته وصلاحيته، وتنشئ state عشوائيًا أحادي الاستخدام محفوظًا كـhash، مرتبطًا بـuser_id وworkspace_id وclient_id، وصالحًا 10 دقائق.
3. تحوّل المستخدم إلى Google بطلب `youtube.readonly` و`access_type=offline`؛ تضاف موافقة جديدة عند الحاجة فقط. لا نعتمد بريد المستخدم لإثبات ملكية قناة.
4. callback قابل للوصول من Google دون Supabase JWT، لكنه يتحقق من state المخزن وأحادي الاستخدام وانتهاء الصلاحية، ويعالج الرفض بأمان. لا يثق بمعرّفات مساحة عمل من query string.
5. تُستبدل code بتوكنات على الخادم. تستخدم مكتبة OAuth موثوقة وتفعل PKCE إذا دعمته في هذا التدفق. لا تصل refresh tokens إلى المتصفح أو ملفات السجل.
6. ينفذ الخادم `channels.list(mine=true, part=id,snippet,contentDetails)` باستخدام التوكن الجديد. تعرض القنوات التي أعادها فعلًا؛ إذا لم تظهر القناة المطلوبة، تظل غير متصلة ويشرح المنتج ضرورة اختيار الهوية الصحيحة، بما يشمل Brand Accounts.
7. يختار المستخدم قناة من القائمة التي تحقق منها الخادم؛ لا يقبل channel_id عشوائيًا يرسله العميل.
8. تُحفظ التوكنات مشفرة بتشفير موثق مثل AES-GCM، والمفتاح في أسرار الخدمة، مع key_version. الجداول السرية خارج مخطط public وغير متاحة عبر Data API.
9. يوجّه callback إلى صفحة التطبيق `/connections/result` بحالة عامة دون أسرار. تتأكد الصفحة من جلسة المستخدم ثم تجلب حالة الاتصال من الخادم.
10. ينشأ عمل تحقق ومزامنة؛ انتهاء أو إلغاء التوكن يغيّر الاتصال إلى reconnect_required ويوقف المهام المعتمدة عليه. لا يتحول تلقائيًا إلى كشط دون علم المشغّل.

يُضبط redirect URI الفعلي قبل اختبار OAuth. تطلب بيانات Google Cloud عبر إعدادات أسرار البيئة عند التنفيذ، ولا توضع في المحادثة أو المستودع. يمكن بناء الواجهة والعقود واختبارات OAuth المزيفة قبل وجود هذه البيانات؛ الاختبار الحي يظل معلّمًا بأنه غير منفذ حتى توفيرها.

## 5. الجلب المسبق وإلحاق البيانات بعد OAuth

الجمع المسبق مستقل عن الحساب المتصل. يبدأ بكتالوج وملفات خام ومعرّفات يوتيوب، ويسجل مصدره `youtube_public_scrape`.

يوجد مسار أكثر تنظيمًا تقنيًا قبل OAuth أيضًا: عند إنشاء API Key لمشروعنا يمكن جلب الفيديوهات والتعليقات العامة عبر YouTube Data API دون انتظار موافقة صاحب القناة. عدم توفر وصول لحسابه ليس مانعًا لهذا المسار. نسجل مصدره `youtube_data_api_public`، ويستخدم المفتاح على الخادم. في البيئة الحالية لم يُوفر مفتاح خاص بهذا المنتج؛ نجري الجمع العام المبكر عبر yt-dlp، ونفضّل API للمزامنة المنظمة حين يُجهز المفتاح. يبقى OAuth ميزة إلزامية لربط الحساب ولا يحل API Key محله.

داخل الخدمة، توضع بيانات التجربة في مساحة عمل pilot يملكها المشغّل وتُوسم القناة `public_unverified`. لا يحق لأي مستخدم يكتب الرابط أن يطالب بهذه البيانات أو ينقلها لحسابه.

عند ربط القناة نفسها في مساحة pilot يتم تحديث علاقة الاتصال بالـchannel_id نفسه، وتبقى الفيديوهات والتعليقات ومعرّفاتها الداخلية ثابتة. أما ربط القناة في مساحة مختلفة فلا ينقل بيانات pilot تلقائيًا؛ يكون نقل/نسخ البيانات إجراء إداريًا صريحًا، بعد تحقق صلاحية الطرفين، مع سجل تدقيق ومنع التكرار. لا تستخدم جداول تعليقات مشتركة عالميًا بين العملاء في الـMVP.

بعد الربط: نعمل reconciliation بين سجل القناة والبيانات المصرح بها. تحديث مصدر حقل لا يمحو مصدره السابق، ولا يعيد تشغيل التحليل إذا لم يتغير النص الفعلي أو إعداد التحليل. لا نحول تاريخًا تقريبيًا إلى تاريخ دقيق بمجرد الربط دون الحصول على تاريخ دقيق من المصدر.

## 6. خطة جمع القناة

### أ. اكتشاف الكتالوج

- زيارة Videos وShorts وStreams كمهام منفصلة. صفحات Home ليست كتالوجًا كاملًا.
- استخراج channel_id والتحقق من مطابقته للقناة المثبتة في هذه الوثيقة.
- حصر المعرّفات عبر pagination حتى انتهاء المصدر الطبيعي، وتسجيل خطأ أي تبويب مستقلًا.
- دمج video_id المكرر عبر التبويبات؛ الاحتفاظ بـdiscovered_in_tabs بدل مضاعفة الفيديو.
- الحفظ في JSONL/SQLite قبل أي تحليل، مع discovery_started_at وdiscovery_finished_at وextractor_version.
- بعد الحصر، تُغنى البيانات الناقصة لكل فيديو؛ لا تعد بيانات flat-playlist مصدرًا كاملًا للتواريخ أو عدد التعليقات.

### ب. جلب التعليقات والردود

- جدول عمل لكل فيديو. التوازي الافتراضي 1، مع مهلات ومحاولات محدودة؛ لا نعد بمدة جمع قبل معرفة الحجم.
- الفرز بالأحدث لتقليل إعادة المرور في المزامنة، لكنه لا يكفي وحده لاكتشاف ردود جديدة على تعليقات قديمة.
- تخزين النص الأصلي فور وصوله مع comment_id وvideo_id؛ إزالة التكرار بالمعرّف، وليس النص.
- استخراج parent_comment_id عندما يتوفر بصورة موثوقة. إذا استُنتج من بنية المعرّف، يوسم `parent_source=inferred_id` ويختبر على حالات فعلية؛ لا يعد حقيقة مضمونة. يسمح برد بلا أصل متاح.
- `author_channel_id` يخص المعلق، و`owner_channel_id` يخص صاحب الفيديو. لا يستخدم أحدهما مكان الآخر.
- حفظ published_time_raw وpublished_at وtimestamp_precision وcollected_at منفصلة. المصدر النسبي يعني دقة تقريبية، والتاريخ غير القابل للتحويل يظل null.
- أعداد الإعجابات المعروضة نصيًا تحفظ raw؛ الرقم المختصر يوسم تقريبيًا، والفشل لا يحول القيمة إلى صفر.
- اكتشاف حدود التعليقات أو توقف الشبكة أو تعطل parser يجب أن ينتج partial/failed، وليس completed.

### ج. adapter الجمع المعتمد والبديل

الاختيار المبدئي بعد التجربة: yt-dlp 2026.8.19. نجح حصر التبويبات الثلاثة وجلب عينة محدودة من التعليقات باستخدامه. لا نستخدم تنزيل الفيديو أو الصوت. الاستخدام العام عبر extract_info قد يطلب معلومات صيغ الوسائط حتى مع skip_download؛ مسار metadata/comments المتخصص يقلل هذا العمل، لكنه إن استخدم `_get_comments` أو دوال داخلية فيجب عزله في adapter مثبت الإصدار مع اختبارات توافق، وليس نشر استدعاءات خاصة في كامل المشروع.

حفظ الردود يستفيد من حقل parent الذي يستخرجه yt-dlp، بدل الاعتماد فقط على النقطة في معرّف التعليق. لا نحمّل جميع التعليقات في قائمة ذاكرة قبل حفظها؛ يمر generator على دفعات ثابتة إلى التخزين. نلتقط تحذيرات الردود الناقصة والأخطاء؛ نجاح خروج العملية وحده ليس إثبات اكتمال البيانات. عدد comment_count بعد الاستخراج قد يكون عدد ما جُمع، لذلك يحفظ advertised_comment_count قبل الاستخراج مستقلًا. max_comments يستخدم في smoke test فقط؛ الجمع الكامل يزيله ويعلن أي توقف آخر.

جودة التغطية للردود عميقة التداخل تحتاج اختبارًا على فيديو معروف بكثرة الردود قبل اعتماد adapter نهائيًا. نتيجة اختبار 30 تعليقًا لا تكفي لإثبات تغطية جميع الردود على جميع الفيديوهات.

البديل عند وجود عطل نوعي موثق هو المشروع السابق مع الإصلاحات التالية؛ لا يُنفذ هذا البديل لمجرد استهلاك الميزانية أو انتهاء التوكن.

النسخة المرجعية: `9771beeb5be3c9648af011fe10cd813187550db0` من https://github.com/egbertbouman/youtube-comment-downloader

1. ajax_request يعيد نتيجة منظمة أو يرفع خطأ صريحًا عند 403/429/5xx/نفاد المحاولات، ولا يعيد dict فارغًا يُفسر انتهاءً طبيعيًا.
2. مهلة لكل GET وPOST، والتحقق من status ومن وجود بنية الصفحة. parser غير المتوافق لا يعني «لا توجد تعليقات».
3. نتيجة نهائية: exhausted / explicitly_disabled / unavailable / partial / failed / blocked. `exhausted` يعني انتهى ما أتاحه المصدر، لا إثبات 100% من الرقم المعروض.
4. JSONL هو الإخراج الخام؛ CSV يستخدم أعمدة ثابتة تستوعب paid وtime_parsed الاختياريين.
5. ربط فيديو/قناة/مهمة بكل سجل؛ حماية SSRF بقبول معرّفات مدققة وبناء URLs داخل adapter والتحقق من وجهات redirects.
6. نقاط حفظ دائمة بعد كل دفعة. إذا بطل continuation token يعاد المرور للفيديو مع upsert، مع الاحتفاظ بما جمع سابقًا.
7. لا تغيير لهوية الطلب لتجاوز حظر، ولا دوران بروكسيات أو محاولات غير محدودة. عند الحظر تحفظ النتائج ويعلن التوقف.

### د. الاستئناف والنتيجة النهائية

انقطاع العملية لا يمحو البيانات. يحفظ العامل كل دفعة ويحدّث checkpoint ضمن معاملة، ثم يستأنف الفيديوهات غير المنتهية. تحفظ علة الاستثناء ونوعه بلا أسرار. بعد انتهاء الدورة يُولد manifest فيه عدد الفيديوهات المكتشفة، المكتملة من حيث المرور، الجزئية، المعطلة التعليقات، المحجوبة، وعدد التعليقات والردود الفريدة.

لا تعرض نسبة إنجاز محسوبة على إجمالي تعليقات مجهول. تعرض «اكتمل المرور على 12 من 50 فيديو؛ جُمع 8000 تعليق» مع فصل فشل الجمع عن التعليقات المعطلة. لا نعد العدد المعروض من يوتيوب حقيقة مطابقة لحصيلة الجلب.

## 7. النموذج المنطقي للبيانات

جميع التواريخ التشغيلية UTC بصيغة timestamptz. جميع العلاقات التجارية مركبة لتمنع إسناد سجل مساحة عمل إلى عميل أو فيديو في مساحة أخرى. القيم المالية والعدادات أعداد صحيحة حيث أمكن.

| الجدول | أهم الحقول والقيود |
|---|---|
| workspaces | id, name, timezone, created_by |
| memberships | workspace_id, user_id, role؛ unique(workspace_id,user_id) |
| clients | id, workspace_id, name؛ unique(workspace_id,id) |
| channels | id, workspace_id, client_id, platform, external_channel_id, handle, status؛ unique(workspace_id,platform,external_channel_id) |
| private.oauth_connections | id, workspace_id, channel_id, connected_by, encrypted_tokens, granted_scopes, expires_at, status |
| private.oauth_states | state_hash, user_id, workspace_id, client_id, expires_at, consumed_at |
| videos | id, workspace_id, channel_id, external_video_id, title, kind, published_at, duration_sec, last_observed_at؛ unique(workspace_id,platform,external_video_id) |
| comments | id, workspace_id, video_id, external_comment_id, external_parent_id, author_channel_id, text_raw, text_plain, content_hash, published_at, timestamp_precision, likes_raw, likes_value, source, first_seen_at, last_seen_at؛ unique(workspace_id,platform,external_comment_id) |
| analysis_runs | id, workspace_id, model_id, revision_sha, preprocessing_version, parameters, started_at, status |
| sentiment_predictions | workspace_id, comment_id, content_hash, analysis_run_id, analysis_key, label, class_scores, predicted_at؛ unique(workspace_id,comment_id,content_hash,analysis_key) |
| comment_reviews | workspace_id, comment_id, content_hash, label, reviewer_id, reason, created_at؛ append-only |
| comment_annotations | workspace_id, comment_id, kind, value, method, version؛ منفصلة عن sentiment |
| jobs | id, workspace_id, channel_id, type, dedupe_key, status, attempt, not_before, lease_token, lease_expires_at, checkpoint, counters, error_code |
| sync_runs | id, workspace_id, channel_id, mode, source, started_at, ended_at, status, coverage_summary |
| imports | id, workspace_id, file_path, file_hash, schema_version, status, row_counts, rejected_rows_path |
| subscriptions | workspace_id, plan_key, status, period_start, period_end, provider, provider_ref |
| usage_events | workspace_id, period_start, event_key, units, event_type؛ unique(workspace_id,event_key) |
| audit_events | workspace_id, actor_id, action, target_type, target_id, created_at؛ دون أسرار أو نصوص تعليقات كاملة |

`analysis_key` بصمة النموذج والمراجعة والمعالجة والإعدادات؛ ليست run_id. إعادة تشغيل مهمة بنفس التحليل لا تضاعف التنبؤات ولا الفاتورة. تغيير النص يبطل مراجعة النص السابق في العرض حتى يعاد تدقيقه. إذا تغيرت الإعجابات فقط لا يتغير content_hash.

أضف platform صراحة لكل جدول تستخدمه قيوده. لتتبع مصدر الحقول، يحتوي videos/comments على field_provenance منظم أو جدول observations مرتبط؛ source واحد للصف لا يكفي بعد دمج API مع كشط. الربط المركب يفرض أن video.workspace_id يطابق channel.workspace_id وأن comment.video_id ينتمي لمساحة التعليق نفسها.

فهارس أولية: comments(workspace_id,video_id,published_at,id)، videos(workspace_id,channel_id)، jobs(status,not_before)، predictions(workspace_id,comment_id,analysis_key). لا تعتمد بحثًا عربيًا صرفيًا متقدمًا في الإصدار الأول؛ يبدأ بحث نصي محدود مع قياس تكلفته.

## 8. العزل وحجز المهام

- RLS على جميع الجداول المعروضة وحاويات Storage. تحقق العضوية من auth.uid()، لا من user_id أرسله العميل.
- العضو لا يرفع دوره أو يغير workspace_id عبر تحديث مباشر. المسارات الإدارية تمر عبر إجراءات تفحص الدور صراحة.
- لا يعتمد التفويض على user_metadata القابل لتعديل المستخدم؛ مصدره memberships الحالي. تمنح صلاحيات Data API صراحة مع RLS، وتستخدم views ذات security_invoker=true حيث ينطبق. سياسات UPDATE تشمل USING وWITH CHECK وSELECT الملائمة.
- Edge Functions التي تستخدم service role تعيد التحقق من العضوية لكل طلب؛ امتلاك JWT وحده ليس إذنًا بالعمل على أي workspace.
- الواجهة تحتوي URL وpublishable key فقط؛ service_role والتوكنات ومفاتيح التشفير لا تدخل VITE_*.
- وظائف SQL ذات SECURITY DEFINER تحتاج search_path ثابتًا، تحققًا من المدخلات، ومنح EXECUTE لأدوار محددة فقط. views لا تتجاوز RLS.
- العامل يتصل بخدمة التحكم عبر worker credential منفصل محدود؛ لا يحتاج service_role في جهاز العميل. للخدمة صلاحية حجز مهام workspace المسموح للعامل بها فقط.
- الحجز ذري عبر FOR UPDATE SKIP LOCKED، مع lease_token وheartbeat. إكمال المهمة والدفعات يشترط تطابق lease صالح؛ العامل القديم لا يكتب بعد انتهاء مهلة الحجز.
- تأكيد الدفعة يشمل checkpoint والصفوف وعدادات الاستخدام في معاملة واحدة. retries آمنة لإعادة التنفيذ.
- معالجة الأخطاء: queued → running → succeeded/partial/failed/blocked/cancelled. المهلة المنتهية تعيد الجدولة بعدد محاولات محدود وتراجع أسي.

## 9. خدمة التحليل

### قرار النموذج

AraBERT هو baseline مؤقت بأربع فئات: 0 Positive، 1 Negative، 2 Neutral، 3 Mixed. لا يُدمج Mixed مع Neutral. MARBERT منافس تجريبي؛ config يحوي LABEL_0..2 ولا نعتمد ترتيبها دون تحقق من المصدر والتجربة.

بعد توسيع البحث، يضاف مرشحان إلى تجربة الاختيار: `CAMeL-Lab/bert-base-arabic-camelbert-da-sentiment` المخصص للعربية اللهجية، و`CAMeL-Lab/bert-base-arabic-camelbert-mix-sentiment` المبني على مزيج من الفصحى واللهجات والعربية الكلاسيكية. بطاقاتهما تسمي ASTD وArSAS وSemEval وتربط ورقة وكود التدريب؛ هذه شفافية أفضل للتقييم، وليست دليل تفوق على تعليقات قناتنا. تبدأ المقارنة بـAraBERT مقابل CAMeLBERT-DA، ويضاف Mix وMARBERT في الدورة نفسها متى توفرت الحوسبة.

CAMeLBERT-DA ثلاثي الفئات بخريطة واضحة: 0 positive، 1 negative، 2 neutral. اسم Mix يشير إلى أصناف اللغة في النموذج الأساسي، وليس وجود فئة مشاعر Mixed. تظل بنية المنتج قادرة على حفظ الفئات الأربع، لكن إذا اختير نموذج ثلاثي يجب أن تعلن الواجهة أن الكشف الآلي عن Mixed غير مدعوم؛ لا تُعرض نسبة صفر توحي بغياب المشاعر المختلطة.

التقييم حسب لهجات موسومة بشريًا من النص: شامي، مصري، خليجي، مغاربي، فصحى، ومختلط/غير محدد. لا تستنتج اللهجة من بلد المعلق أو اسمه، ولا تدّع تغطية لهجة ليس في اختبارها عينة كافية. يحتفظ بتقرير كل شريحة وعددها؛ متوسط كلي مرتفع لا يخفي فشلًا واضحًا في لهجة مهمة للعملاء.

لا تثبت دفاتر التحميل الموجودة دقة على بيانات المنتج. تحفظ registry للنماذج: id، revision، label mapping، حجم المدخل، preprocessing، النتائج المقاسة. تثبت revision من Hugging Face عند تنفيذ التحميل ولا تخترع SHA.

### خط المعالجة

1. حفظ النص الأصلي وإزالة HTML من نسخة التحليل مع فك entities؛ العرض كنص آمن دون dangerouslySetInnerHTML.
2. توحيد المسافات دون حذف النفي أو الإيموجي أو حروف اللهجات آليًا. تجهيز AraBERT يختبر مع/دون preprocessor الموصى به على مجموعة تطوير، ثم يثبت.
3. null والنصوص الفارغة وغير الصالحة = skipped، وليست محايدة. النص غير العربي أو المختلط لغويًا يوسم ويُفصل في التقييم.
4. تحميل نموذج واحد مرة لكل عملية؛ model.eval() وtorch.inference_mode() عند التحميل المباشر. يحدد الجهاز صراحة: CPU افتراضي، CUDA/MPS إن توفرا وثبت التوافق.
5. batch_size يبدأ صغيرًا ويقاس. ضبط max_length تجريبيًا؛ حفظ was_truncated وعدد tokens؛ لا يضاف عنوان الفيديو أو التعليق الأب عشوائيًا لأن النموذج لم يوثق تدريبه على تلك الصيغة.
6. حفظ احتمالات جميع الفئات. أعلى softmax ليس احتمال صحة معايرًا؛ تستخدم عتبة مراجعة تختار من مجموعة التطوير، ولا تدعى «دقة التعليق 98%».
7. التصحيح البشري منفصل عن تنبؤ النموذج؛ العرض effective_label يستخدم أحدث تصحيح يطابق content_hash الحالي، وإلا تنبؤ الإصدار الفعال.
8. تفعيل إصدار تحليل جديد للقناة بعد اكتماله؛ النسخة السابقة تبقى فعالة حتى ذلك الحين لتجنب خلط مقاييس مختلفة دون بيان.

أنواع مثل «سؤال» و«طلب تواصل» و«مسابقة» هي annotations مستقلة وموسومة بمصدر rules/model/manual. لا تعمم كلمات خاصة بقناة علاء جابر على بقية العملاء. لا يولّد النموذج الحالي أسبابًا لغوية موثوقة أو محاور تجارية تلقائيًا.

### تقييم الاختيار

ابدأ بنحو 600 تعليق، منها عينات من محتوى تجاري خارج قناة التجربة. اجمع تصنيفًا بشريًا مستقلًا يتضمن Mixed، وراجع الخلافات. افصل التطوير عن الاختبار واحفظ المتشابهات في نفس المجموعة. قارن الثلاث فئات المشتركة على غير المختلط، ثم اختبر المختلط منفصلًا؛ لا تقارن F1 منشورًا عبر مجموعات مختلفة. سجّل Macro-F1 وPrecision/Recall لكل فئة ومصفوفة الأخطاء والسرعة والذاكرة. لا تعتمد labels الناتجة عن القواعد السابقة كحقيقة اختبار.

## 10. العقود البرمجية

الأسماء أدناه عقود منطقية، تنفذ تحت Supabase `/functions/v1/...` أو RPC موثقة، وليست وعدًا بخادم REST منفصل.

| العملية | المصادقة والسلوك |
|---|---|
| POST youtube-oauth-start | user JWT + owner؛ يعيد authorization_url |
| GET youtube-oauth-callback | code/state من Google؛ تحقق state قبل تبادل التوكن |
| GET connections | user JWT؛ حالات الاتصال دون أسرار |
| POST connections/disconnect | owner؛ إلغاء اتصال وتوقيف الأعمال التابعة |
| POST imports/create | owner/analyst؛ رابط رفع خاص محدود الحجم ومدة الصلاحية |
| POST imports/commit | تحقق hash/schema ومساحة العمل؛ يعيد job_id |
| POST sync-jobs | تحقق الخطة والدور؛ Idempotency-Key يعيد نفس المهمة عند التكرار |
| GET jobs/:id | عضوية صحيحة؛ تقدم وعدادات وتغطية وخطأ مفهوم |
| RPC dashboard_snapshot | فلاتر موحدة؛ كل المقاييس في snapshot واحد |
| RPC comments_page | cursor pagination وفلاتر مطابقة للوحة |
| POST comment-reviews | analyst/owner؛ optimistic concurrency على content_hash |
| POST exports | مهمة بخلفية لإنتاج ملف خاص؛ رابط تنزيل قصير الصلاحية |
| POST worker/claim | worker credential؛ حجز محدود ومهلة |
| POST worker/heartbeat | worker credential + lease_token |
| POST worker/commit-batch | تحقق lease + workspace + حدود الدفعة ثم معاملة ذرية |
| POST worker/finish | نتيجة نهائية صريحة؛ لا نجاح تلقائي عند استنفاد retries |

أخطاء مشتركة: 400 invalid_input، 401 unauthenticated، 403 forbidden، 409 conflict، 422 unsupported_import، 429 quota_exceeded، 503 worker_unavailable. لا يخلط quota المنتج مع حصص المصدر. توجد request_id وretryable في استجابة الخطأ، دون stack trace للمستخدم.

## 11. الداشبورد ومعاني الأرقام

المرجع البصري: https://dashboard.sky-develop.net والملفات المرفقة. يعاد استخدام الفكرة والألوان والرسوم المناسبة، لكن البيانات المضمنة والحسابات الثابتة تُستبدل بعقود البيانات.

الفلاتر: العميل، القناة، الفيديو/مجموعة فيديوهات، نوع الفيديو، فترة نشر التعليق، المشاعر، نوع التعليق، تعليق/رد، حالة المراجعة، والنص. التاريخ الافتراضي مبني على نشر التعليق لا جمعه، والتواريخ غير المعروفة تظهر كفئة مستقلة. تعرض الدقة التقريبية عند استخدام بيانات الكشط.

- فترة التاريخ [from,to) بعد تحويل منطقة العمل الزمنية إلى UTC. المنطقة الافتراضية Asia/Istanbul قابلة للتغيير.
- إجمالي التعليقات = COUNT DISTINCT comment_id ضمن فلاتر البيانات، ويشمل الردود افتراضيًا مع عدّ منفصل.
- مقام نسب المشاعر = عدد التعليقات ذات effective_label صالح ضمن الفلاتر والإصدار الفعال. مجموع Positive/Negative/Neutral/Mixed = 100% قبل التقريب.
- غير المحلل والفارغ والقديم التحليل لا يدخل مقام المشاعر، ويظهر عدده بوضوح.
- unique_authors = عدد author_channel_id المتاح، وليس عدد البشر المؤكد. لا تدمج أسماء العرض المتشابهة.
- اختيار فترة نشر تعليق لا يقسم مشاهدات الفيديو الكلية على هذه الفترة. مؤشرات الفيديو لها تاريخ رصد ونطاق مستقلان ومعلنان.
- likes ليست وزنًا افتراضيًا للمشاعر. لا يساوي قلب صاحب القناة مشاعر إيجابية.

تتضمن الشاشة: KPIs، توزيع المشاعر، اتجاه زمني، مقارنة الفيديوهات، جدول التعليقات، أكثر التعليقات السلبية تفاعلًا، توزيع أنواع التعليقات حيث تتوفر، ولوحة صحة المزامنة.

عند «تطبيق» الفلاتر ينشأ filter_hash؛ إما snapshot واحد أو أجزاء تشترك في revision. إذا تغيرت البيانات قبل اكتمال الأجزاء يعاد الطلب. تلغى الطلبات القديمة ولا تستبدل شاشة فلاتر أحدث. يظهر shimmer للحالات الأولى، ومؤشر تحديث للبيانات المعروضة، ورسالة خطأ مع إعادة محاولة. كل الرسوم والجداول تستجيب للفلاتر؛ لا تبقى أجزاء ثابتة تحت أرقام متغيرة.

الواجهة عربية RTL أولًا، مع تهيئة i18n للإنجليزية. الرسوم لا تعتمد اللون وحده، وتدعم reduced motion ولوحة المفاتيح. لا يظهر للمستخدم مصطلح continuation token أو stack trace.

## 12. الاشتراكات وحدود الاستخدام

يبدأ pilot بخطة يفعّلها المشغّل يدويًا. الخطة تحمل limits للقنوات والأعضاء والتعليقات الجديدة المحللة شهريًا ودورية المزامنة. تُحدد الأرقام بعد حصر حجم قناة التجربة، ولا تفترض هذه الوثيقة أسعار بيع جاهزة.

الاحتساب المقترح: وحدة واحدة لأول تحليل ناجح لتعليق فريد في workspace. retries، وتحديث الإعجابات، والتصحيح اليدوي، وإعادة الاستيراد نفسها لا تُحسب مرة ثانية. إعادة تحليل بسبب ترقية النموذج عمل داخلي منفصل عن الفاتورة. historical_backfill له ميزانية مستقلة واضحة في pilot.

قبل إدراج batch جديدة يحجز الخادم عدد الوحدات الممكنة في معاملة. يسجل النجاح ويحرر الباقي عند الفشل. يُمنع تجاوز الحد عبر طلبات متزامنة. فترة الاشتراك UTC معلنة؛ لا تتغير بتغيير المنطقة الزمنية. payment_provider=null في pilot، ويمنع استخدام وضع mock billing خارج بيئة الاختبار.

## 13. استيراد البيانات السابقة

تقرأ الملفات المرفقة محليًا، وتوثق mapping الأعمدة قبل كتابة importer. تحفظ legacy_sentiment وlegacy_theme ومصدر التصنيف دون تقديمهما كتنبؤات جديدة. ملف تعديلات التصنيف يطبق بمعرّف التعليق وعلى النص المطابق، ويعامل كمراجعة موروثة غير موثقة إلى أن يؤكد أصلها.

التواريخ السابقة قد تختلف في وجود الثواني؛ يقبل parser الصيغتين ولا يسقط الصف بصمت. المنطقة الزمنية الأصلية غير مؤكدة؛ يجب تسجيل assumption معلن أو إبقاء التاريخ المحلي الخام، وعدم ادعاء UTC دقيق. رفض الصفوف ينتج تقريرًا بأرقام الصفوف والسبب. إعادة رفع نفس file_hash تعيد نتيجة الاستيراد السابق أو تقدم خيار إعادة معالجة صريحًا.

## 14. ترتيب التنفيذ ومعايير القبول

| المرحلة | الناتج القابل للمراجعة | معيار الخروج |
|---|---|---|
| M0 — تهيئة | monorepo، lockfiles، .env.example، CI، تعليمات التشغيل | build وlint وفحص الأسرار ينجح؛ لا خدمات مدفوعة منشأة تلقائيًا |
| M1 — البيانات المبكرة | كتالوج القناة، adapter معدل، raw files، manifest | إثبات هوية القناة، حفظ نتائج التبويبات الثلاثة، استئناف بعد انقطاع دون تكرار؛ إعلان partial بدقة |
| M2 — أساس SaaS | Auth، workspaces، clients، SQL migrations، RLS | مستخدم مساحة A لا يقرأ أو يغير أو يصدر بيانات B حتى بطلب مباشر |
| M3 — الاستيراد والتحليل | importer، worker، registry، prediction pipeline | إعادة تنفيذ الدفعة لا تضاعف الصفوف/الاستخدام؛ Mixed محفوظة؛ الأخطاء لا تصبح Neutral |
| M4 — لوحة حية | فلاتر موحدة ورسوم وجدول وتصحيح وتصدير | الأرقام تتطابق مع fixture مستقل؛ لا استجابة قديمة بعد تغيير الفلاتر |
| M5 — OAuth | الربط من حساب المستخدم والتوفيق مع pilot | state مزور/منتهي/معاد الاستخدام يفشل؛ قناة أخرى لا تستولي على البيانات؛ التوكنات مخفية |
| M6 — تشغيل pilot | خطة استخدام، تحديث مجدول، سجلات، نشر الواجهة | تجربة صاحب القناة من التسجيل إلى مشاهدة البيانات؛ إثبات refresh token حي عند توفر الاعتماديات |

M1 وM2 يمكن تطويرهما بشكل مستقل؛ لا ينتظر جمع الكتالوج انتهاء SaaS. OAuth تصميم أساسي من اليوم الأول، واختباره الحي لا يحجب بقية التنفيذ. لا تُحذف M5 لتسريع الإصدار النهائي الذي وعدنا به المستخدم.

### اختبارات عالية القيمة

- عاملان يتنافسان على المهمة نفسها؛ لا تُحجز مرتين. العامل ذو lease قديم يفشل في كتابة دفعة.
- خطأ 403/429 وفشل JSON وانقطاع بعد دفعة ناجحة؛ لا يتحول الجلب إلى completed.
- optional paid يظهر في سجل لاحق؛ JSONL/CSV صالحان بأعمدة ثابتة.
- تغير نص تعليق مع بقاء ID؛ يحتفظ بالسجل الأصلي المناسب وتصبح prediction السابقة غير فعالة. تغير likes وحده لا يعيد التحليل.
- استيراد comment_id واحد مرتين ثم من مصدر آخر؛ لا ازدواج، ومصدر الحقول محفوظ.
- تعليقات لها تاريخ null أو نسبي، ورد بلا parent متاح؛ لا إسقاط صامت.
- أربعة labels ومتروكات skipped؛ مقام المشاعر صحيح.
- OAuth رفض/فقد state/قناة غير مطابقة/reconnect؛ حالات واضحة دون تسريب.
- حدود خطة عند طلبين متزامنين وإعادة إرسال Idempotency-Key.
- ملفات تصدير خاصة، وCSV يحيّد formula injection عند الفتح في برامج الجداول دون تعديل النص الخام المخزن.

## 15. هيكل المستودع وتعليمات الوكيل

```text
apps/web/
supabase/migrations/
supabase/functions/
workers/python/src/collectors/
workers/python/src/sentiment/
workers/python/src/imports/
workers/python/tests/
packages/contracts/
docs/SpecTech.md
docs/decisions.md
docs/verification.md
AGENTS.md
CLAUDE.md
.env.example
```

ضع قواعد المشروع الأساسية في AGENTS.md، واجعل CLAUDE.md يشير إليه وإلى المواصفة لتجنب تعليمات متعارضة. لا تتضمن ملفات التعليمات كلمات مرور أو مفاتيح أو بيانات خاصة للمعلقين.

### نص بدء العمل لـCodex أو Claude Code

> اقرأ docs/SpecTech.md كاملة ثم افحص المستودع والملفات المرجعية المتاحة. طبّق المواصفة كمنتج متعدد المستخدمين، وابدأ بـM0 ثم M1/M2. نفذ تغييرًا واحدًا مترابطًا في كل دفعة مع معايير القبول، وسجل ما نفذ فعلًا وما اختبر وما بقي محجوبًا. حافظ على فصل تسجيل الدخول عن OAuth يوتيوب وعلى هوية القناة الثابتة. لا تفترض قدرات خادم لم تُتحقق، ولا تشغل الجمع أو PyTorch في المتصفح أو Edge Functions. لا تعرض بيانات تجريبية على أنها حية، ولا تستخدم تصنيفات القواعد كحقيقة لتقييم الدقة. أكمل كل عمل محلي ممكن قبل طلب أسرار أو حسابات خارجية. عند الحاجة لإعداد خارجي، اعرض اسم المتغير ومكان ضبطه، ولا تطلب لصق السر في المحادثة. ابدأ بجمع قابل للاستئناف وتقرير تغطية، ثم نفذ استيراده دون تكرار. لا تنشئ خدمات مدفوعة أو تنشر على نطاق فعلي دون تفويض. وثّق أي انحراف عن المواصفة وسببه قبل تثبيته في القرارات.

## 16. ما يحتاج إعدادًا عند التنفيذ

لا تمنع البنود التالية بدء البرمجة أو حصر القناة: نطاق التطبيق وSSL ومسار النشر في الاستضافة المشتركة، مشروع Supabase، مشروع Google Cloud وOAuth client، اختيار جهاز العامل، SMTP لتسليم رسائل الحساب بشكل موثوق، وحساب صاحب القناة لاختبار الربط الحي. لا توجد هذه الاعتماديات في الملفات المرفقة، ولا يدّعي الوكيل أنه فعّلها.

يؤجل تحديد مزوّد الدفع والاشتراك السحابي المدفوع إلى قياس pilot. لا يؤجل عزل البيانات أو حماية الأسرار أو صحة الأرقام؛ فهي متطلبات تنفيذ أساسية.

## 17. المصادر والمرجعيات

مصادر فنية اطلع عليها في إعداد المواصفة؛ الأسعار والحدود تتحقق عند النشر. تفاصيل المنتج وخطته توصيات هندسية وليست خصائص تعِد بها الخدمات الخارجية.

- OAuth server-side: https://developers.google.com/youtube/v3/guides/auth/server-side-web-apps
- Channels ومطابقة الهوية: https://developers.google.com/youtube/v3/docs/channels/list
- التعليقات والردود: https://developers.google.com/youtube/v3/docs/commentThreads
- حصر الفيديوهات: https://github.com/yt-dlp/yt-dlp
- مشروع التعليقات: https://github.com/egbertbouman/youtube-comment-downloader/tree/9771beeb5be3c9648af011fe10cd813187550db0
- AraBERT config: https://huggingface.co/PRAli22/AraBert-Arabic-Sentiment-Analysis/blob/main/config.json
- MARBERT config: https://huggingface.co/RafatMohammed/arabic-sentiment-marbertv2/blob/main/config.json
- تجهيز AraBERT Twitter: https://huggingface.co/aubmindlab/bert-base-arabertv02-twitter
- Supabase RLS: https://supabase.com/docs/guides/database/postgres/row-level-security
- Supabase Edge limits: https://supabase.com/docs/guides/functions/limits
- Supabase pricing: https://supabase.com/pricing
- YouTube public requests / credentials: https://developers.google.com/youtube/v3/getting-started
- CAMeLBERT-DA sentiment: https://huggingface.co/CAMeL-Lab/bert-base-arabic-camelbert-da-sentiment
- CAMeLBERT-Mix sentiment: https://huggingface.co/CAMeL-Lab/bert-base-arabic-camelbert-mix-sentiment
- CAMeLBERT training code: https://github.com/CAMeL-Lab/CAMeLBERT
- Supabase changelog: https://supabase.com/changelog

## 18. حالة التحقق الفعلي عند تسليم هذه النسخة

| العمل | النتيجة الفعلية |
|---|---|
| فتح صفحة القناة العامة | نجح؛ طابق الاسم والمعرّف المثبت |
| حصر Videos | 35 معرّفًا عبر yt-dlp |
| حصر Shorts | 157 معرّفًا عبر yt-dlp |
| حصر Streams | معرّفان عبر yt-dlp |
| الدمج عبر التبويبات | 194 معرّفًا فريدًا؛ لا تكرار بينها في حصيلة هذه الدورة |
| تجربة التعليقات | جلب 30 تعليقًا من DGA2hlrwB8g بحد تجريبي صريح |
| تشغيل التحليل على التعليقات الجديدة | لم ينفذ؛ لا توجد labels جديدة أو مقارنة دقة بشرية |
| جمع كامل التعليقات | لم ينفذ بعد؛ العينة ليست نسخة كاملة من القناة |
| Supabase / OAuth / النشر | مواصفات وخطة؛ لم تنشأ الخدمة ولم يُربط حساب صاحب القناة |

الحصر لقطة لما أعاده المصدر وقت التجربة، ولا يثبت عدم وجود محتوى آخر غير متاح في هذه التبويبات. عناوين بعض النتائج أعادها المصدر مترجمة؛ تحفظ metadata_language وtitle_source، وتُطلب العربية عند إثراء البيانات دون الكتابة فوق العنوان السابق بوصفه خطأ.

واجه مسار التشغيل الأول مشكلة في مخزن شهادات certifi، وحُلّت باستخدام مخزن شهادات النظام مع إبقاء التحقق من TLS مفعّلًا. واجه extract_info مهلات عند طلب معلومات صيغ وسائط، ثم نجح اختبار التعليقات؛ المسار المتخصص للتعليقات نجح أيضًا دون استخراج صيغ الفيديو. هذه أسباب اختيار adapter يفصل الحصر والتعليقات عن تنزيل الوسائط.

ملف الحزمة المصاحب يتضمن كتالوج JSONL، manifest، وعينة التعليقات مع وصف نطاقها. يبدأ وكيل التنفيذ من M0 ثم يجعل جمع باقي التعليقات مهمة M1 قابلة للاستئناف؛ لا يعيد حصر القناة من الصفر لمجرد غياب OAuth، لكنه يجري تحديث اكتشاف عند بدء دورة جديدة.

