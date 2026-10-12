import { describe, expect, it } from 'bun:test';

import { MAX_INLINE_IMAGES, withInlineImages } from './inline-images.js';

const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
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
    const out = withInlineImages(text, reader({ '/workspace/inbox/m1/attachment-1.jpg': jpeg }));
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
    expect(withInlineImages(text, reader({ '/workspace/inbox/notes.pdf': jpeg }))).toBe(text);
  });

  it('caps the number of images', () => {
    const refs = Array.from({ length: 6 }, (_, i) => `[image: ${i}.png — saved to /workspace/inbox/${i}.png]`);
    const files = Object.fromEntries(refs.map((_, i) => [`/workspace/inbox/${i}.png`, jpeg]));
    const out = withInlineImages(refs.join('\n'), reader(files)) as unknown[];
    expect(out.length).toBe(1 + MAX_INLINE_IMAGES);
  });
});
