# Promptwell

Promptwell researches a rough request, applies the bundled prompting guide and saved user profile, asks only unresolved clarification questions, and compiles the answers into an execution-ready prompt.

## Product behavior

- First-sign-in onboarding records the user’s platforms, available tools, and instruction-file formats.
- Account defaults and per-workspace overrides are stored in PostgreSQL and applied by the server-side research engine.
- Prompt history is synced to the authenticated account rather than browser storage.
- Research produces an adaptive question set, source trail, tool plan, and verification plan.
- Generated prompts route Graphify, Context7, Headroom, web search, MCP, skills, and instruction files only when relevant and available.

## Local setup

1. Copy `.env.example` to `.env.local`.
2. Add the WorkOS credentials and redirect URI.
3. Add a PostgreSQL connection string in `DATABASE_URL`, then apply `db/schema.sql`.
4. Add a newly created `OPENAI_API_KEY`. Do not reuse a key that has appeared in chat, logs, or source control.
5. Add `http://localhost:3000/auth/callback` to the WorkOS redirect allowlist.
6. Run `npm install` and `npm run dev`.
7. Optional checks: `npm run lint`, `npm run typecheck`, `npm test`, and `npm run build`.

## Quality gate

Research keeps iterating until the local quality score reaches **85** or the engine hits **4** research rounds. If the gate is still unmet after those rounds, Promptwell stops calling the research API, shows the best compiled prompt, and surfaces a clear score warning so the monthly OpenAI allowance is not burned on open-ended loops.

## Spending controls

Set the OpenAI project’s monthly budget to `$13` in the OpenAI dashboard. That provider-side project budget is the authoritative cap because it still applies across deploys, restarts, and any other use of the key.

`OPENAI_MONTHLY_REQUEST_CAP=250` provides a conservative in-process backstop based on current GPT-5.4-mini and web-search pricing. Only successful provider responses count toward this cap. It resets when a server instance restarts and is not a substitute for the provider-side project budget.

## Security boundaries

- The OpenAI key is read only by the server route and is never included in browser bundles.
- Every generation endpoint requires a valid WorkOS session.
- Profile and session queries are scoped to the authenticated WorkOS user ID.
- Requests are limited per user and globally per running server instance.
- Prompt input is length-limited and fenced as untrusted source material.
- Web content is treated as untrusted data, not executable instructions.

<!-- architecture-atlas-v5:start -->
## Architecture Atlas v5

These editable Mermaid diagrams mirror the [Notion architecture dossier](https://app.notion.com/p/3b467342e8c1818192a9d435ce799772?pvs=204).

### 1. Compilation anatomy

```mermaid
flowchart LR
  USER["User + onboarding profile<br>available platforms and tools"] --> PARSE["Request parser"]
  PARSE --> REQ["Requirement graph<br>objective, constraints, unknowns, risks"]
  REQ --> PLAN["Bounded research-query planner"]
  PLAN --> FENCE["Untrusted-source content fence"]
  FENCE --> SOURCES[("Sources, snippets and provenance")]
  REQ --> QUESTION["Adaptive high-value question generator"]
  SOURCES --> QUESTION
  QUESTION --> ROUND["Clarification-round controller"]
  ROUND --> REQ
  REQ --> COMP["Prompt-section compiler<br>role, context, tools, steps, output contract"]
  SOURCES --> COMP
  COMP --> VERIFY["Tool and verification planner"]
  VERIFY --> QUALITY["Ambiguity, executability and assumption-risk scorer"]
  QUALITY --> LEDGER["Assumption ledger"]
  QUALITY --> VERSION[("Versioned prompts, sources, costs and answers")]
  AUTH["WorkOS auth + user-scoped storage"] -. boundary .-> VERSION
  BUDGET["Hard spend/time/round limiter"] -. controls .-> PLAN
```

### 2. Bounded-clarification wiring

```mermaid
flowchart TB
  RAW["Rough task"] --> EXTRACT["Extract objective, known constraints, missing facts and tool needs"] --> GRAPH["Requirement graph"]
  GRAPH --> RESEARCH{"External facts needed?"}
  RESEARCH -->|yes| RESERVE["Reserve budget and scope"] --> RETRIEVE["Retrieve source-backed evidence"] --> FENCE["Fence instructions inside evidence"] --> GRAPH
  RESEARCH -->|no| UNKNOWN["Rank unresolved constraints by execution impact"]
  GRAPH --> UNKNOWN
  UNKNOWN --> ASK{"High-value unresolved question and round budget left?"}
  ASK -->|yes| ONE["Ask one adaptive clarification round"] --> GRAPH
  ASK -->|no| COMPILE["Compile executable prompt"] --> SCORE["Quality gate"]
  SCORE -->|pass| READY["Deliver editable prompt + assumptions + source trail"]
  SCORE -->|fail and budget remains| ASK
  SCORE -->|budget exhausted| LIMITED["Deliver bounded result with explicit unresolved assumptions"]
```

### 3. Runtime narrative

```mermaid
sequenceDiagram
  actor User
  participant P as Parser / Requirement Graph
  participant R as Research Plane
  participant Q as Question Controller
  participant C as Compiler / Quality Gate
  participant S as Auth / Postgres / Budget Ledger
  User->>P: rough task and available tools
  P->>R: bounded research plan for missing external facts
  R->>S: reserve spend and enforce user scope
  R-->>P: fenced evidence with provenance
  P->>Q: ranked unresolved constraints
  Q-->>User: one high-value adaptive clarification round
  User->>P: answer updates requirement graph
  P->>C: objective, constraints, assumptions, tools and evidence
  C->>C: compile role, steps, verification and output contract
  C->>C: score ambiguity, executability and assumption risk
  C->>S: persist versions, sources, rounds and costs
  C-->>User: editable execution-ready prompt or explicit bounded limitation
```

### 4. Reliability model

```mermaid
stateDiagram-v2
  [*] --> DRAFT
  DRAFT --> PARSED --> RESEARCHING
  RESEARCHING --> QUESTIONING
  QUESTIONING --> PARSED: answer received
  PARSED --> COMPILING --> QUALITY_GATE
  QUALITY_GATE --> READY: threshold met
  QUALITY_GATE --> QUESTIONING: budget remains and uncertainty is material
  QUALITY_GATE --> BUDGET_EXHAUSTED: hard limit reached
  RESEARCHING --> FAILED: source or authorization failure
```

<!-- architecture-atlas-v5:end -->
