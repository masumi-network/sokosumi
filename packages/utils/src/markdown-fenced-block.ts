/**
 * A fenced code block, as the chat room finds one.
 *
 * The room lifts these out of a message before it sanitizes the rest and puts
 * them back afterwards, so what is written inside one is text the room prints
 * rather than markup the room acts on. Anything that reads a message body for
 * markup has to agree with the room about where a fence begins and ends. A
 * looser rule reads the room's text as markup: `` ```<script>``` `` on one
 * line is a code span to the room, and a reader that takes it for a fence
 * consumes the opening tag and then shows the words the room throws away.
 *
 * A fence opens on its own line, carries an info string to the end of that
 * line, and closes on a run of exactly as many backticks.
 */
export const MARKDOWN_FENCED_BLOCK_REGEX =
  /(^|\n)(`{3,})([^\n]*)\n([\s\S]*?)\n\2(?=\n|$)/g;
