import 'server-only';

import type { DbModel } from './credits';

export type ProviderMessage = { role: string; content: string };
export type ProviderFile = { name: string; mimeType: string; data: Uint8Array };
export type NormalizedUsage = {
  input: number;
  cached: number;
  cacheWrite: number;
  output: number;
  reasoning: number;
  raw: Record<string, unknown>;
  reported: boolean;
};

export type ProviderOptions = {
  feature?: 'chat' | 'image_generation';
  reasoningLevel?: string;
  image?: (mimeType: string, base64: string) => Promise<void>;
  apiKey?: string;
};

type ProviderUsage = Record<string, unknown> & {
  input_tokens?: number;
  input_tokens_details?: { cached_tokens?: number };
  output_tokens?: number;
  output_tokens_details?: { reasoning_tokens?: number };
  promptTokenCount?: number;
  cachedContentTokenCount?: number;
  candidatesTokenCount?: number;
  thoughtsTokenCount?: number;
  prompt_tokens?: number;
  completion_tokens?: number;
};
type ProviderStreamEvent = {
  type?: string;
  delta?: string | { type?: string; text?: string; content?: string };
  error?: unknown;
  response?: {
    usage?: ProviderUsage;
    output?: Array<{ type?: string; result?: string }>;
  };
  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?: string;
        thought?: boolean;
        inlineData?: { mimeType?: string; data?: string };
      }>;
    };
    finishReason?: string;
  }>;
  usageMetadata?: ProviderUsage;
  message?: { usage?: ProviderUsage };
  usage?: ProviderUsage;
  choices?: Array<{ delta?: { content?: string }; finish_reason?: string }>;
};
type OpenAIContent =
  | { type: 'input_text'; text: string }
  | { type: 'input_image'; detail?: 'low'; image_url: string }
  | { type: 'input_file'; filename: string; file_data: string };
type OpenAIInput = { role: string; content: string | OpenAIContent[] };
type GooglePart =
  | { text: string }
  | { inlineData: { mimeType: string; data: string } };
type AnthropicPart = {
  type: string;
  text?: string;
  cache_control?: { type: string };
  source?: { type: string; media_type: string; data: string };
};
type AnthropicInput = { role: string; content: AnthropicPart[] };
type MistralPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };
type MistralInput = { role: string; content: string | MistralPart[] };
type NvidiaPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };
type NvidiaInput = { role: string; content: string | NvidiaPart[] };

export type ProviderHealthStatus =
  | 'HEALTHY'
  | 'DEGRADED'
  | 'UNHEALTHY'
  | 'NOT_CONFIGURED';

export type ProviderHealthResult = {
  status: ProviderHealthStatus;
  message: string;
};

const MAX_PROVIDER_ATTEMPTS = 3;

function providerKey(
  provider: DbModel['provider'],
  override?: string,
) {
  const explicit = override?.trim();
  if (explicit) return explicit;
  return (
    {
      OPENAI: process.env.OPENAI_API_KEY,
      GOOGLE: process.env.GOOGLE_AI_API_KEY,
      ANTHROPIC: process.env.ANTHROPIC_API_KEY,
      MISTRAL: process.env.MISTRAL_API_KEY,
      NVIDIA: process.env.NVIDIA_API_KEY,
    } as const
  )[provider]?.trim();
}

function nvidiaBaseUrl() {
  return (process.env.NVIDIA_API_BASE_URL?.trim() || 'https://integrate.api.nvidia.com').replace(/\/$/, '');
}

function retryDelay(response: Response, attempt: number) {
  const retryAfter = Number(response.headers.get('retry-after'));
  if (Number.isFinite(retryAfter) && retryAfter >= 0)
    return Math.min(retryAfter * 1000, 30_000);
  return Math.min(1000 * 2 ** attempt, 8_000);
}

function waitForRetry(milliseconds: number, signal: AbortSignal) {
  if (milliseconds <= 0) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, milliseconds);
    const abort = () => {
      clearTimeout(timer);
      reject(new DOMException('The request was aborted.', 'AbortError'));
    };
    signal.addEventListener('abort', abort, { once: true });
  });
}

