# Promptwell

**Make the prompt hold water.** Promptwell turns a rough request into a specific,
researched, and testable prompt. It remembers your working environment, asks for
missing decisions, and compiles the answers into a prompt you can copy or download
for your preferred coding agent or assistant.

Promptwell is a Next.js application with WorkOS authentication, PostgreSQL account
storage, and a server-side OpenAI Responses API research engine. It writes prompts;
it does not execute the generated instructions or connect to your declared tools.

## What it does

1. **Remember your environment.** First-sign-in onboarding saves platforms, available
   tools, instruction-file formats, and durable preferences. A workspace can override
   the account defaults; an empty override inherits its account setting.
2. **Research a request.** Submit 12–12,000 characters. The server combines the rough
   request, your profile, and the bundled prompting guide. Web research is enabled by
   default and can be disabled in Settings; generation still uses OpenAI when it is off.
3. **Clarify what matters.** Answer or skip adaptive questions. Answers are limited to
   4,000 characters each. The compiler updates its five-dimensional score locally.
4. **Stop with a usable result.** The interview finishes at an average score of 85 or
   after four successful research rounds, including the initial round. **Use current
   prompt** lets you finish earlier. A result below the gate remains visibly marked.
5. **Resume and export.** History stores answers, sources, the brief, compiled output,
   research round, and question cursor. Reopen an entry to continue, review saved
   answers, copy the prompt, or download Markdown with source URLs and their findings.

Research can be cancelled. Opening another entry or starting a new prompt aborts the
old request and ignores late responses. Answers are saved before follow-up research.
Autosaves are ordered per session; failed saves retain their latest snapshot in memory
and expose **Retry sync**. The page warns before leaving with unsynced snapshots.

## Local setup

Prerequisites:

- Node.js **24 or later** and npm (CI uses Node 24).
- PostgreSQL **16 or later**, with permission to create the `promptwell` schema.
- A WorkOS AuthKit application and an OpenAI API project with access to `gpt-5.4-mini`.

```sh
git clone https://github.com/desenyon/promptwell.git
cd promptwell
npm ci
cp .env.example .env.local
```

Fill in `.env.local` using the configuration table below. Keep it out of source
control. Generate a random WorkOS cookie password of at least 32 characters, for
example with `openssl rand -base64 32`. Add
`http://localhost:3000/auth/callback` to the WorkOS redirect allowlist.

Apply the database schema before starting the app. `psql` does not load `.env.local`;
export the same connection string into your shell first:

```sh
export DATABASE_URL='postgres://USER:PASSWORD@HOST:5432/DATABASE'
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -1 -f db/schema.sql
npm run dev
```

Open `http://localhost:3000`, sign in, complete onboarding, and research a prompt.
Use a project-specific API key. Never put the OpenAI key or database credentials in
`NEXT_PUBLIC_*` variables. For hosted PostgreSQL, use the TLS connection string from
your provider; the app does not disable certificate validation.

Production builds do not need live provider credentials:

```sh
npm run build
npm start
```

Runtime requests do need the configured authentication and database services. The
research route targets the Node.js runtime and exports a 150-second maximum duration;
your hosting plan must permit enough time for the configured provider deadline plus
profile loading. Configure the production callback URL in both WorkOS and the app.
This repository's CI verifies changes; it does not deploy them.

## Configuration

OpenAI settings are read on the server for each research request. Missing optional
settings use the defaults below. Numeric settings must be whole decimal integers;
partial values such as `10seconds`, fractions, zero, and out-of-range values fail closed.

