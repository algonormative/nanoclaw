import { describe, expect, it, vi } from 'vitest';

import {
  JevJudge,
  loadRouterConfig,
  modelEnvArgs,
  resolveModelRoute,
  RouterConfig,
  TierJudge,
} from './model-router.js';

const base: RouterConfig = {
  mode: 'router',
  defaultTier: 'local',
  maxTier: 'cloud',
  timeoutMs: 50,
  judge: 'jev',
};

function stubJudge(impl: TierJudge['judge']): TierJudge {
  return { name: 'stub', judge: impl };
}

describe('loadRouterConfig', () => {
  it('defaults to local mode with a cloud ceiling', () => {
    const cfg = loadRouterConfig({});
    expect(cfg.mode).toBe('local');
    expect(cfg.defaultTier).toBe('local');
    expect(cfg.maxTier).toBe('cloud');
    expect(cfg.timeoutMs).toBe(3000);
  });

  it('falls back to local on an unknown mode', () => {
    expect(loadRouterConfig({ LEMON_MODEL_MODE: 'gpt' }).mode).toBe('local');
  });

  it('reads router settings', () => {
    const cfg = loadRouterConfig({
      LEMON_MODEL_MODE: 'router',
      LEMON_ROUTER_DEFAULT_TIER: 'cloud',
      LEMON_ROUTER_MAX_TIER: 'claude',
      LEMON_ROUTER_TIMEOUT_MS: '1500',
    });
    expect(cfg).toMatchObject({
      mode: 'router',
      defaultTier: 'cloud',
      maxTier: 'claude',
      timeoutMs: 1500,
    });
  });
});

describe('resolveModelRoute', () => {
  it('uses the fixed tier without asking the judge', async () => {
    const judge = vi.fn();
    const route = await resolveModelRoute(
      'hi',
      { ...base, mode: 'cloud' },
      stubJudge(judge),
    );
    expect(route).toMatchObject({
      tier: 'cloud',
      model: 'lemon-cloud',
      source: 'mode',
    });
    expect(judge).not.toHaveBeenCalled();
  });

  it('takes the judged tier', async () => {
    const route = await resolveModelRoute(
      'hi',
      base,
      stubJudge(async () => ({
        tier: 'cloud',
        confidence: 0.8,
        probabilities: {},
      })),
    );
    expect(route).toMatchObject({
      tier: 'cloud',
      source: 'judge',
      judgedTier: 'cloud',
    });
  });

  it('caps the judged tier at maxTier', async () => {
    const route = await resolveModelRoute(
      'fix the bug',
      base,
      stubJudge(async () => ({
        tier: 'claude',
        confidence: 0.9,
        probabilities: {},
      })),
    );
    expect(route.tier).toBe('cloud');
    expect(route.judgedTier).toBe('claude');
  });

  it('uses the default tier when the judge throws', async () => {
    const route = await resolveModelRoute(
      'hi',
      { ...base, defaultTier: 'cloud' },
      stubJudge(async () => {
        throw new Error('boom');
      }),
    );
    expect(route).toMatchObject({
      tier: 'cloud',
      source: 'judge-failed',
      error: 'boom',
    });
  });

  it('uses the default tier when the judge times out', async () => {
    const route = await resolveModelRoute(
      'hi',
      base,
      stubJudge(
        (_prompt, signal) =>
          new Promise((_resolve, reject) =>
            signal.addEventListener('abort', () =>
              reject(new Error('aborted')),
            ),
          ),
      ),
    );
    expect(route).toMatchObject({ tier: 'local', source: 'judge-failed' });
  });

  it('uses the default tier when no judge is configured', async () => {
    const route = await resolveModelRoute('hi', base, undefined);
    expect(route).toMatchObject({ tier: 'local', source: 'judge-failed' });
  });
});

describe('JevJudge', () => {
  it('parses a choice answer and sends only the prompt tail', async () => {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string);
      expect(body.state.request.length).toBe(4000);
      return new Response(
        JSON.stringify({
          answers: {
            tier: {
              choice: 'local',
              confidence: 0.9,
              probabilities: { local: 0.95 },
            },
          },
        }),
      );
    });
    vi.stubGlobal('fetch', fetchMock);
    try {
      const verdict = await new JevJudge('k').judge(
        'x'.repeat(9000),
        new AbortController().signal,
      );
      expect(verdict).toEqual({
        tier: 'local',
        confidence: 0.9,
        probabilities: { local: 0.95 },
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('rejects an unknown choice', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({ answers: { tier: { choice: 'gpt' } } }),
          ),
      ),
    );
    try {
      await expect(
        new JevJudge('k').judge('hi', new AbortController().signal),
      ).rejects.toThrow(/no usable tier/);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('modelEnvArgs', () => {
  it('sets the main and small model slots', () => {
    expect(
      modelEnvArgs({
        tier: 'local',
        model: 'lemon-local',
        smallModel: 'lemon-small',
        source: 'mode',
      }),
    ).toEqual([
      '-e',
      'ANTHROPIC_MODEL=lemon-local',
      '-e',
      'ANTHROPIC_SMALL_FAST_MODEL=lemon-small',
      '-e',
      'ANTHROPIC_DEFAULT_HAIKU_MODEL=lemon-small',
    ]);
  });
});
