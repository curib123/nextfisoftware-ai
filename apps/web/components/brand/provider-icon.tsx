const providerAssets = new Set([
  'openai',
  'google',
  'anthropic',
  'mistral',
]);

export function ProviderIcon({ provider }: { provider: string }) {
  const key = provider.toLowerCase();
  if (providerAssets.has(key))
    return (
      <span aria-hidden="true" className={`model-symbol model-symbol-${key}`}>
        <span
          className="provider-logo"
          style={{
            maskImage: `url(/providers/${key}.svg)`,
            WebkitMaskImage: `url(/providers/${key}.svg)`,
          }}
        />
      </span>
    );
  const label =
    key === 'google'
      ? '✦'
      : key === 'anthropic'
        ? 'AI'
        : key === 'openai'
          ? '◎'
          : key === 'auto'
            ? '✦'
            : key === 'nvidia'
              ? 'N'
              : key.slice(0, 1).toUpperCase();
  return (
    <span aria-hidden="true" className={`model-symbol model-symbol-${key}`}>
      {label}
    </span>
  );
}

export const providerNames: Record<string, string> = {
  openai: 'ChatGPT',
  google: 'Gemini',
  anthropic: 'Claude',
  mistral: 'Mistral',
  nvidia: 'NVIDIA NIM',
};


export const providerSourceNames: Record<string, string> = {
  openai: 'OpenAI',
  google: 'Google AI',
  anthropic: 'Anthropic',
  mistral: 'Mistral',
  nvidia: 'NVIDIA',
};

export function providerSourceLabel(
  provider: string,
  source?: 'MANUAL' | 'NVIDIA_DISCOVERED',
) {
  const key = provider.toLowerCase();
  if (key === 'nvidia' || source === 'NVIDIA_DISCOVERED')
    return 'NVIDIA Hosted';
  return `${providerSourceNames[key] ?? provider} Direct`;
}

export function ModelSourceBadge({
  provider,
  source,
}: {
  provider: string;
  source?: 'MANUAL' | 'NVIDIA_DISCOVERED';
}) {
  const nvidiaHosted =
    provider.toLowerCase() === 'nvidia' || source === 'NVIDIA_DISCOVERED';
  return (
    <span
      className={`model-source-badge ${nvidiaHosted ? 'is-nvidia' : 'is-direct'}`}
      title={
        nvidiaHosted
          ? 'This model is served through NVIDIA hosted inference.'
          : 'This model is served directly through its provider API.'
      }
    >
      {providerSourceLabel(provider, source)}
    </span>
  );
}