| Variable | Default / required | Meaning |
| --- | --- | --- |
| `DATABASE_URL` | Required at runtime | PostgreSQL connection string; up to 3 pooled connections per process |
| `WORKOS_CLIENT_ID` | Required at runtime | AuthKit application client ID |
| `WORKOS_API_KEY` | Required at runtime | Server-side WorkOS API key |
| `WORKOS_COOKIE_PASSWORD` | Required at runtime | Random cookie encryption secret, at least 32 characters |
| `NEXT_PUBLIC_WORKOS_REDIRECT_URI` | `http://localhost:3000/auth/callback` in the example | Exact allowlisted callback URL |
| `OPENAI_API_KEY` | Required for research | Server-side OpenAI project key |
| `OPENAI_MODEL` | `gpt-5.4-mini` | Currently the only accepted model; changing support requires code/tests |
| `OPENAI_REASONING_EFFORT` | `low` | `low`, `medium`, or `high` |
| `OPENAI_MONTHLY_REQUEST_CAP` | `250` | 1–1,000,000 successful research responses per process per UTC month |
| `PROMPT_MAX_CHARACTERS` | `12000` | Server prompt limit, 12–12,000; browser still displays the fixed 12,000 maximum |
| `PROMPT_MAX_OUTPUT_TOKENS` | `6000` | Provider output budget, 1–16,000; too small a budget may produce incomplete output |
| `PROMPT_RATE_LIMIT_REQUESTS` | `10` | Research attempts per user per window, 1–10,000 |
| `PROMPT_RATE_LIMIT_WINDOW_MS` | `600000` | Window length, 1–86,400,000 milliseconds |
| `PROMPT_REQUEST_TIMEOUT_MS` | `60000` | Provider fetch and response-body deadline, 1,000–120,000 milliseconds |
| `TEST_DATABASE_URL` | Required only for `test:db` | Disposable test database; never a production database |
| `PW_BROWSER_CHANNEL` | Unset | Optional installed browser channel, e.g. `chrome`, for local browser tests |

Settings stored in PostgreSQL also affect behavior:

- **Depth:** focused requests 4–5 initial questions, thorough 5–7, exhaustive 6–8;
  follow-ups request 3–5 new questions.
- **Research current practices:** disabled means no web tool is supplied and no generated
  citations are accepted. Practices without sources are labeled not externally verified.
- **Include a conditional tool plan:** disabled removes that section and routing library
  from the compiled prompt; the brief can still inform the score and interview.
- **Ask only missing decisions:** directs the model to use remembered context.
- **Durable preference:** up to 2,000 characters; applied subject to higher-priority rules.

## Architecture

```mermaid
flowchart LR
  UI[React workspace and history] --> AUTH[Next routes + WorkOS session]
  AUTH --> DB[(PostgreSQL profiles / workspaces / sessions)]
  AUTH --> VALIDATE[Bounded JSON and shared validation]
  VALIDATE --> SERVICE[Research orchestration]
  SERVICE --> LIMITS[Per-process rate and allowance reservations]
  SERVICE --> API[OpenAI Responses + optional web search]
  API --> RESULT[Validated questions / brief / sources]
  RESULT --> UI
  UI --> ENGINE[Local score and prompt compiler]
  UI --> QUEUE[Ordered saves + retry]
  QUEUE --> AUTH
  ENGINE --> EXPORT[Clipboard / Markdown]
```

| Area | Responsibility |
| --- | --- |
| `src/App.tsx` | Onboarding handoff, interview state, cancellation, history, sync status, export |
| `src/components/` | Onboarding, settings/history, research loading animation |
| `src/account.ts`, `src/provider.ts` | Browser API adapters; provider responses use the shared parser |
| `src/sessionState.ts` | Legacy progress defaults, ordered session writes, deduplicated research merge |
| `src/promptEngine.ts` | Pure heuristic scoring and prompt compilation; source URLs remain in exports |
| `src/app/api/refine/route.ts` | Authenticated Next adapter and process-level limiter instance |
| `src/lib/research/config.ts` | Strict server configuration |
| `src/lib/research/request.ts` | Provider prompt and structured-output schema construction |
| `src/lib/research/service.ts` | Testable orchestration, deadline, cancellation, safe error responses |
| `src/lib/research/limits.ts` | Atomic allowance reservations and expiring per-user rate limits |
| `src/lib/validation.ts`, `src/lib/http.ts` | Bounded JSON reader, nested data contracts, error envelopes |
| `src/lib/db.ts`, `db/schema.sql` | Owner-scoped SQL and additive, idempotent schema setup/migration |
| `src/lib/masterGuide.ts` | Bundled specification and prompting guide |
| `src/proxy.ts`, `src/app/auth/` | AuthKit middleware, login, callback, sign-out |

The research service takes injected provider, profile, and limiter dependencies. Tests
exercise its real request/response logic without paid API calls or an authentication
bypass. Browser tests bundle the actual `App` into a standalone fixture outside Next's
route tree and mock HTTP boundaries. Production authentication is tested separately.

### Persistence and API contracts

