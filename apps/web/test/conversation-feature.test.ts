import { describe, expect, it } from 'vitest';
import { inferConversationFeature } from '@/lib/conversation-feature';

describe('unified conversation feature inference', () => {
  it('keeps normal prompts in chat', () => {
    expect(inferConversationFeature('Explain this TypeScript error')).toBe('chat');
    expect(inferConversationFeature('Analyze the image I attached')).toBe('chat');
  });

  it('detects explicit image creation requests without a separate mode', () => {
    expect(inferConversationFeature('Generate an image of a futuristic city')).toBe(
      'image_generation',
    );
    expect(inferConversationFeature('Design a logo for Nextfi Software')).toBe(
      'image_generation',
    );
    expect(inferConversationFeature('Poster: a clean AI conference visual')).toBe(
      'image_generation',
    );
  });
});
