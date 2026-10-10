/**
 * Model router — picks which brain a container run gets.
 *
 * Every run goes through core.llm-proxy (LiteLLM) using Anthropic-format
 * model groups, so the agent never knows which backend answered:
 *
 *   lemon-local  → Ollama on the mini (no cost)
 *   lemon-cloud  → OpenRouter (cheap open-weight models, credit-capped)
 *   lemon-claude → Anthropic direct (proxy falls back to cloud → local on error)
 *   lemon-small  → small local model for Claude Code's background/haiku slot
 *
 * LEMON_MODEL_MODE picks the tier: a fixed tier, or `router`, where a judge
 * (TypeSafe Jev to start) reads the prompt and chooses one. The judge is an
 * interface so a local Jev-like model can replace it later.
 */
import { readEnvFile } from './env.js';
import { logger } from './logger.js';

export const MODEL_TIERS = ['local', 'cloud', 'claude'] as const;
export type ModelTier = (typeof MODEL_TIERS)[number];
export type ModelMode = ModelTier | 'router';

export interface TierJudgement {
  tier: ModelTier;
  confidence: number;
  probabilities: Record<string, number>;
}

export interface TierJudge {
  name: string;
  judge(prompt: string, signal: AbortSignal): Promise<TierJudgement>;
}

export interface RouteDecision {
  tier: ModelTier;
  model: string;
  smallModel: string;
  /** How the tier was chosen: fixed by mode, by the judge, or the judge failed. */
  source: 'mode' | 'judge' | 'judge-failed';
  judge?: string;
  judgedTier?: ModelTier;
  confidence?: number;
  probabilities?: Record<string, number>;
  latencyMs?: number;
  error?: string;
}

export interface RouterConfig {
  mode: ModelMode;
  /** Tier used when the judge errors or times out. */
  defaultTier: ModelTier;
  /** Cost ceiling: the judge can never pick a tier above this. */
  maxTier: ModelTier;
  timeoutMs: number;
  judge: string;
  typesafeApiKey?: string;
}

const TIER_RANK: Record<ModelTier, number> = { local: 0, cloud: 1, claude: 2 };

function isTier(value: string | undefined): value is ModelTier {
  return (MODEL_TIERS as readonly string[]).includes(value ?? '');
}

export function loadRouterConfig(
  env: Record<string, string | undefined> = readEnvFile([
    'LEMON_MODEL_MODE',
    'LEMON_ROUTER_DEFAULT_TIER',
    'LEMON_ROUTER_MAX_TIER',
    'LEMON_ROUTER_TIMEOUT_MS',
    'LEMON_ROUTER_JUDGE',
    'TYPESAFE_API_KEY',
  ]),
): RouterConfig {
  const rawMode = env.LEMON_MODEL_MODE?.trim();
  let mode: ModelMode = 'local';
  if (rawMode === 'router' || isTier(rawMode)) {
    mode = rawMode;
  } else if (rawMode) {
    logger.warn({ value: rawMode }, 'Unknown LEMON_MODEL_MODE — using local');
  }
  const defaultTier = isTier(env.LEMON_ROUTER_DEFAULT_TIER)
    ? env.LEMON_ROUTER_DEFAULT_TIER
    : 'local';
  const maxTier = isTier(env.LEMON_ROUTER_MAX_TIER)
    ? env.LEMON_ROUTER_MAX_TIER
    : 'cloud';
  const timeoutMs = Number(env.LEMON_ROUTER_TIMEOUT_MS) || 3000;
  return {
    mode,
    defaultTier,
    maxTier,
    timeoutMs,
    judge: env.LEMON_ROUTER_JUDGE?.trim() || 'jev',
    typesafeApiKey: env.TYPESAFE_API_KEY,
  };
}

export function modelForTier(tier: ModelTier): string {
  return `lemon-${tier}`;
}

export const SMALL_MODEL = 'lemon-small';

// Long scheduled-task prompts carry boilerplate up front; the ask is at the end.
const JUDGE_PROMPT_CHARS = 4000;