All API operations require a WorkOS session. There is currently one default workspace
per user (`<WorkOS user ID>:default`), despite the schema allowing future workspaces.

| Endpoint | Behavior |
| --- | --- |
| `GET /api/profile` | Load/create the authenticated user's profile and workspace |
| `PUT /api/profile` | Validate and save `{ profile }`; workspace ID is bound to the user |
| `GET /api/sessions` | Latest 100 sessions; optional `workspaceId` must be the user's default |
| `PUT /api/sessions` | Validate and upsert `{ session }` in an owned workspace |
| `DELETE /api/sessions?id=…` | Delete an owned session; 204 on success, 404 if absent |
| `POST /api/refine` | Initial `{ prompt }` or follow-up `{ prompt, mode: "iterate", iteration }` |

See `src/provider.ts` for the iteration payload and `src/types.ts` for browser types.
Runtime validation checks nested questions, answers, practices, source URLs, unique IDs,
reference integrity, lengths, stages, and progress. Research input is capped at 256,000
bytes, provider output at 512,000 bytes, session writes at 2,000,000 bytes, and profile
writes at 32,000 bytes, including chunked bodies without a Content-Length header.
Source links must be HTTPS and cannot contain URL credentials.

Session timestamps are assigned by PostgreSQL. The round count cannot decrease on an
update; older clients that omit progress preserve the stored round and cursor. Browser account requests have a 30-second deadline so a stalled save cannot
block later queued progress forever. Saves
are serialized within a browser and deletion waits for pending writes. PostgreSQL
mutations still use last-completed-write behavior across separate tabs/devices; there
is no cross-device conflict merge or immutable version history.

Research errors use `{ error, code }`: 400 invalid input, 401 signed out, 409 onboarding
required, 413 body too large, 429 rate/allowance limit, 499 client cancellation, 502
provider/network/invalid output, 503 unavailable configuration/profile/limiter capacity,
and 504 provider timeout. Throttling responses include `Retry-After`. Research responses
are `no-store`; provider response bodies and secrets are not logged.

An application-first deployment with the old session schema returns **503
`SCHEMA_MIGRATION_REQUIRED`**. Before profile/session operations, the server checks
schema metadata for both required progress columns. While either is absent, account
loading/onboarding, history, saves, deletes, and research pause with a database-update
message. Research never calls OpenAI in this state and releases its allowance
reservation. Existing rows remain unchanged; no runtime DDL or legacy write fallback
silently discards progress. The check is not cached, so retrying after the migration
resumes service without a process restart. Authentication still runs first.

## Reliability and spending boundaries

Allowance is **reserved synchronously before** the provider call, so concurrent calls
in one process cannot all claim the final slot. Validated successful output commits the
reservation; failures, incomplete output, cancellation, and timeout release it. Tokens
from a previous UTC month settle against that month's counter. Expired per-user entries
are removed; the limiter refuses new users at 10,000 active entries instead of growing
without bound. Follow-up requests validate rounds 2–4.

These controls are **not a dollar budget or distributed ledger**. They reset on restart,
are independent across replicas, and count successful responses rather than provider
billing events. A timed-out or cancelled request may still incur provider charges.
There is no automatic provider retry. A direct API client can claim a valid round;
round validation does not establish server-owned session lineage. Rate and allowance
limits remain the server's backstops.

