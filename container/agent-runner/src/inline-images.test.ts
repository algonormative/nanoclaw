import { describe, expect, it } from 'bun:test';

import { MAX_INLINE_IMAGES, withInlineImages } from './inline-images.js';

const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
const reader =
  (files: Record<string, Buffer>) =>
  (p: string): Buffer => {
    const f = files[p];
    if (!f) throw new Error('ENOENT');
    return f;
  };

describe('withInlineImages', () => {
  it('attaches a saved Telegram photo as an image block', () => {
    const text =
      '<message from="nick">Add these<br>\n[image: attachment-1.jpg — saved to /workspace/inbox/m1/attachment-1.jpg]</message>';
    const out = withInlineImages(text, reader({ '/workspace/inbox/m1/attachment-1.jpg': jpeg }), () => 4);
    expect(Array.isArray(out)).toBe(true);
    const blocks = out as Exclude<typeof out, string>;
    expect(blocks[0]).toEqual({ type: 'text', text });
    expect(blocks[1]).toMatchObject({
      type: 'image',
      source: { media_type: 'image/jpeg', data: jpeg.toString('base64') },
    });
  });

  it('keeps plain text when there is no image', () => {
    expect(withInlineImages('queue the Sun card', reader({}))).toBe('queue the Sun card');
  });

  it('keeps plain text when the file is missing or not an image', () => {
    const text =
      '[image: a.jpg — saved to /workspace/inbox/gone.jpg]\n[file: notes.pdf — saved to /workspace/inbox/notes.pdf]';
    expect(withInlineImages(text, reader({ '/workspace/inbox/notes.pdf': jpeg }), () => 4)).toBe(text);
  });

  it('caps the number of images', () => {
    const refs = Array.from({ length: 6 }, (_, i) => `[image: ${i}.png — saved to /workspace/inbox/${i}.png]`);
    const files = Object.fromEntries(refs.map((_, i) => [`/workspace/inbox/${i}.png`, png]));
    const out = withInlineImages(refs.join('\n'), reader(files), () => 10) as unknown[];
    expect(out.length).toBe(1 + MAX_INLINE_IMAGES);
  });

  it('uses the bytes, not the extension, and skips non-images', () => {
    const text = '[image: a.png — saved to /workspace/inbox/a.png]\n[image: b.jpg — saved to /workspace/inbox/b.jpg]';
    const out = withInlineImages(
      text,
      reader({
        '/workspace/inbox/a.png': jpeg,
        '/workspace/inbox/b.jpg': Buffer.from('not an image'),
      }),
      () => 4,
    ) as Array<{ type: string; source?: { media_type: string } }>;
    expect(out.length).toBe(2);
    expect(out[1].source?.media_type).toBe('image/jpeg');
  });

  it('skips oversized files without reading them, and paths outside /workspace', () => {
    let reads = 0;
    const r = (p: string): Buffer => {
      reads++;
      return jpeg;
    };
    const text =
      '[image: big.jpg — saved to /workspace/inbox/big.jpg]\n[image: x.jpg — saved to /workspace/../etc/x.jpg]';
    expect(withInlineImages(text, r, () => 6 * 1024 * 1024)).toBe(text);
    expect(reads).toBe(0);
  });
});