export class ProviderFailure extends Error {
  constructor(
    public readonly category: string,
    public readonly retryable = true,
  ) {
    super('This model is temporarily unavailable.');
  }
}

export function emptyUsage(): NormalizedUsage {
  return {
    input: 0,
    cached: 0,
    cacheWrite: 0,
    output: 0,
    reasoning: 0,
    raw: {},
    reported: false,
  };
}

async function request(
  url: string,
  headers: Record<string, string>,
  body: unknown,
  signal: AbortSignal,
) {
  for (let attempt = 0; attempt < MAX_PROVIDER_ATTEMPTS; attempt += 1) {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal,
      redirect: 'error',
    });
    if (response.ok) {
      if (!response.body) throw new ProviderFailure('EMPTY_STREAM');
      return response.body;
    }

    const retryable =
      response.status === 408 || response.status === 429 || response.status >= 500;
    if (retryable && attempt < MAX_PROVIDER_ATTEMPTS - 1) {
      const delay = retryDelay(response, attempt);
      await response.body?.cancel();
      await waitForRetry(delay, signal);
      continue;
    }

    await response.body?.cancel();
    throw new ProviderFailure(`HTTP_${response.status}`, retryable);
  }
  throw new ProviderFailure('RETRY_EXHAUSTED');
}

async function* readEvents(body: ReadableStream<Uint8Array>) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += done
        ? decoder.decode()
        : decoder.decode(value, { stream: true });
      buffer = buffer.replace(/\r\n/g, '\n');
      let end = buffer.indexOf('\n\n');
      while (end >= 0) {
        const frame = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        const data = frame
          .split('\n')
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).trimStart())
          .join('\n');
        if (data && data !== '[DONE]')
          yield JSON.parse(data) as ProviderStreamEvent;
        end = buffer.indexOf('\n\n');
      }
      if (done) break;
    }
  } finally {
    reader.releaseLock();
  }
}

function b64(data: Uint8Array) {
  return Buffer.from(data).toString('base64');
}

async function openai(
  model: DbModel,
  messages: ProviderMessage[],
  files: ProviderFile[],
  maxOutput: number,
  signal: AbortSignal,
  delta: (text: string) => void,
  usage: NormalizedUsage,
  options: ProviderOptions,
) {
  const key = providerKey('OPENAI', options.apiKey);
  if (!key) throw new ProviderFailure('NOT_CONFIGURED', false);
  const input: OpenAIInput[] = messages.map((m) => ({ role: m.role, content: m.content }));
  if (!input.length) input.push({ role: 'user', content: '' });
  if (files.length) {
    const last = input[input.length - 1]!;
    const priorText = typeof last.content === 'string' ? last.content : '';
    last.content = [
      { type: 'input_text', text: priorText },
      ...files.map((file): OpenAIContent =>
        file.mimeType.startsWith('image/')
          ? {
              type: 'input_image',
              ...(model.provider_model_id === 'gpt-4o-mini'
                ? { detail: 'low' as const }
                : {}),
              image_url: `data:${file.mimeType};base64,${b64(file.data)}`,
            }
          : file.mimeType === 'text/plain'
            ? {
                type: 'input_text',
                text: `File ${file.name}:\n${new TextDecoder().decode(file.data)}`,
              }
            : {
                type: 'input_file',
                filename: file.name,
                file_data: `data:${file.mimeType};base64,${b64(file.data)}`,
              },
      ),
    ];
  }

  const body = await request(
    'https://api.openai.com/v1/responses',
    { authorization: `Bearer ${key}` },
    {
      model: model.provider_model_id,
      input,
      max_output_tokens: maxOutput,
      stream: true,
      store: false,
      ...(options.reasoningLevel && model.capabilities.includes('reasoning')
        ? { reasoning: { effort: options.reasoningLevel } }
        : {}),
      ...(options.feature === 'image_generation'
        ? {
            tools: [{ type: 'image_generation', output_format: 'png' }],
            tool_choice: { type: 'image_generation' },
          }
        : {}),
    },
    signal,
  );

  let complete = false;
  for await (const event of readEvents(body)) {
    if (
      event.type === 'response.output_text.delta' ||
      event.type === 'response.refusal.delta'
    )
      delta(String(event.delta ?? ''));

    if (event.response?.usage) {
      const u = event.response.usage;
      usage.input = Number(u.input_tokens ?? 0);
      usage.cached = Number(u.input_tokens_details?.cached_tokens ?? 0);
      usage.output = Number(u.output_tokens ?? 0);
      usage.reasoning = Number(u.output_tokens_details?.reasoning_tokens ?? 0);
      usage.raw = u;
      usage.reported = true;
    }

    if (event.type === 'response.completed') {
      for (const item of event.response?.output ?? []) {
        if (item.type === 'image_generation_call' && item.result)
          await options.image?.('image/png', item.result);
      }
    }
    if (event.type === 'response.completed' || event.type === 'response.incomplete')
      complete = true;
    if (event.type === 'error' || event.type === 'response.failed')
      throw new ProviderFailure('PROVIDER_ERROR');
  }
  if (!complete) throw new ProviderFailure('INTERRUPTED_STREAM');
}

