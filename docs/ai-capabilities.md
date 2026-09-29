# AI capabilities in Nextfi Software

Nextfi Software integrates provider APIs. Selecting a model does not reproduce every feature of the provider's consumer application. Capabilities must be configured for the exact model and supported by a Nextfi Software adapter.

## Implemented

| Task                                 | OpenAI               | Gemini                      | Claude                             | Mistral                                |
| ------------------------------------ | -------------------- | --------------------------- | ---------------------------------- | -------------------------------------- |
| Streaming text and code responses    | Yes                  | Yes                         | Yes                                | Yes                                    |
| Image understanding                  | Vision models        | Vision models               | Vision models                      | Vision models                          |
| PDF input                            | Compatible models    | Compatible models           | Compatible models                  | Not integrated; rejected               |
| Plain text attachments               | Yes                  | Yes                         | Yes                                | Yes                                    |
| Image generation                     | Responses image tool | Image-capable Gemini models | Not available through this adapter | Image-generation tool                  |
| Uploaded image as generation context | Compatible models    | Compatible image models     | Not applicable                     | Provider/model dependent; not verified |

Image requests have an explicit task selector, model compatibility checks, plan entitlements, cancellation, and existing generation allowances. Image-only responses are successful. Images persist in private storage, are downloaded through authenticated ownership checks, and remain in message history. Generated outputs do not count against input attachment limits and are not automatically sent back as input. Download and attach an output to use it in a later edit.

Native image generation is distinct from image understanding. A model with `vision` does not automatically support `image_generation`. Claude image requests are rejected before a provider call. Auto selects only compatible enabled models; manual selection does not silently change providers.

## Activation

1. Back up the database and existing private files. Review pending migrations before deploying: older migration `0024` removes legacy community tables.
2. Deploy migration `0026_generated_images` along with the application. It adds message artifacts, generated-file metadata, and policy `allowedFeatures`.
3. Configure provider keys on the server and exact supported model IDs in Admin. Add `image_generation` only to tested compatible models. Gemini needs an image model such as `gemini-2.5-flash-image`, separate from a text-only model.
4. Include `image_generation` in the relevant Auto/manual plan policy's `allowedFeatures`. Existing policies default to chat only. Allow enough generation time for image tools.
5. Persist `CHAT_STORAGE_DIR`. Compose now mounts the `vrompt-private-files` volume at `/var/lib/vrompt/private-chat-files`. Copy any existing private files into it before replacing a running container; a new volume does not migrate old files automatically.
6. Run authenticated live smoke tests with each configured provider: generate, refresh, download, edit an uploaded image, cancel, exhaust allowance, and deny access from another account.

The optional development seed inserts missing examples and image entitlements without overwriting existing configuration. It refuses production environments. Configure production image capabilities and allowances through Admin after testing the exact provider/model.

Image requests currently use generation-count allowances. Reported token usage is retained, but image/tool billing is marked estimated because token prices alone may omit tool charges or modality-specific prices. Do not use those estimates as invoice totals. Validate current provider pricing before enabling paid plans.

## Remaining integrations

Web search with citations, sandboxed code execution, audio transcription, speech synthesis, live voice, video generation/understanding, provider file-search stores, connectors, computer use, and provider-specific reasoning controls are not exposed by this release. These require separate request formats, permissions, storage, accounting, and UI workflows. Text/code generation is not code execution.

Prioritize web search with source citations next, followed by transcription and speech. Add asynchronous video jobs and isolated execution only with explicit product demand and their own quotas. Keep unimplemented features out of model capability choices until their end-to-end adapters are tested.

## Verification and references

Automated tests cover provider request formats, image-only output, interrupted streams, private storage and access checks, unsupported tasks/files, and browser downloads. These use mocked provider responses; they do not establish live provider access, model availability, billing accuracy, or deployed runtime health.

- [OpenAI Responses image-generation tool](https://developers.openai.com/api/docs/guides/tools-image-generation)
- [Gemini image generation](https://ai.google.dev/gemini-api/docs/image-generation)
- [Mistral agent tools](https://docs.mistral.ai/studio/agents/agent-tools): image generation supports Chat Completions; web search and code interpreter require Conversations/Agents.
- [Mistral generated-file format](https://docs.mistral.ai/studio/agents/agent-tools/image_generation)

Recheck these provider documents when changing model IDs. A configured capability is an operator assertion, not provider certification.
