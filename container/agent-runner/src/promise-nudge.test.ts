import { describe, expect, it } from 'bun:test';

import { isPromiseOnly } from './promise-nudge.js';

describe('isPromiseOnly', () => {
  it('flags the 2026-10-11 battery reply', () => {
    expect(
      isPromiseOnly('<message to="nick">🍋 Let me check that photo and add it to your purchases tracker.</message>', 0),
    ).toBe(true);
  });

  it('flags a promise after a short acknowledgement', () => {
    expect(isPromiseOnly('Got it. I\'ll update the inventory now.', 0)).toBe(true);
  });

  it('never flags a turn that called tools', () => {
    expect(isPromiseOnly('<message to="nick">Let me know if you want more.</message>', 1)).toBe(false);
  });

  it('ignores mid-sentence offers', () => {
    expect(isPromiseOnly("Done: added 0 on hand. Tell me how many you buy and I'll update it.", 0)).toBe(false);
  });

  it('ignores long answers', () => {
    expect(isPromiseOnly(`Here is the summary. ${'x'.repeat(500)} Let me know.`, 0)).toBe(false);
  });

  it('ignores internal scratchpad text', () => {
    expect(isPromiseOnly('<internal>let me think</internal><message to="nick">Done.</message>', 0)).toBe(false);
  });
});
