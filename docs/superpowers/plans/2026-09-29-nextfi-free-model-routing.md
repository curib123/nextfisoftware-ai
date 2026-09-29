# Nextfi Software Free Model Routing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the Nextfi Software rename and make the Free plan safely expose all explicitly verified free AI endpoints with best-fit Auto routing while keeping flagship models premium.

**Architecture:** Keep `ai_models.free_endpoint` as the server-side eligibility flag. Extend the existing routing layer to derive Free Auto candidates from the live free-endpoint registry, use the shared Free Auto policy for Free manual selections, and add bounded pre-output failover for Auto. Preserve compatibility identifiers and paid-plan policy rows.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Supabase Postgres migrations, Vitest, ESLint, Prettier.

**Spec:** `docs/superpowers/specs/2026-09-29-nextfi-free-model-routing-design.md`

## Global Constraints

- Free requests must never use a model with `free_endpoint = false`.
- Free Auto and Free manual selections use the shared Free Auto policy for limits and quota.
- Paid-plan manual and Auto access to flagship models remains unchanged.
- NVIDIA models are Free-eligible only after a healthy live chat probe; other providers require explicit admin marking.
- Manual and BYOK requests never switch models automatically.
- Preserve existing cookies, local-storage keys, storage bucket paths, database IDs, and other compatibility identifiers.
- `NEXTFI_CREDENTIAL_ENCRYPTION_KEY` is canonical; `VROMPT_CREDENTIAL_ENCRYPTION_KEY` remains a fallback.
- No new runtime dependency may be added.

## Review Focus

- A premium model must not enter a Free Auto pool even when it has a better quality score — pinned in Task 1 routing tests.
- A Free manual request must work without a per-model Free policy row — pinned in Task 2 entitlement tests.
- A failed Auto candidate must not consume a second quota reservation or duplicate the assistant message — pinned in Task 3 failover tests.
- A candidate that emitted partial output must not fall through to another model — pinned in Task 3 failover tests.
- Editing an existing model without touching the new checkbox must not accidentally mark it Free — pinned in Task 4 admin mutation tests or request-shape tests.

### Task 1: Extend pure model eligibility and Auto candidate selection

**Files:**
- Modify: `apps/web/lib/server/credits.ts`
- Modify: `apps/web/test/auto-routing.test.ts`

**Interfaces:**
- Produces `isFreeEndpointEligible(model: DbModel, feature?: CreditFeature, access?: 'manual' | 'auto'): boolean` for shared server-side checks.
- Produces `chooseAutoModels()` behavior where `policy.routing.freeEndpointPool === true` derives candidates from `model.free_endpoint === true`; bounded `allowedModelIds` behavior remains unchanged.

- [ ] **Step 1: Write failing tests**

Add tests named `free Auto excludes premium models`, `free Auto excludes unhealthy and unconfigured endpoints`, and `free Auto includes marked non-NVIDIA endpoints`. Assert that a high-quality premium model is absent, a degraded/unconfigured model is absent, and a healthy explicitly marked model from another provider is eligible.

- [ ] **Step 2: Run the focused tests and verify RED**

Run: `npm test --workspace @nextfi/web -- auto-routing.test.ts`

Expected: the new tests fail because the routing policy does not understand `freeEndpointPool` and no shared Free eligibility predicate exists.

- [ ] **Step 3: Implement the minimal routing changes**

Add the shared eligibility predicate using `free_endpoint`, enabled/maintenance state, manual or Auto availability, provider configuration, provider health, and requested feature capability. Update `chooseAutoModels` to use the free registry when `freeEndpointPool` is true, while preserving the existing bounded pool path for paid policies.

- [ ] **Step 4: Run the focused tests and verify GREEN**

Run: `npm test --workspace @nextfi/web -- auto-routing.test.ts`