async function google(
  model: DbModel,
  messages: ProviderMessage[],
  files: ProviderFile[],
  maxOutput: number,
  signal: AbortSignal,
  delta: (text: string) => void,
  usage: NormalizedUsage,
  options: ProviderOptions,
) {
  const key = providerKey('GOOGLE', options.apiKey);
  if (!key) throw new ProviderFailure('NOT_CONFIGURED', false);

  const system = messages
    .filter((m) => m.role === 'system')
    .map((m) => ({ text: m.content }));
  const contents = messages
    .filter((m) => m.role !== 'system')
    .map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }] as GooglePart[],
    }));
  if (!contents.length) contents.push({ role: 'user', parts: [{ text: '' }] });
  contents[contents.length - 1]!.parts.push(
    ...files.map((file) =>
      file.mimeType === 'text/plain'
        ? {
            text: `File ${file.name}:\n${new TextDecoder().decode(file.data)}`,
          }
        : {
            inlineData: {
              mimeType: file.mimeType,
              data: b64(file.data),
            },
          },
    ),
  );

  const body = await request(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model.provider_model_id)}:streamGenerateContent?alt=sse`,
    { 'x-goog-api-key': key },
    {
      contents,
      ...(system.length ? { systemInstruction: { parts: system } } : {}),
      generationConfig: {
        maxOutputTokens: maxOutput,
        responseModalities:
          options.feature === 'image_generation' ? ['TEXT', 'IMAGE'] : ['TEXT'],
      },
    },
    signal,
  );

  let complete = false;
  for await (const event of readEvents(body)) {
    if (event.error) throw new ProviderFailure('PROVIDER_ERROR');
    for (const part of event.candidates?.[0]?.content?.parts ?? []) {
      if (part.text && !part.thought) delta(String(part.text));
      if (part.inlineData?.data && options.feature === 'image_generation')
        await options.image?.(
          String(part.inlineData.mimeType ?? 'image/png'),
          String(part.inlineData.data),
        );
    }
    if (event.candidates?.[0]?.finishReason) complete = true;
    if (event.usageMetadata) {
      const u = event.usageMetadata;
      usage.input = Number(u.promptTokenCount ?? 0);
      usage.cached = Number(u.cachedContentTokenCount ?? 0);
      usage.output =
        Number(u.candidatesTokenCount ?? 0) + Number(u.thoughtsTokenCount ?? 0);
      usage.reasoning = Number(u.thoughtsTokenCount ?? 0);
      usage.raw = u;
      usage.reported = true;
    }
  }
  if (!complete) throw new ProviderFailure('INTERRUPTED_STREAM');
}

async function anthropic(
  model: DbModel,
  messages: ProviderMessage[],
  files: ProviderFile[],
  maxOutput: number,
  signal: AbortSignal,
  delta: (text: string) => void,
  usage: NormalizedUsage,
  options: ProviderOptions,
) {
  const key = providerKey('ANTHROPIC', options.apiKey);
  if (!key) throw new ProviderFailure('NOT_CONFIGURED', false);
  if (options.feature === 'image_generation')
    throw new ProviderFailure('UNSUPPORTED_FEATURE', false);

  const system = messages
    .filter((m) => m.role === 'system')
    .map((m) => ({
      type: 'text',
      text: m.content,
      ...(model.capabilities.includes('prompt_caching')
        ? { cache_control: { type: 'ephemeral' } }
        : {}),
    }));
  const input: AnthropicInput[] = messages
    .filter((m) => m.role !== 'system')
    .map((m) => ({
      role: m.role,
      content: [{ type: 'text', text: m.content }],
    }));
  if (!input.length) input.push({ role: 'user', content: [{ type: 'text', text: '' }] });
  input[input.length - 1]!.content.push(
    ...files.map((file) =>
      file.mimeType === 'text/plain'
        ? {
            type: 'text',
            text: `File ${file.name}:\n${new TextDecoder().decode(file.data)}`,
          }
        : {
            type: file.mimeType.startsWith('image/') ? 'image' : 'document',
            source: {
              type: 'base64',
              media_type: file.mimeType,
              data: b64(file.data),
            },
          },
    ),
  );

  const body = await request(
    'https://api.anthropic.com/v1/messages',
    {
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
    },
    {
      model: model.provider_model_id,
      messages: input,
      ...(system.length ? { system } : {}),
      max_tokens: maxOutput,
      stream: true,
    },
    signal,
  );

  let complete = false;
  for await (const event of readEvents(body)) {
    if (event.type === 'error') throw new ProviderFailure('PROVIDER_ERROR');
    if (typeof event.delta === 'object' && event.delta?.type === 'text_delta')
      delta(String(event.delta.text ?? ''));
    const u = event.message?.usage ?? event.usage;
    if (u) {
      usage.raw = { ...usage.raw, ...u };
      usage.reported = true;
      const all = usage.raw as Record<string, number>;
      usage.cached = Number(all.cache_read_input_tokens ?? 0);
      usage.cacheWrite = Number(all.cache_creation_input_tokens ?? 0);
      usage.input =
        Number(all.input_tokens ?? 0) + usage.cached + usage.cacheWrite;
      usage.output = Number(all.output_tokens ?? 0);
    }
    if (event.type === 'message_stop') complete = true;
  }
  if (!complete) throw new ProviderFailure('INTERRUPTED_STREAM');
}

async function mistral(
  model: DbModel,
  messages: ProviderMessage[],
  files: ProviderFile[],
  maxOutput: number,
  signal: AbortSignal,
  delta: (text: string) => void,
  usage: NormalizedUsage,
  options: ProviderOptions,
) {
  const key = providerKey('MISTRAL', options.apiKey);
  if (!key) throw new ProviderFailure('NOT_CONFIGURED', false);
  if (options.feature === 'image_generation')
    throw new ProviderFailure('UNSUPPORTED_FEATURE', false);

  const input: MistralInput[] = messages.map((m) => ({ role: m.role, content: m.content }));
  if (!input.length) input.push({ role: 'user', content: '' });
  if (files.length) {
    const last = input[input.length - 1]!;
    const content: MistralPart[] = [{ type: 'text', text: String(last.content) }];
    for (const file of files) {
      if (file.mimeType === 'text/plain')
        content.push({
          type: 'text',
          text: `File ${file.name}:\n${new TextDecoder().decode(file.data)}`,
        });
      else if (file.mimeType.startsWith('image/'))
        content.push({
          type: 'image_url',
          image_url: {
            url: `data:${file.mimeType};base64,${b64(file.data)}`,
          },
        });
      else throw new ProviderFailure('UNSUPPORTED_FILE', false);
    }
    last.content = content;
  }

  const body = await request(
    'https://api.mistral.ai/v1/chat/completions',
    { authorization: `Bearer ${key}` },
    {
      model: model.provider_model_id,
      messages: input,
      max_tokens: maxOutput,
      stream: true,
    },
    signal,
  );
  let complete = false;
  for await (const event of readEvents(body)) {
    if (event.error) throw new ProviderFailure('PROVIDER_ERROR');
    const choice = event.choices?.[0];
    const content = choice?.delta?.content;
    if (typeof content === 'string') delta(content);
    if (choice?.finish_reason) complete = true;
    if (event.usage) {
      const u = event.usage;
      usage.input = Number(u.prompt_tokens ?? 0);
      usage.output = Number(u.completion_tokens ?? 0);
      usage.raw = { ...usage.raw, ...u };
      usage.reported = true;
    }
  }
  if (!complete) throw new ProviderFailure('INTERRUPTED_STREAM');
}


async function nvidia(
  model: DbModel,
  messages: ProviderMessage[],
  files: ProviderFile[],
  maxOutput: number,
  signal: AbortSignal,
  delta: (text: string) => void,
  usage: NormalizedUsage,
  options: ProviderOptions,
) {
  const key = providerKey('NVIDIA', options.apiKey);
  if (!key) throw new ProviderFailure('NOT_CONFIGURED', false);
  if (options.feature === 'image_generation')
    throw new ProviderFailure('UNSUPPORTED_FEATURE', false);

  const input: NvidiaInput[] = messages.map((m) => ({
    role: m.role,
    content: m.content,
  }));
  if (!input.length) input.push({ role: 'user', content: '' });

  if (files.length) {
    const last = input[input.length - 1]!;
    const content: NvidiaPart[] = [
      { type: 'text', text: typeof last.content === 'string' ? last.content : '' },
    ];
    for (const file of files) {
      if (file.mimeType === 'text/plain')
        content.push({
          type: 'text',
          text: `File ${file.name}:\n${new TextDecoder().decode(file.data)}`,
        });
      else if (file.mimeType.startsWith('image/'))
        content.push({
          type: 'image_url',
          image_url: {
            url: `data:${file.mimeType};base64,${b64(file.data)}`,
          },
        });
      else throw new ProviderFailure('UNSUPPORTED_FILE', false);
    }
    last.content = content;
  }

  const body = await request(
    `${nvidiaBaseUrl()}/v1/chat/completions`,
    { authorization: `Bearer ${key}` },
    {
      model: model.provider_model_id,
      messages: input,
      max_tokens: maxOutput,
      stream: true,
    },
    signal,
  );

  let complete = false;
  for await (const event of readEvents(body)) {
    if (event.error) throw new ProviderFailure('PROVIDER_ERROR');
    const choice = event.choices?.[0];
    const content = choice?.delta?.content;
    if (typeof content === 'string') delta(content);
    if (choice?.finish_reason) complete = true;
    if (event.usage) {
      const u = event.usage;
      usage.input = Number(u.prompt_tokens ?? 0);
      usage.output = Number(u.completion_tokens ?? 0);
      usage.raw = { ...usage.raw, ...u };
      usage.reported = true;
    }
  }
  if (!complete) throw new ProviderFailure('INTERRUPTED_STREAM');
}

async function healthFetch(
  url: string,
  init: RequestInit,
  timeoutMs = 8000,
) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
      cache: 'no-store',
      redirect: 'error',
    });
  } finally {
    clearTimeout(timer);
  }
}

function healthFromResponse(response: Response): ProviderHealthResult {
  if (response.ok)
    return { status: 'HEALTHY', message: 'Connection verified.' };
  if (response.status === 429)
    return {
      status: 'DEGRADED',
      message: 'The provider accepted the credential but is rate limited.',
    };
  if (response.status === 401 || response.status === 403)
    return {
      status: 'UNHEALTHY',
      message: 'The provider rejected this API key.',
    };
  if (response.status >= 500)
    return {
      status: 'DEGRADED',
      message: `Provider returned HTTP ${response.status}.`,
    };
  return {
    status: 'UNHEALTHY',
    message: `Provider returned HTTP ${response.status}.`,
  };
}

export async function probeProviderCredential(
  provider: DbModel['provider'],
  apiKey: string,
): Promise<ProviderHealthResult> {
  const key = apiKey.trim();
  if (!key)
    return { status: 'NOT_CONFIGURED', message: 'No API key configured.' };

  try {
    let response: Response;
    switch (provider) {
      case 'OPENAI':
        response = await healthFetch('https://api.openai.com/v1/models', {
          headers: { authorization: `Bearer ${key}` },
        });
        break;
      case 'GOOGLE':
        response = await healthFetch(
          `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}`,
          {},
        );
        break;
      case 'ANTHROPIC':
        response = await healthFetch('https://api.anthropic.com/v1/models', {
          headers: {
            'x-api-key': key,
            'anthropic-version': '2023-06-01',
          },
        });
        break;
      case 'MISTRAL':
        response = await healthFetch('https://api.mistral.ai/v1/models', {
          headers: { authorization: `Bearer ${key}` },
        });
        break;
      case 'NVIDIA':
        response = await healthFetch(`${nvidiaBaseUrl()}/v1/models`, {
          headers: { authorization: `Bearer ${key}` },
        });
        break;
    }
    const result = healthFromResponse(response);
    await response.body?.cancel().catch(() => {});
    return result;
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError')
      return { status: 'DEGRADED', message: 'Provider health check timed out.' };
    return { status: 'DEGRADED', message: 'Provider health check failed.' };
  }
}

export async function discoverNvidiaModelIds(
  apiKey = process.env.NVIDIA_API_KEY?.trim(),
) {
  if (!apiKey) throw new ProviderFailure('NOT_CONFIGURED', false);
  const response = await healthFetch(`${nvidiaBaseUrl()}/v1/models`, {
    headers: { authorization: `Bearer ${apiKey}` },
  }, 12000);
  if (!response.ok)
    throw new ProviderFailure(`HTTP_${response.status}`, response.status === 429 || response.status >= 500);
  const body = (await response.json()) as {
    data?: Array<{ id?: string }>;
  };
  return [...new Set(
    (body.data ?? [])
      .map((item) => String(item.id ?? '').trim())
      .filter(Boolean),
  )];
}

export async function probeNvidiaModel(
  modelId: string,
  apiKey = process.env.NVIDIA_API_KEY?.trim(),
): Promise<ProviderHealthResult> {
  if (!apiKey)
    return { status: 'NOT_CONFIGURED', message: 'NVIDIA_API_KEY is not configured.' };
  try {
    const response = await healthFetch(
      `${nvidiaBaseUrl()}/v1/chat/completions`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: modelId,
          messages: [{ role: 'user', content: 'Reply with OK.' }],
          max_tokens: 2,
          stream: false,
        }),
      },
      8000,
    );
    const result = healthFromResponse(response);
    if (result.status === 'HEALTHY') {
      const body = (await response.json().catch(() => null)) as
        | { choices?: unknown[] }
        | null;
      if (!body?.choices?.length)
        return {
          status: 'DEGRADED',
          message: 'The endpoint responded but did not return a chat completion.',
        };
    } else {
      await response.body?.cancel().catch(() => {});
    }
    return result;
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError')
      return { status: 'DEGRADED', message: 'NVIDIA model probe timed out.' };
    return { status: 'DEGRADED', message: 'NVIDIA model probe failed.' };
  }
}

export async function streamProvider(
  model: DbModel,
  messages: ProviderMessage[],
  files: ProviderFile[],
  maxOutput: number,
  signal: AbortSignal,
  delta: (text: string) => void,
  usage: NormalizedUsage,
  options: ProviderOptions = {},
) {
  switch (model.provider) {
    case 'OPENAI':
      return openai(model, messages, files, maxOutput, signal, delta, usage, options);
    case 'GOOGLE':
      return google(model, messages, files, maxOutput, signal, delta, usage, options);
    case 'ANTHROPIC':
      return anthropic(model, messages, files, maxOutput, signal, delta, usage, options);
    case 'MISTRAL':
      return mistral(model, messages, files, maxOutput, signal, delta, usage, options);
    case 'NVIDIA':
      return nvidia(model, messages, files, maxOutput, signal, delta, usage, options);
  }
}
