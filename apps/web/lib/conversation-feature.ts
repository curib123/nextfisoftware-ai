export type ConversationFeature = 'chat' | 'image_generation';

const imageCreationIntent =
  /\b(?:generate|create|make|draw|design|render|illustrate|paint|produce)\b[\s\S]{0,80}\b(?:image|picture|photo|illustration|artwork|logo|icon|poster|banner|wallpaper|cover)\b/i;
const imageFirstIntent =
  /^\s*(?:image|picture|illustration|logo|icon|poster|banner|wallpaper|cover)\s*:/i;

export function inferConversationFeature(prompt: string): ConversationFeature {
  const text = prompt.trim();
  if (!text) return 'chat';
  return imageCreationIntent.test(text) || imageFirstIntent.test(text)
    ? 'image_generation'
    : 'chat';
}
