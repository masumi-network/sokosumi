import { cleanChatMessageText } from "./chat-room-quote-snippet.js";
import { MARKDOWN_FENCED_BLOCK_REGEX } from "./markdown-fenced-block.js";

/**
 * Persisted mention token `@key:slug`.
 *
 * The key is a uuid (users, coworkers and soko bots all carry one) or the
 * room-wide `all`. Nothing else, because the room rewrites a token only when
 * its key names someone in the room and leaves every other `word:word` as
 * written. A looser rule here eats the middle of ordinary text: `@10:30am` is
 * a time, and `git@github.com:org/repo.git` is an address.
 */
const MENTION_TOKEN_REGEX =
  /@([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}|all):(\S+)/g;

/** The `!` of `![alt](url)`, which the link scan leaves behind on its own. */
const MARKDOWN_IMAGE_BANG_REGEX = /!(?=\[[^\][]*\]\()/g;

/**
 * `![](url)` and `[](url)`. The link scan wants a label and finds none, so
 * without this the url itself is left standing where the words should be.
 */
const EMPTY_LABEL_LINK_REGEX = /!?\[\]\([^)]*\)/g;

/**
 * A named tag: `<b>`, `</b>`, `<img src="x">`, `<br/>`, `<x:a-b>`.
 *
 * A name starts with a letter and then runs to whitespace or `>`, which is
 * where the room's parser ends one. Reading a narrower name leaves the rest
 * standing as words, and the name is the writer's to choose: the room shows
 * nothing at all for `<call.555-0100.to.unlock.your.account>`, because it
 * drops the tag it does not know.
 *
 * A quoted attribute value runs to its closing quote, `>` included, for the
 * same reason. The room shows `link` for
 * `<a href="https://e.test/?q=>pay me">link</a>`, and so must this.
 *
 * The leading letter is what keeps `x < 10` a comparison. A comparison
 * written without spaces still reads as a tag, which no plain-text rule can
 * tell apart from one.
 */