/** TypeSafe Jev: one Choice question over the incoming prompt. */
export class JevJudge implements TierJudge {
  name = 'jev';

  constructor(
    private apiKey: string,
    private endpoint = 'https://api.typesafe.ai/v1/systemone',
  ) {}

  async judge(prompt: string, signal: AbortSignal): Promise<TierJudgement> {
    const res = await fetch(this.endpoint, {
      method: 'POST',
      signal,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'jev-latest',
        state: { request: prompt.slice(-JUDGE_PROMPT_CHARS) },
        questions: {
          tier: {
            type: 'choice',
            instructions:
              'A personal assistant agent with shell, file and git tools is about to handle `request`. Which model tier does the work need?',
            criteria: {
              local:
                'Routine: a short conversational reply, filing or acknowledging a note, a simple lookup or single-file read, or a scheduled check that follows explicit steps.',
              cloud:
                'Moderate: several tool calls, summarizing or synthesizing multiple files, writing more than a short paragraph, or carefully editing vault files.',
              claude:
                'Hard: code changes, debugging, open-ended planning, sensitive judgment, or work where a mistake would be costly.',
            },
          },
        },
      }),
    });
    if (!res.ok) {
      throw new Error(`TypeSafe HTTP ${res.status}`);
    }
    const data = (await res.json()) as {
      answers?: {
        tier?: {
          choice?: string;
          confidence?: number;
          probabilities?: Record<string, number>;
        };
      };
    };
    const answer = data.answers?.tier;
    if (!answer || !isTier(answer.choice)) {
      throw new Error(`TypeSafe returned no usable tier: ${answer?.choice}`);
    }
    return {
      tier: answer.choice,
      confidence: answer.confidence ?? 0,
      probabilities: answer.probabilities ?? {},
    };
  }
}

function buildJudge(config: RouterConfig): TierJudge | undefined {
  if (config.judge === 'jev' && config.typesafeApiKey) {
    return new JevJudge(config.typesafeApiKey);
  }
  return undefined;
}

function decision(
  tier: ModelTier,
  extra: Partial<RouteDecision> & Pick<RouteDecision, 'source'>,
): RouteDecision {
  return { tier, model: modelForTier(tier), smallModel: SMALL_MODEL, ...extra };
}

export async function resolveModelRoute(
  prompt: string,
  config: RouterConfig = loadRouterConfig(),
  judge: TierJudge | undefined = buildJudge(config),
): Promise<RouteDecision> {
  if (config.mode !== 'router') {
    return decision(config.mode, { source: 'mode' });
  }
  if (!judge) {
    return decision(config.defaultTier, {
      source: 'judge-failed',
      error: `judge "${config.judge}" unavailable (missing key or unknown judge)`,
    });
  }

  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    const verdict = await judge.judge(prompt, controller.signal);
    const capped =
      TIER_RANK[verdict.tier] > TIER_RANK[config.maxTier]
        ? config.maxTier
        : verdict.tier;
    return decision(capped, {
      source: 'judge',
      judge: judge.name,
      judgedTier: verdict.tier,
      confidence: verdict.confidence,
      probabilities: verdict.probabilities,
      latencyMs: Date.now() - started,
    });
  } catch (err) {
    return decision(config.defaultTier, {
      source: 'judge-failed',
      judge: judge.name,
      latencyMs: Date.now() - started,
      error: err instanceof Error ? err.message : String(err),
    });
  } finally {
    clearTimeout(timer);
  }
}

/** Container env that points Claude Code at the chosen proxy model groups. */
export function modelEnvArgs(route: RouteDecision): string[] {
  return [
    '-e',
    `ANTHROPIC_MODEL=${route.model}`,
    '-e',
    `ANTHROPIC_SMALL_FAST_MODEL=${route.smallModel}`,
    '-e',
    `ANTHROPIC_DEFAULT_HAIKU_MODEL=${route.smallModel}`,
  ];
}
