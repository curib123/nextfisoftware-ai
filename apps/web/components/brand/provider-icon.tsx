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