const HTML_TAG_REGEX =
  /<\/?[A-Za-z][^\s>]*(?:\s(?:"[^"]*"|'[^']*'|[^>"'])*)?\/?>/g;

/**
 * An html comment, closed or left open.
 *
 * The room renders none of this, so text parked in one reaches nobody who
 * opens the message. Carrying it to a banner would make the lock screen the
 * one place a message can be read.
 */
const HTML_COMMENT_REGEX = /<!--[\s\S]*?(?:-->|$)/g;

/**
 * An element whose text the room throws away with the tags.
 *
 * These five are `sanitize-html`'s own `nonTextTags`: it drops what is between
 * them, not only the tags around it. Keeping the words would put a sentence on
 * a lock screen that nobody opening the message can read.
 *
 * The close tag is matched by name, because the parser reads to the matching
 * one and treats every other tag on the way as text. Case-insensitive, because
 * a tag name is.
 */
const NON_TEXT_ELEMENT_REGEX =
  /<(script|style|textarea|option|xmp)\b[^>]*>[\s\S]*?(?:<\/\1\s*>|$)/gi;

/**
 * A link reference definition: `[1]: https://example.test`, with its title on
 * that line or the next, and its label free to carry an escaped bracket.
 *
 * Markdown reads it as the address for a `[label][1]` somewhere else and
 * prints none of it. The address is markup, not words, and the label beside
 * it is a whole sentence the writer chose.
 *
 * It is deliberately read on any line, at any indent, rather than only where
 * markdown would open a block. Markdown opens one after a heading, a rule, a
 * setext underline and a closed fence as well as after a blank line, and a
 * rule that names fewer of those leaves a definition standing with its
 * address on the banner. Reading one line too many costs a line of a message
 * that a reader can still open; reading one too few puts a sentence on a lock
 * screen that nobody can check. Taking a whole line can leave no words
 * behind, so it cannot leave the words of a definition it half-removed.
 *
 * What it will not take is a line that only looks like one. A definition
 * holds one destination and at most one title, so `[Note]: this is important`
 * stays the sentence markdown prints.
 */
const LINK_DEFINITION_REGEX =
  /^[^\S\n]*\[(?:\\[\s\S]|[^\][\\])+\][^\S\n]*:[^\S\n]*(?:\n[^\S\n]*)?\S+[^\S\n]*(?:(?:\n[^\S\n]*)?(?:"[^"\n]*"|'[^'\n]*'|\([^)\n]*\)))?[^\S\n]*$/gm;

/**
 * The line that opens or closes a fence.
 *
 * The block rule above takes out a fence that is closed and written in
 * backticks, which is the only shape the room lifts out before it sanitizes.
 * Markdown itself knows more: a fence closes at the end of the message, it
 * closes on a line indented up to three spaces, and it opens on tildes. The
 * room prints none of those delimiter lines, and an info string is the
 * writer's to choose, so `` ```call 555-0100 to unlock your account `` would
 * otherwise be a whole sentence on a lock screen above an empty code block.
 *
 * A backtick fence carries no backtick in its info string, which is what
 * keeps `` ```the plan``` `` the code span the room shows.
 */
const FENCE_DELIMITER_LINE_REGEX = /^ {0,3}(?:`{3,}[^`\n]*|~{3,}[^\n]*)$/gm;

/**
 * A run of backticks, which the cleaner below reads only one of.
 *
 * `` ```plan``` `` on one line is a code span, and the room shows the words
 * in it. The cleaner takes a fence out before it unwraps a span, so a run left
 * whole would read as a fence and the words would go. One backtick is what the
 * room's own rule comes down to for a span of any width.
 */
const BACKTICK_RUN_REGEX = /`{2,}/g;

/**
 * How many times the strip below may repeat.
 *
 * The two constructs that a strip can reveal are one level deep, and two
 * passes settle either. The cap is what stops a body built out of thousands of
 * half-open brackets from buying a pass each, which costs seconds of the
 * server's only thread for a message anyone may post.
 */
const MAX_STRIP_PASSES = 3;

/**
 * Removing one of these can complete another: `[[]()](url)` leaves a whole
 * empty link once the inner one goes, and a global scan has already passed
 * the place the new one starts at. So repeat, up to the cap.
 *
 * Where a repair and the room's parser disagree, the preview says less. The
 * room reads `<scr<script>ipt>x</script>` as one unknown tag and prints
 * `ipt>x`, while the strip here takes the whole element out. Saying less is
 * the safe half of the promise and the half a plain-text rule can keep.
 *
 * A tag becomes a space rather than nothing: `<p>one</p><p>two</p>` is two
 * words, and joining them into one would say something the writer did not.
 */
function stripTags(text: string): string {
  let current = text;

  for (let pass = 0; pass < MAX_STRIP_PASSES; pass += 1) {
    const stripped = current
      .replace(HTML_COMMENT_REGEX, " ")
      .replace(NON_TEXT_ELEMENT_REGEX, " ")
      .replace(LINK_DEFINITION_REGEX, "")
      .replace(HTML_TAG_REGEX, " ")
      .replace(EMPTY_LABEL_LINK_REGEX, "");
    if (stripped === current) {
      break;
    }

    current = stripped;
  }

  return current;
}

/**
 * The longest preview a caller may show.
 *
 * Matches the push parameter ceiling in Core, so the preview stored on a
 * notification row and the one that rides a push are the same string. Cutting
 * here rather than there also buys the ellipsis: the push cap protects a
 * display name, where a silent cut reads as the whole name, and this protects
 * a sentence, where it reads as the whole message.
 */
export const CHAT_MESSAGE_PREVIEW_MAX_LENGTH = 128;

/** Counted in codepoints, cut on what the reader sees as one character. */
const GRAPHEME_SEGMENTER = new Intl.Segmenter();

/**
 * Cut on a grapheme, so the last thing standing is a character.
 *
 * A codepoint is not a character: a family emoji, a flag, a skin tone and an
 * accented letter are each several, and a cut between them leaves a joiner
 * with nothing to join or a letter without its accent.
 */
function capPreview(preview: string): string {
  if ([...preview].length <= CHAT_MESSAGE_PREVIEW_MAX_LENGTH) {
    return preview;
  }

  // One codepoint of the budget goes to the ellipsis.
  const budget = CHAT_MESSAGE_PREVIEW_MAX_LENGTH - 1;
  let kept = "";
  let length = 0;

  for (const { segment } of GRAPHEME_SEGMENTER.segment(preview)) {
    const size = [...segment].length;
    if (length + size > budget) {
      break;
    }

    kept += segment;
    length += size;
  }

  // A cut that keeps nothing has nothing to say it cut, and an ellipsis alone
  // reads as a message. Say nothing instead, and let the caller fall back.
  const trimmed = kept.trimEnd();

  return trimmed ? `${trimmed}\u2026` : "";
}

/**
 * One line of plain text standing for a room message body.
 *
 * Used where a message is named rather than read: an OS banner, a thread-list
 * row. Mention tokens become the name they carry, because `@<uuid>:Ada` is an
 * id the reader never sees anywhere else in the product. A file keeps the name
 * it was posted under, because that name is what the sender wrote.
 *
 * Returns an empty string when the body cleans to nothing at all. The caller
 * decides what an empty preview means: a banner drops its body, and a
 * thread-list row falls back to the sender.
 */
export function buildChatMessagePreview(content: string): string {
  // A fence goes first, by the room's own rule. The room lifts one out before
  // it sanitizes, so an unclosed `<script>` or `<!--` written inside a fence
  // is text there, not markup. Reading it as markup here would swallow the
  // rest of the message: the strip runs to the end of the body when it finds
  // no close tag.
  //
  // A code span is different. `sanitizeMarkdown` runs over the raw body, so
  // the room renders "use `` not ``" for "use `<Button>` not `<button>`", and
  // a preview that kept the tag names would read back words the room removed.
  const withoutCode = content
    .replace(MARKDOWN_FENCED_BLOCK_REGEX, " ")
    .replace(FENCE_DELIMITER_LINE_REGEX, "");
  const readable = stripTags(withoutCode)
    .replace(MARKDOWN_IMAGE_BANG_REGEX, "")
    .replace(BACKTICK_RUN_REGEX, "`")
    .replace(MENTION_TOKEN_REGEX, (_match, _key: string, slug: string) => {
      return `@${slug}`;
    });

  const oneLine = cleanChatMessageText(readable).replace(/\s+/g, " ").trim();

  return capPreview(oneLine);
}
