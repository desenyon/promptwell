# Promptwell

Promptwell researches a rough request, applies the bundled prompting guide, asks adaptive clarification questions, and compiles the answers into a testable prompt.

## Local setup

1. Copy `.env.example` to `.env.local`.
2. Add the WorkOS credentials and redirect URI.
3. Add a newly created `OPENAI_API_KEY`. Do not reuse a key that has appeared in chat, logs, or source control.
4. Add `http://localhost:3000/auth/callback` to the WorkOS redirect allowlist.
5. Run `npm install` and `npm run dev`.

## Spending controls

Set the OpenAI project’s monthly budget to `$13` in the OpenAI dashboard. That provider-side project budget is the authoritative cap because it still applies across deploys, restarts, and any other use of the key.

`OPENAI_MONTHLY_REQUEST_CAP=250` provides a conservative in-process backstop based on current GPT-5.4-mini and web-search pricing. It resets when a server instance restarts and is not a substitute for the provider-side project budget.

## Security boundaries

- The OpenAI key is read only by the server route and is never included in browser bundles.
- Every generation endpoint requires a valid WorkOS session.
- Requests are limited per user and globally per running server instance.
- Prompt input is length-limited and fenced as untrusted source material.
- Web content is treated as untrusted data, not executable instructions.