Expected: all Auto routing tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/server/credits.ts apps/web/test/auto-routing.test.ts
git commit -m "feat: route Free Auto across verified endpoints"
```

### Task 2: Add Free manual entitlement resolution

**Files:**
- Modify: `apps/web/lib/server/workspace.ts`
- Modify: `apps/web/lib/server/credits.ts` if the shared predicate needs a small type refinement
- Create: `apps/web/test/free-access.test.ts`

**Interfaces:**
- Consumes `isFreeEndpointEligible` from Task 1.
- Produces Free workspace model metadata with `planAvailable: true` for eligible free endpoints.
- Produces manual request resolution that uses the Free `AUTO` policy for quota/limits and validates the selected model through the shared predicate.

- [ ] **Step 1: Write failing tests**

Add unit-level access tests for `free manual selection accepts a marked endpoint without a model policy` and `free manual selection rejects a premium model`. Exercise the extracted resolution helper or a pure exported resolver with a Free plan, one AUTO policy, one marked free model, and one premium model.

- [ ] **Step 2: Run the focused tests and verify RED**

Run: `npm test --workspace @nextfi/web -- free-access.test.ts`

Expected: the free model is currently rejected because manual mode requires a model-specific policy row, and the premium model is not distinguished by the Free entitlement path.

- [ ] **Step 3: Implement Free manual resolution**

In `streamMessage`, resolve Free manual selections against the shared Free Auto policy, then validate model ID, enabled/manual/health/provider configuration, capability, and `free_endpoint`. Keep paid manual requests on their existing model-specific policies. Update `workspaceModels` to use the Free Auto policy for credit/allowance metadata for eligible Free models while keeping BYOK metadata intact.

- [ ] **Step 4: Run focused and existing tests**

Run: `npm test --workspace @nextfi/web -- free-access.test.ts auto-routing.test.ts`

Expected: the new access tests and existing routing tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/server/workspace.ts apps/web/lib/server/credits.ts apps/web/test/free-access.test.ts
git commit -m "feat: expose verified free endpoints to Free users"
```

### Task 3: Add bounded Auto failover before output

**Files:**
- Modify: `apps/web/lib/server/workspace.ts`
- Modify: `apps/web/lib/server/providers.ts` only if the retry result needs a narrow typed helper
- Modify: `apps/web/test/auto-routing.test.ts` or create `apps/web/test/auto-failover.test.ts`

**Interfaces:**
- Produces an internal candidate-attempt helper with an explicit callback for provider execution and output emission state.
- Consumes `chooseAutoModels` and the policy’s `routing.maxAttempts`/`attemptTimeoutSeconds` values.

- [ ] **Step 1: Write failing failover tests**

Add tests named `Auto tries the next candidate after a pre-output retryable failure`, `Auto stops after partial output`, and `Auto keeps one reservation for all attempts`. Assert candidate order, one reservation/finalization path, and no fallback after a delta has been emitted.

- [ ] **Step 2: Run the focused tests and verify RED**

Run: `npm test --workspace @nextfi/web -- auto-failover.test.ts`

Expected: the current generation flow invokes only the first selected model, so the pre-output fallback test fails.

- [ ] **Step 3: Implement the minimal failover loop**

Have Auto retain the ordered candidate list, cap attempts at the policy setting and five total, emit a model event per attempt, and retry only retryable `ProviderFailure` instances that have emitted no output. Keep manual/BYOK single-model. Reuse the original quota reservation and assistant message; update the assistant model metadata to the successful fallback candidate before completion. Do not retry after cancellation, partial output, generated artifacts, unsupported/non-retryable failures, or validation errors.

- [ ] **Step 4: Run the focused tests and the full unit suite**

Run: `npm test --workspace @nextfi/web -- auto-failover.test.ts auto-routing.test.ts`; then `npm test --workspace @nextfi/web`.

