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
};

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
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
    signal,
    redirect: 'error',
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new ProviderFailure(
      \`HTTP_\${response.status}\`,
      response.status === 408 || response.status === 429 || response.status >= 500,
    );
  }
  if (!response.body) throw new ProviderFailure('EMPTY_STREAM');
  return response.body;
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
          yield JSON.parse(data) as Record<string, any>;
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
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key) throw new ProviderFailure('NOT_CONFIGURED', false);
  const input: any[] = messages.map((m) => ({ role: m.role, content: m.content }));
  if (files.length) {
    const last = input[input.length - 1];
    last.content = [
      { type: 'input_text', text: last.content },
      ...files.map((file) =>
        file.mimeType.startsWith('image/')
          ? {
              type: 'input_image',
              ...(model.provider_model_id === 'gpt-4o-mini'
                ? { detail: 'low' }
                : {}),
              image_url: \`data:\${file.mimeType};base64,\${b64(file.data)}\`,
            }
          : file.mimeType === 'text/plain'
            ? {
                type: 'input_text',
                text: \`File \${file.name}:\n\${new TextDecoder().decode(file.data)}\`,
              }
            : {
                type: 'input_file',
                filename: file.name,
                file_data: \`data:\${file.mimeType};base64,\${b64(file.data)}\`,
              },
      ),
    ];
  }

  const body = await request(
    'https://api.openai.com/v1/responses',
    { authorization: \`Bearer \${key}\` },
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
  const key = process.env.GOOGLE_AI_API_KEY?.trim();
  if (!key) throw new ProviderFailure('NOT_CONFIGURED', false);

  const system = messages
    .filter((m) => m.role === 'system')
    .map((m) => ({ text: m.content }));
  const contents = messages
    .filter((m) => m.role !== 'system')
    .map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }] as any[],
    }));
  if (!contents.length) contents.push({ role: 'user', parts: [{ text: '' }] });
  contents[contents.length - 1]!.parts.push(
    ...files.map((file) =>
      file.mimeType === 'text/plain'
        ? {
            text: \`File \${file.name}:\n\${new TextDecoder().decode(file.data)}\`,
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
    \`https://generativelanguage.googleapis.com/v1beta/models/\${encodeURIComponent(model.provider_model_id)}:streamGenerateContent?alt=sse\`,
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
  const key = process.env.ANTHROPIC_API_KEY?.trim();
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
  const input: any[] = messages
    .filter((m) => m.role !== 'system')
    .map((m) => ({
      role: m.role,
      content: [{ type: 'text', text: m.content }],
    }));
  if (!input.length) input.push({ role: 'user', content: [{ type: 'text', text: '' }] });
  input[input.length - 1].content.push(
    ...files.map((file) =>
      file.mimeType === 'text/plain'
        ? {
            type: 'text',
            text: \`File \${file.name}:\n\${new TextDecoder().decode(file.data)}\`,
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
    if (event.delta?.type === 'text_delta') delta(String(event.delta.text ?? ''));
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
  const key = process.env.MISTRAL_API_KEY?.trim();
  if (!key) throw new ProviderFailure('NOT_CONFIGURED', false);
  if (options.feature === 'image_generation')
    throw new ProviderFailure('UNSUPPORTED_FEATURE', false);

  const input: any[] = messages.map((m) => ({ role: m.role, content: m.content }));
  if (!input.length) input.push({ role: 'user', content: '' });
  if (files.length) {
    const last = input[input.length - 1];
    const content: any[] = [{ type: 'text', text: last.content }];
    for (const file of files) {
      if (file.mimeType === 'text/plain')
        content.push({
          type: 'text',
          text: \`File \${file.name}:\n\${new TextDecoder().decode(file.data)}\`,
        });
      else if (file.mimeType.startsWith('image/'))
        content.push({
          type: 'image_url',
          image_url: {
            url: \`data:\${file.mimeType};base64,\${b64(file.data)}\`,
          },
        });
      else throw new ProviderFailure('UNSUPPORTED_FILE', false);
    }
    last.content = content;
  }

  const body = await request(
    'https://api.mistral.ai/v1/chat/completions',
    { authorization: \`Bearer \${key}\` },
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
  }
}
