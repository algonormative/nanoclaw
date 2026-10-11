/**
 * Lemon Chan container extras, ported from the v1 fork's container-runner:
 *
 * - git push over SSH with the lemon-chan-automation key. `.ssh` paths are
 *   hard-blocked by mount security, so the key lives in its own read-only dir
 *   (~/.config/lemon-git, allowlisted) and GIT_SSH_COMMAND points at it.
 *   The dir is mounted as a group config mount (`ncl groups config add-mount
 *   --host ~/.config/lemon-git --container lemon-git --ro`). Providers with a
 *   host contract (claude) silently drop contributed mounts (see
 *   container-runner buildMounts), while contributed env still applies. The
 *   key was missing from v2 containers until 2026-10-11 for that reason.
 * - Linux tools for the agent (br) from ~/.config/lemon-bin, mounted the
 *   same way at /workspace/extra/lemon-bin and put first on PATH.
 * - a writable copy of the host ~/.gitconfig in the group dir (git rewrites
 *   its config atomically, which a single-file bind mount can't take).
 * - the proxy URL vault scripts inside the container use (the key itself
 *   is injected by OneCLI on the wire).
 */
import fs from 'fs';
import os from 'os';
import path from 'path';

import { log } from '../log.js';
import type { ProviderContainerContext, ProviderContainerContribution } from './provider-container-registry.js';

const GIT_KEY_DIR = path.join(os.homedir(), '.config', 'lemon-git');
const GIT_KEY_MOUNT = '/workspace/extra/lemon-git'; // group config mount
const BIN_DIR = path.join(os.homedir(), '.config', 'lemon-bin');
const BIN_MOUNT = '/workspace/extra/lemon-bin'; // group config mount
// The agent image's PATH, with BIN_MOUNT in front.
const IMAGE_PATH = '/pnpm:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin';

export function lemonContribution(ctx: ProviderContainerContext): ProviderContainerContribution {
  const env: Record<string, string> = {};
  const mounts: NonNullable<ProviderContainerContribution['mounts']> = [];

  if (fs.existsSync(path.join(GIT_KEY_DIR, 'id_lemon'))) {
    env.GIT_SSH_COMMAND = `ssh -F /dev/null -i ${GIT_KEY_MOUNT}/id_lemon -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null`;
  }

  if (fs.existsSync(path.join(BIN_DIR, 'br'))) {
    env.PATH = `${BIN_MOUNT}:${IMAGE_PATH}`;
  }

  const hostGitconfig = path.join(os.homedir(), '.gitconfig');
  if (fs.existsSync(hostGitconfig)) {
    try {
      fs.copyFileSync(hostGitconfig, path.join(ctx.groupDir, '.gitconfig'));
      env.GIT_CONFIG_GLOBAL = '/workspace/agent/.gitconfig';
    } catch (err) {
      log.warn('lemon: could not copy .gitconfig into group dir', { err });
    }
  }

  // v2 denies credential values in contributed env; OneCLI injects the proxy
  // key for every request to host.docker.internal, so vault scripts get a
  // placeholder they send and the gateway overwrites on the wire.
  env.LITELLM_KEY_VAULT_SCRIPTS = 'gateway-managed';
  env.LLM_PROXY_URL = 'http://host.docker.internal:8090';

  return { env, mounts };
}
