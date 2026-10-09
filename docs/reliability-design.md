# Reliable research and resumable history

## Goal
Keep Promptwell's rough request → research → clarification → compiled prompt workflow,
while making failure boundaries explicit and preserving progress across navigation and reloads.
This implements the delegated repository upgrade without changing authentication providers,
deploying the app, or introducing a new backend dependency.

## Observed baseline
- The 480-line research route mixes configuration, request parsing, provider schema,
  prompt assembly, throttling, and response handling. Network errors escape the handler.
- Monthly allowance is checked before fetch but committed afterwards; concurrent requests
  can all pass the check. Rate limit entries are never evicted.
- API session validation accepts unvalidated nested arrays; provider validation silently
  drops malformed entries. Iteration input is unbounded and trusted by the server.
- Saved history omits research round and question cursor. Reloading can reset the round
  budget, and skipped questions cannot be resumed accurately.
- Autosave requests overlap and failures offer no retry. An in-flight response can replace
  a newly opened prompt. The compiler ignores includeToolPlan, and research ignores
  researchByDefault. Exported citations omit URLs when a practice is present.
- Five compiler tests exist; no CI workflow is committed.

## Design
1. Extract shared, dependency-free request/result/session parsers. Reject invalid nested
   data, duplicate IDs, unsupported URLs, oversized input and impossible round values.
   Read request bodies with a byte ceiling, even without Content-Length. Research input is capped at 256 KB, history at 2 MB, and profile writes at 32 KB.
2. Separate research orchestration from Next/WorkOS and prompt/schema construction.
   Inject profile loading, fetch and admission control into a Web Request/Response handler
   for deterministic route tests. Catch network, timeout and malformed provider responses.
3. Replace the check-then-commit counter with synchronous per-process reservations.
   Count requests before fetch and release failed attempts; finalize only validated
   successful output. Preserve the existing successful-response accounting policy.
   Return Retry-After for rate/allowance limits and bound stale limiter memory. This is a
   documented single-process backstop, not a durable or monetary cap; a distributed
   PostgreSQL ledger would be a separate migration with crash recovery semantics.
4. Add backward-compatible history fields qualityRound and questionIndex. Additive SQL
   migration defaults legacy sessions conservatively to the maximum research round so
   old history cannot silently obtain a fresh budget. Store cursor and round atomically
   with the session, serialize browser saves, allow retry, and wait for pending saves
   before deletion. Cross-device conflict resolution remains last completed write wins.
5. Abort research on reset/open/unmount and ignore stale completions. Preserve answers
   before starting follow-up research; allow cancellation, manual completion and export.
6. Honor researchByDefault (no web tool or source requirement when false) and
   includeToolPlan. Keep citations with URL and practice, and don't count blank or
   duplicate answers as extra decisions in the quality heuristic.

## Verification
- Establish npm test, lint, typecheck and build baseline.
- Add native node:test regression coverage for parsers, quota concurrency, orchestration,
  configuration, compiler settings, progress defaults and ordered save failures.
- Add real PostgreSQL integration coverage for migration, ownership isolation and history
  round/cursor persistence; use TEST_DATABASE_URL for a disposable test database.
- Add CI for Node 24, PostgreSQL, full tests/lint/typecheck/build and a signed-out HTTP smoke.
- Run final checks locally with available runtime; clearly distinguish unavailable live
  WorkOS/OpenAI and PostgreSQL checks from passes. Verify pushed SHA and exact-commit CI.

## Compatibility and limits
No new runtime dependencies. Apply db/schema.sql before running the new app. Old browser
clients may omit progress; updates preserve existing round/cursor in that case. Sources
must be HTTPS without credentials. Session payloads remain owner-scoped. The score is a
local heuristic, not an evaluation of downstream model quality. The server validates a
claimed round but does not prove session lineage: direct API clients remain bounded by
rate/allowance controls, not an authenticated per-session research ledger.
