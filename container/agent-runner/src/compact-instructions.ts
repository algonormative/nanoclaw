/**
 * PreCompact hook script — outputs custom compaction instructions to stdout.
 *
 * Claude Code captures the stdout of PreCompact shell hooks and passes it
 * as `customInstructions` to the compaction prompt. This ensures the
 * compaction summary preserves message routing context that the agent needs
 * to correctly address responses.
 *
 * Invoked by the PreCompact hook in .claude-shared/settings.json:
 *   "command": "bun /app/src/compact-instructions.ts"
 */
import { getAllDestinations } from './destinations.js';
import { getTaskSeriesId } from './db/session-routing.js';

/**
 * The canonical delivery-discipline sentences, shared by the pre-compaction
 * steering below and the post-compaction reminder some providers inject when
 * their runtime offers no compaction-prompt hook. Core owns this wording;
 * providers must not restate it in their own words.
 */
export function buildDeliverySentences(names: string[], taskId: string | null): string[] {
  return taskId
    ? [
        'This is an isolated task run. If you need to send the user a message, use send_message with an explicit to destination.',
        `Final output is not delivered; it becomes the automatic summary in tasks/${taskId}.md.`,
        `Available destinations: ${formatDestinationNames(names)}.`,
      ]
    : [
        'You MUST wrap all responses in <message to="name">...</message> blocks.',
        `Available destinations: ${formatDestinationNames(names)}.`,
      ];
}

/**
 * Reminder a provider injects on the first prompt AFTER its runtime
 * auto-compacted the session, for runtimes that expose no
 * pre-compaction instruction hook: the summary can silently drop the delivery
 * discipline, so it is re-stated — in the same canonical wording as the
 * pre-compaction path — before the next turn.
 */
export function buildPostCompactionReminder(names: string[], taskId: string | null): string {
  return (
    '<system>The conversation was just compacted into a summary. Delivery instructions can be lost in ' +
    `that summary, so as a reminder: ${buildDeliverySentences(names, taskId).join(' ')}</system>`
  );
}

const STRUCTURED_SECTIONS = [
  '   ## Goal - what the user is trying to achieve',
  '   ## Constraints & preferences - rules and tastes the user stated',
  '   ## Progress - done / in progress / blocked',
  '   ## Decisions - choices made, with the reason',
  '   ## Files & ids touched - seed slugs, task ids, commit hashes, paths',
  '   ## Open threads & promises - anything owed to the user or awaiting a reply',
  '   ## Next - the immediate next step',
  '   ## Critical context - anything else needed to continue correctly',
];

export function buildCompactInstructions(names: string[], taskId: string | null): string {
  const sentences = buildDeliverySentences(names, taskId);
  const deliveryReminder = sentences.map(
    (sentence, index) =>
      `   ${index === 0 ? '"' : ''}${sentence}${index === sentences.length - 1 ? '"' : ''}`,
  );

  return [
    'Preserve the following in the compaction summary:',
    '',
    '1. For recent messages, keep the full XML structure including all attributes:',
    '   - <message from="..." sender="..." time="..."> for chat messages',
    '   - <task from="..." time="..." current_time="..."> for scheduled tasks',
    '   - <webhook from="..." source="..." event="..."> for webhooks',
    '   The message content can be summarized if long, but the XML tags and attributes must remain.',
    '',
    '2. Preserve the chronological message/reply sequence of recent exchanges.',
    '   The agent needs to see: who said what, in what order, and from which destination.',
    '',
    '3. Write the summary with these sections, in order, omitting none:',
    ...STRUCTURED_SECTIONS,
    '',
    '4. Compress old material hard: drop old tool output or reduce it to a one-line conclusion',
    '   (what was run, what it showed). Keep exact ids, names, slugs, hashes and paths verbatim.',
    '   If the conversation already starts with a previous compaction summary, UPDATE it:',
    '   keep its sections, add new progress and decisions, and drop what is resolved;',
    '   do not restate it from scratch.',
    '',
    '5. At the END of the compaction summary, include this verbatim reminder:',
    ...deliveryReminder,
  ].join('\n');
}

function formatDestinationNames(names: string[]): string {
  return names.length > 0 ? names.map((name) => `\`${name}\``).join(', ') : '(none)';
}

if (import.meta.main) {
  const names = getAllDestinations().map((destination) => destination.name);
  console.log(buildCompactInstructions(names, getTaskSeriesId()));
}
