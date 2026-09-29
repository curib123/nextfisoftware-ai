# Nextfi Software Free Model Routing Design

**Date:** 2026-09-29  
**Status:** Approved for implementation

## Goal

Align the application with `README.md` by completing the product rename to **Nextfi Software** and changing the Free plan from a Mistral-only policy into a safe, transparent free-endpoint workspace with automatic best-fit routing. Paid plans retain access to flagship/premium models.

## Product decisions

- **Free manual access:** Free users may manually select any model explicitly marked `free_endpoint = true` that is enabled, manually available, configured, healthy, and compatible with the request.
- **Free Auto access:** Free Auto may select from every eligible free endpoint, including healthy NVIDIA endpoints discovered by the existing sync flow and other provider endpoints explicitly marked free by an administrator.
- **Premium boundary:** Free requests must never route to a model whose `free_endpoint` flag is false. Paid-plan manual and Auto access to flagship models remains available according to their existing policies.
- **Routing behavior:** Auto ranks eligible models by task fit, capability requirements, health, quality, priority, and routing cost. When an Auto provider attempt fails before producing output, it may try the next eligible model within the configured attempt limit. Manual selection never changes models automatically.
- **Unavailable pool:** If no eligible free endpoint exists, return the existing safe availability error and do not consume a premium model or quota reservation.
- **Free endpoint meaning:** The flag means the operator has verified that the configured server credential can use the endpoint under a free/public-access arrangement. It does not mean unauthenticated, unlimited, or provider-endorsed access.

## Branding decisions

- Replace user-facing `Vrompt` copy with **Nextfi Software** across metadata, public pages, workspace copy, legal/docs copy, admin defaults, tests, and repository documentation.
- Use `https://www.nextfisoftware.com/` as the documented public website and production site default where a site URL is defined.
- Preserve internal compatibility identifiers such as existing cookie names, local-storage keys, storage bucket paths, and database IDs unless changing them is required for correctness. This avoids invalidating sessions or user preferences.
- Support `NEXTFI_CREDENTIAL_ENCRYPTION_KEY` as the canonical environment variable and retain `VROMPT_CREDENTIAL_ENCRYPTION_KEY` only as a backwards-compatible fallback during migration. New examples and UI copy use the Nextfi name.

## Architecture

### Model registry and administration

`ai_models.free_endpoint` is the source of truth for Free eligibility. The admin model editor exposes a `Free endpoint` checkbox and persists it through the existing model mutation endpoint. The public catalog exposes the existing free-endpoint badge and uses neutral provider/source copy.

The NVIDIA sync flow continues to discover model IDs, probe them with live chat completions, and set healthy discovered endpoints to enabled/manual/Auto/free. Unhealthy or stale endpoints are disabled and removed from generated Free manual policies. Its Free Auto-pool update remains as an operational summary, but application routing must not depend on a hard-coded Mistral fallback.

### Entitlement resolution

The Free Auto policy remains the shared Free quota bucket. Its routing configuration receives an explicit `freeEndpointPool: true` flag; when present, the application derives the candidate pool from the current model registry instead of requiring every model ID to be manually copied into `allowedModelIds`. Existing `allowedModelIds` remains supported for paid-plan bounded pools.

For Free manual requests, entitlement resolution uses the shared Free Auto policy for quota and limits, then validates the selected model against the free-endpoint eligibility predicate. This allows newly verified free endpoints to become available without creating a policy row for every model. Paid manual requests continue to resolve their model-specific policy rows.

The workspace model response marks a free endpoint as `planAvailable` for Free when the model is operational and manually available. Premium models remain visible where appropriate but stay locked unless the active plan has an eligible policy or the user has a connected BYOK key.

### Auto routing and failover

`chooseAutoModels` returns the ordered candidate list. For `freeEndpointPool`, it filters models by `free_endpoint`, `auto_available`, operational state, required capabilities, request cost bounds, and feature support before applying the existing fit score ordering.

The generation flow reserves quota once, then uses the ordered candidates for Auto attempts. It emits the selected model event when each attempt begins, only commits the assistant message and usage after a successful attempt, and stops fallback after output has been emitted, cancellation, an unsupported/non-retryable error, or the configured attempt limit. A failed attempt must not create duplicate user messages or consume the final generation allowance more than once. Manual and BYOK flows remain single-model.

## Database changes

Add a forward-only migration after the current migrations that:

1. Replaces the Free-plan Mistral-only trigger with a free-endpoint rule: Free Auto pools may contain only `free_endpoint = true` models, and any Free manual policy row may reference only a free endpoint.
2. Updates the Free plan description and Free Auto routing to set `freeEndpointPool: true`, while retaining a bounded `allowedModelIds` list for compatibility/administration visibility.
3. Removes the Free-only Mistral assumption from policy seed/update logic without deleting existing model records.
4. Leaves paid policies and flagship model configuration intact.

The migration must be safe to apply after the hosted database already contains the existing Free trigger and policies.

## Error handling and security

- Provider credentials stay server-only; provider configuration remains a prerequisite for operational eligibility.
- NVIDIA endpoints require `HEALTHY` status, as they do today. Other providers reject `UNHEALTHY` and `NOT_CONFIGURED` models.
- Free access is enforced both in application resolution and by database policy validation.
- A missing or empty free pool returns `503` with the existing safe availability message.
- Premium models are never used as hidden fallbacks for Free requests.
- Existing quota, rate, concurrency, file, capability, and request-cost protections remain unchanged.

## Verification criteria

Automated tests must cover:

1. Free Auto selects a healthy free endpoint and ignores a higher-quality premium model.
2. Free Auto excludes unhealthy, disabled, unconfigured, non-free, and capability-incompatible models.
3. Free manual selection succeeds for a free endpoint without a per-model Free policy row.
4. Free manual selection rejects a premium model.
5. Auto can fail over to the next free candidate before output and does not fail over after partial output.
6. Paid Auto/manual access to flagship models remains unchanged.
7. Admin model mutation persists `freeEndpoint` and NVIDIA sync preserves the free flag behavior.
8. Product-facing defaults and documentation use Nextfi Software while compatibility identifiers remain stable.

Before completion, run the full project test suite, typecheck, lint, formatting check, and production build. Review the final diff for any remaining user-facing Vrompt/tagging-marketing copy and for accidental changes to compatibility identifiers.

