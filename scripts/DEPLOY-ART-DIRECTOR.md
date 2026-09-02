# Deploy: Lemon Chan Art Director

Steps to enable plotter art generation from NanoClaw on the Mac Mini.

## 1. Clone hatch3d on the Mac Mini

```bash
ssh lemon-chan
cd ~/git
git clone git@github.com:algonormative/hatch3d.git
cd hatch3d
npm install
```

## 2. Install mount allowlist

```bash
mkdir -p ~/.config/nanoclaw
cp ~/git/nanoclaw/config/mount-allowlist.json ~/.config/nanoclaw/mount-allowlist.json
```

## 3. Register hatch3d mount on telegram_nick group

From Lemon Chan's main group chat (or via SQLite directly):

```sql
-- Update container_config for telegram_nick group
UPDATE registered_groups
SET container_config = json_set(
  COALESCE(container_config, '{}'),
  '$.additionalMounts',
  json('[{"hostPath":"~/git/hatch3d","containerPath":"hatch3d","readonly":true}]')
)
WHERE folder = 'telegram_nick';
```

Or via IPC from main group — ask Lemon Chan to re-register the group with the mount added.

## 4. Verify the mount works

Send Lemon Chan a message: "list files in /workspace/extra/hatch3d/"

Should see: package.json, cli/, src/, data/, etc.

## 5. Schedule daily art generation

Ask Lemon Chan (from main group):

> Schedule a cron task for telegram_nick: every day at 6am, run the plotter art generation.
> Prompt: "The plotter art generation task has fired. Read the guard script data, then run feed-push with the brief. Tell me what you queued."
> Script: contents of scripts/generate-plotter-art.sh
> Context mode: isolated

Or create directly via IPC.

## 6. Test interactive mode

Send Lemon Chan: "make me some plotter art"

Should: read preference model, craft a brief, run feed-push, report what was queued.