Expected: failover tests pass and the complete Vitest suite exits with zero failures.

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/server/workspace.ts apps/web/lib/server/providers.ts apps/web/test/auto-failover.test.ts apps/web/test/auto-routing.test.ts
git commit -m "feat: fail over Auto before output"
```

### Task 4: Update registry administration and NVIDIA synchronization

**Files:**
- Modify: `apps/web/lib/server/admin.ts`
- Modify: `apps/web/components/admin/configuration.tsx`
- Modify: `apps/web/lib/server/nvidia.ts`
- Create: `apps/web/test/admin-models.test.ts`

**Interfaces:**
- Produces `modelMutationPayload(input: Record<string, unknown>)` for the existing admin model mutation, with `free_endpoint` defaulting to `false` when omitted.
- NVIDIA sync marks healthy discovered chat endpoints as Free and updates the Auto pool summary from all currently eligible free endpoints, without a hard-coded Mistral fallback.

- [ ] **Step 1: Write failing admin/sync tests**

Extract and export the pure `modelMutationPayload` helper from `admin.ts`, then add tests pinning that `freeEndpoint: true` becomes `free_endpoint: true`, omission defaults to `false`, and the NVIDIA pool update does not inject the fixed Mistral UUID.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `npm test --workspace @nextfi/web -- admin-models.test.ts`

Expected: the current admin payload omits `free_endpoint`, and NVIDIA sync still hard-codes the Mistral fallback.

- [ ] **Step 3: Implement registry and sync changes**

Add the checkbox to the existing admin model form and API payload. Remove the fixed Mistral fallback from sync, query/update the current free endpoint set for the policy summary, keep generated Free manual-policy cleanup compatible with existing data, and update NVIDIA descriptions to Nextfi Software.

- [ ] **Step 4: Run focused tests and typecheck**

Run the focused test file and `npm run typecheck --workspace @nextfi/web`.

Expected: focused checks pass and TypeScript reports no errors.

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/server/admin.ts apps/web/components/admin/configuration.tsx apps/web/lib/server/nvidia.ts apps/web/test
git commit -m "feat: manage verified free endpoints"
```

### Task 5: Apply the forward-only Supabase policy migration

**Files:**
- Create: `supabase/migrations/20260929100000_nextfi_free_endpoint_access.sql`

**Interfaces:**
- Produces a database-enforced Free policy rule that accepts only `free_endpoint = true` models.
- Produces a Free AUTO policy with `routing.freeEndpointPool = true` and a current compatibility `allowedModelIds` snapshot.

- [ ] **Step 1: Write the migration assertions before implementation**

Add a migration review checklist in the SQL comments covering trigger replacement, current Free policy update, existing Free manual-policy compatibility, paid policy preservation, and no deletion of model records. If a local SQL test harness exists, add assertions there; otherwise use static SQL review plus application tests from Tasks 1–4.

- [ ] **Step 2: Implement the migration**

Drop/replace the old Free-only trigger with a forward-only free-endpoint validation function and trigger. Set the existing seeded `mistral-small-latest` model to `free_endpoint = true` because the deployed Free policy already treats it as a free fallback; do not mark any other provider automatically. Update Free plan copy and Free AUTO routing with `freeEndpointPool: true`. Keep paid flagship policies untouched.

- [ ] **Step 3: Review migration safety**

Run: `rg -n "free_plan_mistral_only|MISTRAL_FALLBACK_ID|freeEndpointPool|enforce_free" supabase/migrations apps/web/lib/server`

