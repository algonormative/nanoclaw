import fs from 'fs';
import path from 'path';

export const MEMORY_FILE_BUDGET_CHARS = 16_000;
export const MEMORY_TRUNCATION_NOTICE = '[truncated: slim this file and move detail into linked memory files]';

export const CORE_MEMORY_CAP_DEFAULT = 2_200;
export const ROLLUP_BLOCK_CAP_CHARS = 6_000;
const ROLLUP_RE = /<!-- lemon-memory-rollup:begin[^>]*-->[\s\S]*?<!-- lemon-memory-rollup:end -->/;

function coreCap(): number {
  const n = Number(process.env.NANOCLAW_MEMORY_CORE_CAP);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : CORE_MEMORY_CAP_DEFAULT;
}

/**
 * Gauge for index.md: the agent-edited part (everything outside the host-written
 * rollup block) against a cap, plus the rollup block size. Over-cap content is
 * still shown; the notice asks the agent to consolidate.
 */
export function memoryGauge(index: string, cap = coreCap()): { text: string; indexForRender: string } {
  const m = ROLLUP_RE.exec(index);
  const block = m ? m[0] : '';
  const core = (m ? index.replace(block, '') : index).trim();
  const fmt = (n: number) => n.toLocaleString('en-US');
  const used = core.length;
  const lines = [`Core memory: ${Math.round((used / cap) * 100)}% - ${fmt(used)}/${fmt(cap)} chars`];
  if (used > cap) lines.push(`Over the cap: consolidate Core Memory below ${fmt(cap)} chars before adding more.`);
  let indexForRender = index;
  if (m) {
    lines.push(`Recent-days block: ${fmt(block.length)} chars (host-written)`);
    if (block.length > ROLLUP_BLOCK_CAP_CHARS) {
      const cut = `${block.slice(0, ROLLUP_BLOCK_CAP_CHARS)}\n[truncated rollup]\n<!-- lemon-memory-rollup:end -->`;
      indexForRender = index.replace(block, () => cut);
    }
  }
  return { text: lines.join('\n'), indexForRender };
}

/**
 * Render the two always-loaded memory files inside the container. Host-side
 * composers never read agent-controlled memory.
 */
export function renderMemorySection(baseDir = '/workspace/agent'): string {
  const memoryDir = path.join(baseDir, 'memory');
  const rawIndex = readMemoryFile(path.join(memoryDir, 'index.md'));
  const gauge = memoryGauge(rawIndex);
  const index = readMemoryFile(path.join(memoryDir, 'index.md'), gauge.indexForRender);
  const definition = readMemoryFile(path.join(memoryDir, 'system', 'definition.md'));

  return [
    '## Memory',
    '',
    'These files are loaded at startup, after clear, and after compaction:',
    '',
    '- `/workspace/agent/memory/index.md` - top-level memory index and Core Memory',
    '- `/workspace/agent/memory/system/definition.md` - memory system behavior',
    '',
    'The files on disk are authoritative. Edit them directly; follow links from',
    'the index when more detail is relevant.',
    '',
    '`memory/` is an Open Knowledge Format (OKF) v0.1 bundle: one Markdown',
    'concept per file, opened by a short YAML frontmatter with a `type`',
    '(`index.md` and `log.md` are exempt; see the definition).',
    '',
    '### memory/index.md',
    '',
    ...(rawIndex.startsWith('(unavailable') ? [] : [gauge.text, '']),
    index,
    '',
    '### memory/system/definition.md',
    '',
    definition,
    '',
  ].join('\n');
}

function readMemoryFile(filePath: string, override?: string): string {
  let content: string;
  try {
    content = (override ?? fs.readFileSync(filePath, 'utf-8')).trim();
  } catch {
    return '(unavailable during this hook invocation)';
  }
  if (content.length <= MEMORY_FILE_BUDGET_CHARS) return content;

  let truncated = content.slice(0, MEMORY_FILE_BUDGET_CHARS);
  const last = truncated.charCodeAt(truncated.length - 1);
  if (last >= 0xd800 && last <= 0xdbff) truncated = truncated.slice(0, -1);
  return `${truncated}\n${MEMORY_TRUNCATION_NOTICE}`;
}
