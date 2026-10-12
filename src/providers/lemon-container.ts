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
 *   ssh also refuses to run for a uid with no passwd entry ("No user exists
 *   for uid 501"), and the agent image has none for the host uid. nss_wrapper
 *   (apt libnss-wrapper, a group package next to openssh-client) supplies one
 *   to ssh alone, from a one-line passwd file written into the group dir at
 *   spawn. (br stays out of the container: SQLite WAL over the Docker Desktop
 *   file share corrupts the host's beads.db.)
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
const NSS_PASSWD = '.nss-passwd'; // in the group dir, read by nss_wrapper

export function lemonContribution(ctx: ProviderContainerContext): ProviderContainerContribution {
  const env: Record<string, string> = {};
  const mounts: NonNullable<ProviderContainerContribution['mounts']> = [];

  if (fs.existsSync(path.join(GIT_KEY_DIR, 'id_lemon'))) {
    const uid = process.getuid?.() ?? 1000;
    const gid = process.getgid?.() ?? 1000;
    try {
      fs.writeFileSync(path.join(ctx.groupDir, NSS_PASSWD), `node:x:${uid}:${gid}:node:/home/node:/bin/sh\n`);
    } catch (err) {
      log.warn('lemon: could not write nss passwd file', { err });
    }
    const nss = `LD_PRELOAD=libnss_wrapper.so NSS_WRAPPER_PASSWD=/workspace/agent/${NSS_PASSWD} NSS_WRAPPER_GROUP=/etc/group`;
    env.GIT_SSH_COMMAND = `env ${nss} ssh -F /dev/null -i ${GIT_KEY_MOUNT}/id_lemon -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null`;
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
  // Lemon's model (`lemon-auto`) is unknown to Claude Code. Two corrections:
  // (1) cap output at 8k so the autocompact buffer is 21k instead of 33k;
  // (2) the window is in CLAUDE CODE's token estimate, which runs ~1.5x the
  // local model's (qwen) count. A fresh session is ~31k qwen tokens but
  // ~48k by Claude Code's estimate. 65536 compacted every turn and broke
  // continuity (2026-10-11 evals). 98304 compacts near 77k by Claude Code's
  // estimate, about 50k real, inside Ollama's 65536. (vault-2gthr)
  env.CLAUDE_CODE_MAX_CONTEXT_TOKENS = '98304';
  env.CLAUDE_CODE_MAX_OUTPUT_TOKENS = '8000';

  env.LITELLM_KEY_VAULT_SCRIPTS = 'gateway-managed';
  env.LLM_PROXY_URL = 'http://host.docker.internal:8090';

  return { env, mounts };
}
