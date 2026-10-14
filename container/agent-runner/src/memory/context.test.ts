import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import fs from 'fs';
import path from 'path';

import { MEMORY_FILE_BUDGET_CHARS, MEMORY_TRUNCATION_NOTICE, ROLLUP_BLOCK_CAP_CHARS, renderMemorySection } from './context.js';

const BASE = '/tmp/nanoclaw-memory-context-test';

function writeMemoryTree(index: string, definition: string): void {
  fs.mkdirSync(path.join(BASE, 'memory', 'system'), { recursive: true });
  fs.writeFileSync(path.join(BASE, 'memory', 'index.md'), index);
  fs.writeFileSync(path.join(BASE, 'memory', 'system', 'definition.md'), definition);
}

beforeEach(() => {
  fs.rmSync(BASE, { recursive: true, force: true });
  fs.mkdirSync(BASE, { recursive: true });
});

afterEach(() => fs.rmSync(BASE, { recursive: true, force: true }));

describe('renderMemorySection', () => {
  it('inlines existing untyped memory without blocking it', () => {
    writeMemoryTree('# Memory Index\n- [Casa](projects/casa.md)\n', 'custom doctrine\n');

    const section = renderMemorySection(BASE);

    expect(section).toContain('## Memory');
    expect(section).toContain('files on disk are authoritative');
    expect(section).toContain('Open Knowledge Format (OKF) v0.1 bundle');
    expect(section).toContain('- [Casa](projects/casa.md)');
    expect(section).toContain('custom doctrine');
  });

  it('degrades without throwing when a file is missing', () => {
    fs.mkdirSync(path.join(BASE, 'memory'), { recursive: true });
    fs.writeFileSync(path.join(BASE, 'memory', 'index.md'), '# Memory Index\n');

    expect(renderMemorySection(BASE)).toContain('unavailable during this hook invocation');
  });

  it('truncates each file independently without splitting a surrogate pair', () => {
    const prefix = 'x'.repeat(MEMORY_FILE_BUDGET_CHARS - 1);
    writeMemoryTree(`${prefix}\ud83d\ude00tail`, 'y'.repeat(MEMORY_FILE_BUDGET_CHARS + 1));

    const section = renderMemorySection(BASE);

    expect(section.match(/\[truncated:/g)).toHaveLength(2);
    expect(section).toContain(MEMORY_TRUNCATION_NOTICE);
    expect(section).not.toContain('\ud83d\n');
  });

  describe('core memory gauge', () => {
    const begin = '<!-- lemon-memory-rollup:begin (generated nightly; edits here are overwritten) -->';
    const end = '<!-- lemon-memory-rollup:end -->';

    afterEach(() => {
      delete process.env.NANOCLAW_MEMORY_CORE_CAP;
    });

    it('shows fill for agent-edited text and the rollup size separately', () => {
      const rollup = `${begin}\n${'r'.repeat(100)}\n${end}`;
      const core = '# Memory Index\n' + 'c'.repeat(1000);
      writeMemoryTree(`${core}\n\n${rollup}\n`, 'def');

      const section = renderMemorySection(BASE);

      expect(section).toMatch(/Core memory: \d+% - 1,0\d\d\/2,200 chars/);
      expect(section).toContain(`Recent-days block: ${rollup.length} chars`);
      expect(section).not.toContain('consolidate');
      expect(section).toContain('r'.repeat(100));
    });

    it('over cap still renders all text and asks to consolidate', () => {
      process.env.NANOCLAW_MEMORY_CORE_CAP = '100';
      writeMemoryTree('fact '.repeat(60), 'def');

      const section = renderMemorySection(BASE);

      expect(section).toContain('Core memory: 300% - 299/100 chars');
      expect(section).toContain('consolidate Core Memory below 100 chars');
      expect(section).toContain('fact '.repeat(59));
      expect(section).not.toContain('Recent-days');
    });

    it('caps an oversized rollup block without touching core text', () => {
      writeMemoryTree(`core line\n${begin}\n${'z'.repeat(ROLLUP_BLOCK_CAP_CHARS + 500)}\n${end}`, 'def');

      const section = renderMemorySection(BASE);

      expect(section).toContain('core line');
      expect(section).toContain('[truncated rollup]');
      expect(section).toContain(end);
      expect(section).not.toContain('z'.repeat(ROLLUP_BLOCK_CAP_CHARS + 1));
    });

    it('omits the gauge when index.md is unavailable', () => {
      fs.mkdirSync(path.join(BASE, 'memory'), { recursive: true });
      expect(renderMemorySection(BASE)).not.toContain('Core memory:');
    });
  });
});