Configure and verify the provider spend controls appropriate to your project. Do not
assume a budget alert blocks traffic: OpenAI distinguishes alerts from configured hard
spend limits in its [usage and spend-limit documentation](https://help.openai.com/en/articles/6614457-troubleshooting-api-usage-and-spend-limits).
`OPENAI_MONTHLY_BUDGET_USD` was never enforced by this app and has been removed from the
example configuration. No dollar-per-request or benchmark claim is made here.

Requests use `store: false` for Responses storage. This is not a claim of zero retention;
provider data policies and account settings still apply. The rough request, profile,
and answered decisions are sent to OpenAI; optional web research also involves search.
Declared Graphify, Context7, Headroom, MCP, skills, hooks, and instruction files guide
the generated prompt only—Promptwell itself does not run those tools.

## Upgrading an existing installation

1. Back up the database and verify the target connection string.
2. Apply `db/schema.sql` with `ON_ERROR_STOP=1` in a transaction, as shown above, **before**
   running the updated app. `CREATE … IF NOT EXISTS` and additive column migrations
   make repeated application safe.
   If code deploys first, the app deliberately stays unavailable with the explicit
   database-update message until these columns exist. This is a safe stop, not a
   zero-downtime migration or proof that the production schema has been updated.
3. The migration adds `quality_round`, `question_index`, and a workspace/history index.
   Existing rows default to round **4**, because historical round usage was not stored.
   This preserves their prompts without granting extra research calls. Old cursor
   information cannot be reconstructed; migrated rows start at question zero.
4. Run `npm ci`, build, and restart with the updated configuration. The new timeout has
   a default, so no environment change is required for an existing deployment.
5. Check sign-in, opening historical prompts, saving an answer, and retrying a failed
   save. Keep the database backup until those checks succeed.

The migration does not delete or rewrite prompts. Rolling the application back can
leave the new columns and index in place; older code ignores them. Rolling back loses
new progress/cancellation behavior. Do not drop columns as part of an application rollback.

## Verification and development

```sh
npm test                  # native node:test regression suite, no credentials
npm run lint              # source and test lint
npm run typecheck         # application and test TypeScript
npm run build             # production Next.js build
npm run test:smoke        # temporary production server; anonymous auth boundaries

npx playwright install chromium
npm run test:browser       # actual React UI with mocked HTTP boundaries, one worker

export TEST_DATABASE_URL='postgres://USER:PASSWORD@localhost:5432/promptwell_test'
npm run test:db            # real PostgreSQL migration / ownership / progress tests
```

`test:db` requires a **fresh disposable** database with no `promptwell` tables. It
checks old/partial-schema safe stops, recovery after migration, ownership, and progress,
then cleans its generated users. It refuses an existing schema instead of dropping
tables; create a new disposable database for another run. It fails clearly when the
connection variable is absent.
`test:smoke` requires a completed build, uses fake test credentials, binds port 4178 on
loopback, checks all six anonymous API operations, and stops its server afterward.
The browser harness binds port 4177 and never serves a production authentication bypass.
If Chromium is not installed, an installed Chrome can be used with
`PW_BROWSER_CHANNEL=chrome npm run test:browser`.

[CI](.github/workflows/ci.yml) runs all of the above on Node 24, PostgreSQL 16, and
Chromium for pushes and pull requests, without live WorkOS/OpenAI secrets. Failure
traces are uploaded for browser tests. Before shipping an environment change, also
check a real WorkOS sign-in/callback and a paid OpenAI research request using that
environment's credentials; mocked tests cannot prove those integrations are configured.

## Known limitations and troubleshooting

- The 85-point score is a deterministic heuristic over words, decisions, and the brief.
  It is not an independent model evaluation or a guarantee of output quality. Blank
  answers and duplicate question IDs no longer earn extra answer-count credit.
- Research sources are model-selected HTTPS references, not independently fetched or
  fact-checked by the app. Source instructions are treated as untrusted data, but prompt
  delimiters alone are not a security sandbox.
- History loads the most recent 100 prompts; search covers that loaded set. There is
  no pagination, team sharing, multi-workspace UI, cost ledger, or prompt-version ledger.
- Raw drafts and text that has not been submitted as an answer are not autosaved.
  Unsynced snapshots survive in-app navigation, not closing/reloading the page. Use
  Retry sync or export before leaving; unload warnings are browser-dependent.
- A missing database/schema gives a profile/history availability error. Confirm the
  connection and migration before troubleshooting OpenAI.
- `SCHEMA_MIGRATION_REQUIRED` means the operator must apply `db/schema.sql` to the
  configured database after the usual backup and approval. The app will not run the
  migration, spend OpenAI allowance, or write incomplete session records on your behalf.
- A research 503 can mean invalid configuration. Check the table above without printing
  secret values. A 502 can mean upstream failure, refusal, truncation, or invalid output;
  try again or use the best available prompt. A 504 preserves already submitted answers.
- If saves fail after an upgrade, apply the schema first. New writes deliberately reject
  malformed nested data that older code may have accepted; historical rows are not
  bulk-sanitized by the migration.
- Missing browser binaries: run `npx playwright install chromium`. Build root warnings
  in nested checkouts are avoided by explicitly scoping Turbopack to the project directory.

See [the reliability design](docs/reliability-design.md) for the observed baseline,
implementation decisions, and intentionally deferred distributed-state work.
