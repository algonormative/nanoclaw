import { describe, expect, it } from 'bun:test';

import { isFakeToolCall, isPromiseOnly, isSilentTurn, isUnbackedClaim, plainReplyText } from './promise-nudge.js';

describe('isPromiseOnly', () => {
  it('flags the 2026-10-11 battery reply', () => {
    expect(
      isPromiseOnly('<message to="nick">🍋 Let me check that photo and add it to your purchases tracker.</message>', 0),
    ).toBe(true);
  });

  it('flags a promise after a short acknowledgement', () => {
    expect(isPromiseOnly("Got it. I'll update the inventory now.", 0)).toBe(true);
  });

  it('never flags "let me know"', () => {
    expect(isPromiseOnly('<message to="nick">Let me know if you want more.</message>', 1)).toBe(false);
  });

  it('does not nudge promises after tool calls (evals: it makes the local model spiral)', () => {
    expect(isPromiseOnly('<message to="nick">Let me check the plotter status for you.</message>', 1)).toBe(false);
  });

  it('ignores a real answer after tool calls that ends with an offer', () => {
    expect(isPromiseOnly("The plotter is offline: the Pi is unreachable. I'll check again later if you want.", 2)).toBe(
      false,
    );
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

describe('plainReplyText', () => {
  it('keeps a plain reply', () => {
    expect(plainReplyText('Hey! 👋 Good to chat. What is on your mind? 🍋')).toBe(
      'Hey! 👋 Good to chat. What is on your mind? 🍋',
    );
  });
  it('drops internal notes and stray tags', () => {
    expect(plainReplyText('<internal>thinking</internal>The plotter is offline.')).toBe('The plotter is offline.');
  });
  it('unwraps a hand-written send_message block', () => {
    expect(plainReplyText('<send_message> <to>nick</to> Got it, updated. </send_message>')).toBe('Got it, updated.');
  });
  it('never delivers botched tool calls', () => {
    expect(plainReplyText('<Skill> <skill>plotter</skill> <args>{}</args> </Skill>')).toBe('');
  });
  it('returns empty for internal-only output', () => {
    expect(plainReplyText('<internal>nothing to send</internal>')).toBe('');
  });
});

describe('isUnbackedClaim', () => {
  it('flags the 2026-10-11 eval reply', () => {
    expect(
      isUnbackedClaim('<message to="nick">Got it — 3 SR44 spares for the laser level logged 🍋</message>', 0),
    ).toBe(true);
  });
  it('never flags a turn that called tools', () => {
    expect(isUnbackedClaim('Updated the count to 3.', 2)).toBe(false);
  });
  it('ignores plain conversation', () => {
    expect(isUnbackedClaim('Nice! What is on your mind?', 0)).toBe(false);
  });
});

describe('isFakeToolCall', () => {
  it('flags a skill call typed as text (clean-x2, Sun card)', () => {
    expect(isFakeToolCall('<skill name="plotter">Sun card</skill>', 0)).toBe(true);
  });

  it('ignores markup once a real tool ran', () => {
    expect(isFakeToolCall('<skill name="plotter">Sun card</skill>', 1)).toBe(false);
  });

  it('ignores ordinary replies', () => {
    expect(isFakeToolCall('<message to="nick">Which Sun card, the 70 x 120 one?</message>', 0)).toBe(false);
  });
});

describe('isSilentTurn', () => {
  it('flags an internal-only turn with no tools and nothing sent', () => {
    expect(isSilentTurn(0, false)).toBe(true);
  });

  it('accepts a turn that sent something', () => {
    expect(isSilentTurn(0, true)).toBe(false);
  });

  it('accepts a turn that ran tools', () => {
    expect(isSilentTurn(2, false)).toBe(false);
  });
});
