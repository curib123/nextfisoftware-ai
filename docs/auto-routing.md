# Auto routing

Auto applies the plan's explicit model pool, enabled credentials/configuration, capability and context requirements, quality rules, and temporary model cooldowns before ranking. Free plans may opt into the live `free_endpoint` registry with `freeEndpointPool: true`; premium models are never added to that pool. An explicit fallback cannot bypass these filters. Manual selections never switch models automatically.

## Policy configuration

The protected policy API accepts these fields under `routing`:

```json
{
  "allowedModelIds": ["replace-with-an-existing-model-uuid"],
  "freeEndpointPool": false,
  "attemptTimeoutSeconds": 30,
  "maxAttempts": 3,
  "minimumQualityTier": 1,
  "costWeight": 1,
  "rules": [
    {
      "task": "technical",
      "keywords": ["debug", "refactor", "architecture", "algorithm"],
      "qualityTier": 2,
      "capabilities": ["text"]
    }
  ]
}
```

Use actual registry UUIDs for bounded paid pools. For Free, `freeEndpointPool: true` derives candidates from enabled models marked `free_endpoint = true`; newly verified free endpoints join the Free pool after health/configuration checks. An empty bounded pool disables Auto. Manual policies also accept this shape, with an empty pool. Unknown UUIDs are rejected. Do not rerun the seed to update production policies.

Migration `0027_auto_model_pools` snapshots currently enabled Auto models into existing policies that lack a pool. This preserves existing access, including existing Free access; review each plan's pool after migration. It does not retroactively decide which of your models should be paid-only. Apply reviewed pending migrations before deploying this code, or older policies with missing pools will fail closed.

Estimated API spend (input context and the same output budget at the configured token prices) is the primary ordering after quality/capability filtering. Routing cost score, priority, then model UUID break ties. `costWeight: 0` disables price ordering and uses the configured score. Prices and scores remain operator-configured, not live quotes or measured answer quality. Keyword rules provide inexpensive, deterministic task classification; they do not semantically understand every request. Existing rules are preserved by migration; new seed policies include example technical keywords.

## Reliability

The overall plan deadline still bounds generation. Earlier Auto attempts receive the smaller of the configured attempt timeout and an equal share of the total deadline. The last candidate may use the remaining overall time. Manual requests receive the overall deadline. Attempts are sequential and capped at five (default three). Provider abort signals stop timed-out attempts; cancellation, partial output, generated images, reported usage, and non-retryable errors prevent fallback. A timeout before reported usage can still incur provider charges; aborting cannot guarantee a provider refund.

Two transient failures, or one rate-limit response, cool a model down for 30 seconds. Success resets its health state. User cancellation and request validation errors do not penalize model health. Cooldowns affect Auto only. State is bounded, process-local, and resets on restart; multiple API replicas do not share it. Shared health state and controlled recovery probes are future scaling work.

## Context and accounting

Text estimates use one token per three ASCII characters and conservative UTF-8 bytes for non-ASCII text, plus message overhead. Image inputs reserve 4,096 estimated tokens per image rather than treating compressed file bytes as text. These estimates are not exact provider token counts and can overestimate or underestimate model-specific image processing. PDFs retain a conservative byte ceiling pending a proper page/token counter. No conversation history is silently truncated. Provider context errors remain authoritative.

Quota reservation happens once per request. All attempts are recorded, and finalization consumes at most one generation allowance. Token/cost estimates are explicitly marked when provider usage is absent; they are not guaranteed invoice totals. Tests cover orchestrator decisions with mocked database/provider boundaries, not real database lock contention or live provider billing.

## Verification before release

Run the API tests and typecheck. Then verify each configured model with real credentials, cancellation and a provider outage in an isolated environment. Measure p50/p95 time to first output, fallback completion rate, cost per successful task, and response quality on a fixed task set. The routing tests establish behavior, not production latency or cost savings.
