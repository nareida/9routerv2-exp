# Changelog

All notable custom changes in this public snapshot are recorded here. Format follows Keep a Changelog; versioning remains tied to upstream 9Router releases.

## [Unreleased] - 2026-09-24

### Added

- Upstream context-window resolver in `backend/src/lib/db/services/upstreamContext.js`.
  - Reads OpenRouter, Groq, and active custom OpenAI-compatible provider catalogs.
  - Supports common metadata names such as `context_length`, `context_window`, `contextLength`, `contextWindow`, `max_model_len`, and `max_context_length`.
  - Stores provider catalogs in the SQLite `kv` table with a 24-hour TTL and serves stale cache when refresh fails.
- `/v1/models` context metadata.
  - Adds provider-derived `context_length` to LLM model entries.
  - Adds maximum known member window to combo entries.
  - Omits the field when the provider does not publish a valid value; no hardcoded fallback is used.
- Soul mode for custom OpenAI-compatible connections.
  - Moves client system messages into the first user message as an identity override when `providerSpecificData.soulMode` is `true`.
  - Propagates `soulMode` from provider nodes to newly created connections.
- This changelog and a detailed custom-changes section in `README.md`.

### Changed

- Serves the compiled frontend from `/opt/data/9router-dist` directly from the backend.
- Adds an SPA fallback for extensionless frontend routes while unknown API routes keep returning JSON 404 responses.
- Restricts the authentication middleware to `/api`, `/v1`, and `/v1beta` paths so static frontend routes remain reachable.
- Uses hard abort timeouts in provider validation requests.
- Renames shadowed upstream `Response` variables to `probeRes` so the Express `res.json()` remains callable.
- Replaces runtime `@/...` imports in affected Open-SSE/backend JavaScript modules with relative ESM paths compatible with direct `tsx` execution.
- Adds ignore rules for browser profiles, credential files, key material, and session-state exports.

### Fixed

- Fixes provider validation requests that could previously hang indefinitely.
- Fixes Open-SSE imports that failed under `tsx` because runtime JavaScript did not resolve the TypeScript path alias consistently.
- Fixes frontend client-side routes returning API-style 404 responses.
- Fixes a wrong relative import in `backend/open-sse/handlers/ttsProviders/index.js` (`../src/...` → `../../src/...`).
- Improves theme module import paths; the affected backend/shared files still require a separate path audit and are not claimed as fixed.
- Keeps the model import route response shape unchanged while removing stray whitespace-only edits.

### Verification

- Live `GET /v1/models` returned verified provider context metadata, including combo context and upstream values such as 1,000,000, 262,144, and 131,072 where published.
- Live `POST /v1/chat/completions` completed successfully through `Tes-Combo`.
- `git diff --check` passes.
- The full backend TypeScript check still fails with pre-existing baseline errors in the upstream snapshot; no clean full-build claim is made.

### Security and Privacy

- This repository is public.
- The backup uses a fresh sanitized snapshot instead of importing upstream Git history because the old history contains browser profile data that may include cookies and session state.
- The snapshot excludes `.env`, runtime databases, browser profiles, cookies, session state, local key material, and Boss's runtime credentials.
- Upstream OAuth client credentials (Gemini CLI, iFlow, Antigravity) are retained by owner decision; they are upstream application credentials, not runtime user credentials.
