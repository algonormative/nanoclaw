/**
 * Lemon fork: attach photos to the prompt itself. Attachments reach the model
 * as text ("[image: x.jpg — saved to /workspace/inbox/…/x.jpg]"), and the local
 * model often answered about a photo it never opened (battery-photo eval, 0/2
 * on clean-x2, 2026-10-12). Image blocks make the photo part of the message.
 */
import fs from 'fs';
import path from 'path';

const IMAGE_REF_RE = /\[image: [^\]\n]*? — saved to (\/workspace\/[^\]\n]+?)\]/g;
type ImageMediaType = 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';
const MEDIA_TYPES: Record<string, ImageMediaType> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
};
/** Anthropic's per-image limit is 5 MB; larger files stay as a path to Read. */
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_INLINE_IMAGES = 4;

export type PromptBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; source: { type: 'base64'; media_type: ImageMediaType; data: string } };

/** The prompt as content blocks when it references readable images, else the text. */
export function withInlineImages(
  text: string,
  readFile: (p: string) => Buffer = fs.readFileSync,
): string | PromptBlock[] {
  const images: PromptBlock[] = [];
  const seen = new Set<string>();
  for (const match of text.matchAll(IMAGE_REF_RE)) {
    const file = match[1];
    const mediaType: ImageMediaType | undefined = MEDIA_TYPES[path.extname(file).toLowerCase()];
    if (!mediaType || seen.has(file) || images.length >= MAX_INLINE_IMAGES) continue;
    seen.add(file);
    let data: Buffer;
    try {
      data = readFile(file);
    } catch {
      continue;
    }
    if (data.length === 0 || data.length > MAX_IMAGE_BYTES) continue;
    images.push({ type: 'image', source: { type: 'base64', media_type: mediaType, data: data.toString('base64') } });
  }
  return images.length ? [{ type: 'text', text }, ...images] : text;
}
