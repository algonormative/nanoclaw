/**
 * Lemon Chan container extras, ported from the v1 fork's container-runner:
 *
 * - git push over SSH with the lemon-chan-automation key. `.ssh` paths are
 *   hard-blocked by mount security, so the key lives in its own read-only dir
 *   (~/.config/lemon-git, allowlisted) and GIT_SSH_COMMAND points at it.
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
const GIT_KEY_MOUNT = '/home/node/.lemon-git';

export function lemonContribution(ctx: ProviderContainerContext): ProviderContainerContribution {
  const env: Record<string, string> = {};
  const mounts: NonNullable<ProviderContainerContribution['mounts']> = [];

  if (fs.existsSync(path.join(GIT_KEY_DIR, 'id_lemon'))) {
    mounts.push({ hostPath: GIT_KEY_DIR, containerPath: GIT_KEY_MOUNT, readonly: true });
    env.GIT_SSH_COMMAND = `ssh -F /dev/null -i ${GIT_KEY_MOUNT}/id_lemon -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null`;
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