Expected: the new migration is the active override, historical migrations remain unchanged, and production policy updates do not delete models or paid policies.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260929100000_nextfi_free_endpoint_access.sql
git commit -m "db: allow Free access to verified endpoints"
```

### Task 6: Update the product-facing rename and Free-plan UI copy

**Files:**
- Modify: `apps/web/app/layout.tsx`
- Modify: `apps/web/components/providers/site-settings-provider.tsx`
- Modify: `apps/web/components/brand/landing.tsx`
- Modify: `apps/web/components/brand/public-shell.tsx`
- Modify: `apps/web/components/workspace/shell.tsx`
- Modify: `apps/web/components/workspace/chat.tsx`
- Modify: `apps/web/components/workspace/preferences.tsx`
- Modify: `apps/web/app/privacy/page.tsx`
- Modify: `apps/web/app/terms/page.tsx`
- Modify: `apps/web/app/docs/page.tsx`
- Modify: `apps/web/lib/server/admin.ts`
- Modify: `apps/web/lib/server/http.ts`
- Modify: `apps/web/lib/api.ts` only for visible headers/errors
- Modify: `apps/web/e2e/workspace.spec.ts` and affected unit tests

**Interfaces:**
- Product-facing defaults display “Nextfi Software”.
- Free model UI uses `model.freeEndpoint`/`planAvailable` generically instead of Mistral/NVIDIA special cases.
- Rename browser-facing identifiers to `nextfi-*` where safe, while retaining targeted legacy reads only when needed to migrate existing user state.

- [ ] **Step 1: Add/update failing UI assertions**

Update relevant tests to expect Nextfi Software, generic verified-free copy, and Free model manual selection. Add an assertion that a premium model remains locked for Free while a marked free model is selectable.

- [ ] **Step 2: Run focused UI tests and verify RED**

Run: `npm test --workspace @nextfi/web -- workspace-topbar.test.tsx google-auth.test.tsx`

Expected: the legacy product copy and provider-specific Free copy fail the new assertions.

- [ ] **Step 3: Implement the copy and UI changes**

Update metadata/title templates, defaults, visible labels, legal/docs text, model picker statuses, Auto descriptions, upgrade copy, and provider/source labels. Keep old hash/session keys as compatibility values where they are not visible.

- [ ] **Step 4: Run focused tests**

Run the affected unit tests and the relevant Playwright workspace tests if the local server is available.

- [ ] **Step 5: Commit**

```bash
git add apps/web/app apps/web/components apps/web/lib apps/web/e2e apps/web/test
git commit -m "feat: rename the product to Nextfi Software"
```

### Task 7: Update environment examples and repository documentation

**Files:**
- Modify: `README.md`
- Modify: `.env.example`
- Modify: `.env.production.example`
- Modify: `docs/auto-routing.md`
- Modify: `docs/ai-capabilities.md`
- Modify: `docs/supabase-nextjs-architecture.md`
- Modify: `docs/seo-webmaster.md`
- Modify: `apps/web/public/providers/README.md`
- Modify: `apps/web/lib/server/provider-credentials.ts`

**Interfaces:**
- Documentation describes Free access as all explicitly verified free endpoints plus Auto routing, with flagship models reserved for paid plans.
- Credential loading prefers `NEXTFI_CREDENTIAL_ENCRYPTION_KEY` and falls back to `VROMPT_CREDENTIAL_ENCRYPTION_KEY`.
- New examples use Nextfi naming and `https://www.nextfisoftware.com/` where appropriate.

- [ ] **Step 1: Define the documentation checks**

Use repository searches as the documentation check: the examples must contain `NEXTFI_CREDENTIAL_ENCRYPTION_KEY`, and active docs must not claim Mistral-only Free access or premium fallback for Free.

- [ ] **Step 2: Run the check and verify RED**

Run: `rg -n "NEXTFI_CREDENTIAL_ENCRYPTION_KEY|Mistral-only|premium fallback|Vrompt" README.md .env.example .env.production.example docs apps/web/public/providers/README.md`

Expected: the current docs contain the old canonical credential wording or stale Free-plan/brand claims.

- [ ] **Step 3: Implement documentation and env compatibility changes**

Update prose and examples without changing internal compatibility identifiers. Make provider/key wording explicit: free endpoint access still uses server-configured provider credentials and provider limits.

- [ ] **Step 4: Run the documentation check**

Run the check and `git diff --check`.

- [ ] **Step 5: Commit**

```bash
git add README.md .env.example .env.production.example docs apps/web/public/providers/README.md apps/web/lib/server/provider-credentials.ts
git commit -m "docs: align Nextfi free model access guidance"
```

### Task 8: Full verification and final review

**Files:**
- Modify: any files required by verification findings only

- [ ] **Step 1: Run the complete verification commands**

Run:

```bash
npm test
npm run typecheck
npm run lint
npm run format
npm run build
```

- [ ] **Step 2: Review requirements against the spec**

Confirm Free manual and Auto access, premium exclusion, failover behavior, NVIDIA sync, admin free flag, branding, env fallback, and compatibility identifiers one by one.

- [ ] **Step 3: Search the final diff for stale copy and unsafe policy assumptions**

Run: `rg -n -i "Vrompt|Mistral-only|Mistral fallback|verified NVIDIA|free_plan_mistral_only|MISTRAL_FALLBACK_ID|tagging|marketing" README.md docs apps/web supabase -g '!*.map'`

Review each match: visible copy and active logic must be updated; only intentional compatibility identifiers and historical migrations may remain.

- [ ] **Step 4: Inspect the final diff and status**

Run: `git diff --check; git status --short; git diff HEAD~8..HEAD --stat`

Expected: no whitespace errors, only scoped files changed, and all required commits are present.
