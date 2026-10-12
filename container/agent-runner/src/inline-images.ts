/**
 * Lemon fork: attach photos to the prompt itself. Attachments reach the model
 * as text ("[image: x.jpg — saved to /workspace/inbox/…/x.jpg]"), and the local
 * model often answered about a photo it never opened (battery-photo eval, 0/2
 * on clean-x2, 2026-10-12). Image blocks make the photo part of the message.
 */
import fs from "fs";
import path from "path";

const IMAGE_REF_RE =
  /\[image: [^\]\n]*? — saved to (\/workspace\/[^\]\n]+?)\]/g;
type ImageMediaType = "image/jpeg" | "image/png" | "image/gif" | "image/webp";
const MEDIA_TYPES: Record<string, ImageMediaType> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
};
/** Anthropic's per-image limit is 5 MB; larger files stay as a path to Read. */
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_INLINE_IMAGES = 4;

export type PromptBlock =
  | { type: "text"; text: string }
  | {
      type: "image";
      source: { type: "base64"; media_type: ImageMediaType; data: string };
    };

/** Image type from magic bytes, or undefined when it isn't one the API takes. */
export function sniffImageType(b: Buffer): ImageMediaType | undefined {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff)
    return "image/jpeg";
  if (
    b.length >= 8 &&
    b
      .subarray(0, 8)
      .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  )
    return "image/png";
  if (b.length >= 6 && /^GIF8[79]a$/.test(b.subarray(0, 6).toString("latin1")))
    return "image/gif";
  if (
    b.length >= 12 &&
    b.subarray(0, 4).toString("latin1") === "RIFF" &&
    b.subarray(8, 12).toString("latin1") === "WEBP"
  )
    return "image/webp";
  return undefined;
}

/** The prompt as content blocks when it references readable images, else the text. */
export function withInlineImages(
  text: string,
  readFile: (p: string) => Buffer = fs.readFileSync,
  statSize: (p: string) => number = (p) => fs.statSync(p).size,
): string | PromptBlock[] {
  const images: PromptBlock[] = [];
  const seen = new Set<string>();
  for (const match of text.matchAll(IMAGE_REF_RE)) {
    const file = path.resolve(match[1]);
    if (
      !file.startsWith("/workspace/") ||
      !(path.extname(file).toLowerCase() in MEDIA_TYPES)
    )
      continue;
    if (seen.has(file) || images.length >= MAX_INLINE_IMAGES) continue;
    seen.add(file);
    let data: Buffer;
    try {
      if (statSize(file) > MAX_IMAGE_BYTES) continue;
      data = readFile(file);
    } catch {
      continue;
    }
    // The bytes decide the type: a WebP saved as .jpg would make the API 400.
    const mediaType = sniffImageType(data);
    if (!mediaType || data.length > MAX_IMAGE_BYTES) continue;
    images.push({
      type: "image",
      source: {
        type: "base64",
        media_type: mediaType,
        data: data.toString("base64"),
      },
    });
  }
  return images.length ? [{ type: "text", text }, ...images] : text;
}
