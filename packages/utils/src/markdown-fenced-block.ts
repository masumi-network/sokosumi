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
 * line, and closes on a run of exactly as many backticks. The info string
 * holds no backtick: markdown reads `` ``` `x `` as the start of a paragraph,
 * so what follows it is markup rather than code.
 *
 * The rule is narrower than markdown's on purpose, and it still reads a fence
 * where markdown reads none: under an HTML block that no blank line has
 * closed, the lines are raw HTML. So nothing may rely on this rule to decide
 * what is safe to render. The room sanitizes the parsed tree for that.
 */
export const MARKDOWN_FENCED_BLOCK_REGEX =
  /(^|\n)(`{3,})([^`\n]*)\n([\s\S]*?)\n\2(?=\n|$)/g;
