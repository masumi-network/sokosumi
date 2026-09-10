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
 *
 * The slug may be empty. It is a name rewritten to lowercase ascii words, and
 * a name written in a script that rewrite keeps nothing of leaves `@<uuid>:`,
 * so a rule that demanded a slug would leave the uuid itself on a banner.
 *
 * The slug ends at the first character the rewrite cannot produce: letters,
 * digits, `_` and `-` are a slug, and everything else belongs to the message.
 * Reading to the next space instead takes the comma out of `@<uuid>:ada, are
 * you free?` and the closing bracket out of `[docs](https://e.test/@<uuid>:x)`,
 * which leaves the address of a broken link on a lock screen where the label
 * alone belongs.
 */
const MENTION_TOKEN_REGEX =
  /@([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}|all):([\p{L}\p{N}_-]*)/gu;

/**
 * The key of the room-wide mention, which names a room rather than a member.
 *
 * A lookup of who a mention names never finds it, so it is the one key that
 * stands for itself.
 */
export const CHAT_MENTION_ALL_KEY = "all";

/**
 * What a name has to keep to still name anyone: anything that is not
 * punctuation, a space or a control character.
 *
 * Written the wide way round. A name is a person's to choose, and people
 * choose emoji and symbols for one, so a rule naming the scripts it accepts
 * would take the name off a member the room shows by it.
 */
const NAMING_CHARACTER_REGEX = /[^\p{P}\p{Z}\p{C}\s]/u;

/**
 * The characters a banner has no way to show: the controls, the invisible
 * formatting marks, and a surrogate left on its own. Tab and the line breaks
 * are spelled out of the class, because the rules below read by them.
 *
 * Read by category rather than by a range written out by hand. A named range
 * covers what its author thought of, and what it misses is exactly what an
 * attacker writes: `U+0085` and `U+200B` hide an address from the rules that
 * read an address by its characters, the same way a NUL does, and `U+202E`
 * turns the rest of a banner back to front.
 *
 * They are taken out rather than spaced out, so a `www` and a `.test` one of
 * them sits between are read as the one address they spell.
 *
 * The joiner `U+200D` is spelled out of the class as well. It is what holds
 * the parts of one emoji together, and a name is a person's to choose.
 */
const CONTROL_CHARACTER_REGEX = /(?![\t\n\r\u200d])[\p{Cc}\p{Cf}\p{Cs}]/gu;

/**
 * The invisible marks that belong to an emoji, standing where no emoji is.
 *
 * A joiner holds two halves of one emoji together, and a variation selector
 * says how to draw the character before it. Both show nothing, so one beside
 * an ascii letter or dot is there to hide what it sits between: `www` and
 * `.evil.test` read as two words rather than as the address they spell.
 * `U+FE0E` is `Mn` rather than `Cf`, so the category rule above never sees it.
 *
 * A keycap is spelled out of the rule: `1`, `#` and `*` are ascii, and each
 * takes a variation selector and `U+20E3` to become the one character a room
 * shows.
 */
const ASCII_INVISIBLE_REGEX =
  /(?<=[\u0000-\u007f])(?:\u200d|[\ufe00-\ufe0f](?!\u20e3))|\u200d(?=[\u0000-\u007f])/gu;

/** The text back when it names someone, and nothing when it does not. */
function whatNamesSomeone(text: string): string {
  return NAMING_CHARACTER_REGEX.test(text) ? text : "";
}

/**
 * The keys of the mention tokens in a message body, in the order written and
 * without repeats.
 *
 * A caller that wants the preview to print names has to look them up, and this
 * says whose. It reads the token by the same rule the preview does, so the two
 * cannot come to disagree about what a mention is.
 *
 * The room-wide `all` is a key like any other here. It names no member, so a
 * lookup finds nothing for it and the preview keeps the slug it was written
 * with.
 *
 * A uuid is written in either case and stored in one, so a key comes back
 * lowercased. A caller looks a member up by it and the preview looks the
 * answer up the same way, which is what keeps `@019FC7E4-…` a name rather
 * than a miss.
 */
export function readChatMentionKeys(content: string): string[] {
  const keys = new Set<string>();

  for (const match of content.matchAll(MENTION_TOKEN_REGEX)) {
    const key = match[1];
    if (key) {
      keys.add(key.toLowerCase());
    }
  }

  return [...keys];
}

/**
 * A web address written as words: a scheme, or the `www.` people write
 * instead of one, running to the last character an address is written with.
 *
 * Deliberately narrower than what a browser accepts.
 *
 * A bare `example.test` with no scheme is left standing, because the rule that
 * told it apart from `node.js` or `e.g.` would have to guess, and guessing
 * takes words out of a sentence a person wrote. A scheme without `//` is left
 * standing for the same reason: `mailto:a@e.test` would go, and so would the
 * `note:remember` and `TODO:ship` people write.
 *
 * The schemes are named one by one rather than read as a word before `://`.
 * A scheme name spelled as `[a-z][a-z0-9+.-]*` reaches left through the dot
 * and the hyphen people write next to a link, so `Read the notes.https://e.test`
 * loses `notes` and `our cta-https://e.test` loses `cta`. Naming them also
 * lets the scheme branch start anywhere, which is what takes the address out
 * of `docs*https://e.test*` once the markdown clean has closed that gap.
 *
 * A `www.` with no scheme in front of it is an address wherever it stands,
 * `seewww.example.test` included. A word rule that read the character before
 * it would guard that word, and it would guard `@Bobwww` written by a member
 * who named themselves so, with the rest of the address in the words after
 * the mention. The line a banner shows is written by two hands, so a rule
 * that reads one character back cannot tell whose word it is reading.
 *
 * The `@` in front of a name goes with the address that ate the name: `@` is
 * a character an address is written with and never one it starts with, so
 * nothing else can lose one this way. An `@` the sender typed keeps its
 * space, as in "meet @ 5pm".
 *
 * The punctuation that ends a sentence is put back: it is the writer's, not
 * the address's.
 */
const BARE_URL_REGEX =
  /(?:(?:https?|ftps?):\/\/|(?<![A-Za-z0-9_])www\.)[A-Za-z0-9\-._~:/?#@!$&*+,;=%[\]]+/gi;

/**
 * The same address, read where a name meets the words beside it.
 *
 * The word rule above guards a `www.` inside a word, and `seewww.example.test`
 * is a word the sender wrote. It cannot guard a word that two hands wrote
 * between them: a member named `Bobwww` and a message going on `.evil.test`
 * make one only once the name is on the line. So this rule reads no character
 * back, and only what a name touches is read by it.
 *
 * The `@` in front of a name goes with the address that ate the name: `@` is
 * a character an address is written with and never one it starts with, so
 * nothing else loses one this way. An `@` the sender typed keeps its space,
 * as in "meet @ 5pm".
 */
const NAME_SEAM_URL_REGEX =
  /@?(?:(?:https?|ftps?):\/\/|www\.)[A-Za-z0-9\-._~:/?#@!$&*+,;=%[\]]+/gi;

/**
 * An address inside a display name, which runs to the next space.
 *
 * A sentence ends an address at the last character an address is written
 * with, because a sentence in Chinese, Japanese or Thai is written without
 * spaces and the words after a link are the writer's. A display name is one
 * name by one hand: nobody writes a sentence around an address in one, and a
 * host spelled with a Cyrillic letter in it is the rename this rule exists to
 * stop.
 */
const NAME_ADDRESS_REGEX = /@?(?:(?:https?|ftps?):\/\/|www\.)\S*/giu;

/** A display name with every address it carries taken out of it. */
function withoutNameAddresses(name: string): string {
  return name.replace(NAME_ADDRESS_REGEX, "");
}

/** What an address may end with that belongs to the sentence around it. */
const URL_TRAILING_PUNCTUATION_REGEX = /[.,;:!?)\]}'"]+$/;

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
 * The text with every web address taken out of it.
 *
 * Only the stop that ends a sentence is put back: `go to https://e.test. Then
 * wait` is two sentences, and taking the stop with the address would run them
 * into one. Nothing else goes in the address's place, because a sentence with
 * spaces already has them around the address, and a sentence written without
 * them wants none.
 */
function withoutAddresses(text: string): string {
  return text.replace(BARE_URL_REGEX, (address) => {
    return URL_TRAILING_PUNCTUATION_REGEX.exec(address)?.[0] ?? "";
  });
}

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
 * `mentionNames` maps a token key to the display name the room shows for it,
 * and is what makes the two agree. The slug in a token is a lowercased,
 * hyphenated, ascii-only rewrite of a name, so `@ada-lovelace` on a banner is
 * a second spelling of the `Ada Lovelace` the room prints, and a name that
 * rewrites to nothing leaves the key standing in its place. A key the map does
 * not name falls back to its slug, and a token with neither is dropped rather
 * than printed: the id it carries means nothing to a reader.
 *
 * Returns an empty string when the body cleans to nothing at all. The caller
 * decides what an empty preview means: a banner drops its body, and a
 * thread-list row falls back to the sender.
 */
export function buildChatMessagePreview(
  content: string,
  mentionNames?: ReadonlyMap<string, string>,
): string {
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
    .replace(CONTROL_CHARACTER_REGEX, "")
    .replace(ASCII_INVISIBLE_REGEX, "")
    .replace(MARKDOWN_FENCED_BLOCK_REGEX, " ")
    .replace(FENCE_DELIMITER_LINE_REGEX, "");
  // The markdown clean runs over the whole body, with the tokens still in it.
  // A token is written in the characters the clean leaves alone, so it comes
  // out as it went in, and the clean gets to see a link or a code span whole
  // rather than in the halves a mention inside one would leave.
  const withoutMarkup = stripTags(withoutCode)
    .replace(MARKDOWN_IMAGE_BANG_REGEX, "")
    .replace(BACKTICK_RUN_REGEX, "`");
  const readable = cleanChatMessageText(withoutMarkup);

  // The names go in after that clean. A name is a person's to spell and the
  // clean takes `* _ ~ > #` out of whatever it is handed, which is what would
  // make `R_D` read as `RD` on a banner.
  const pieces: string[] = [];
  const nameSpans: Array<[number, number]> = [];
  let read = 0;
  let written = 0;

  const writePiece = (piece: string, isName: boolean) => {
    if (isName) {
      nameSpans.push([written, written + piece.length]);
    }

    pieces.push(piece);
    written += piece.length;
  };

  // The words the sender wrote are read for addresses on their own, so an
  // address ends where the sender's own text ends and never reaches into the
  // name after it: `https://e.test/x@<id>:ada` is a link and then a mention.
  for (const token of readable.matchAll(MENTION_TOKEN_REGEX)) {
    writePiece(withoutAddresses(readable.slice(read, token.index)), false);
    const key = token[1] ?? "";

    // The slug is read from the cleaned text, so the clean takes `_` out of it
    // as well: `ada_lovelace` says `adalovelace`. That is a slug already, an
    // ascii rewrite of a name, and it is only read when the lookup names
    // nobody. Reading it from the text before the clean instead would let a
    // slug the room never shows, in a link destination the clean drops, stand
    // in for the mention beside it.
    writePiece(whoAMentionNames(key, token[2] ?? "", mentionNames), true);
    read = token.index + token[0].length;
  }

  writePiece(withoutAddresses(readable.slice(read)), false);

  // The finished line is read once more, for the addresses a name and the
  // words beside it spell between them. Only what a name touches is read this
  // way: the words the sender wrote have had their own read, by the rule that
  // knows a word when it sees one.
  const named = pieces
    .join("")
    .replace(NAME_SEAM_URL_REGEX, (address: string, at: number) => {
      const end = at + address.length;
      const touchesName = nameSpans.some(
        ([start, stop]) => at < stop && end > start,
      );

      if (!touchesName) {
        return address;
      }

      return URL_TRAILING_PUNCTUATION_REGEX.exec(address)?.[0] ?? "";
    })
    .replace(/\s+/g, " ")
    .trim();

  return capPreview(named);
}

/**
 * The name a mention token stands for: `@` and the name, or nothing at all.
 *
 * A token carries a key and a slug. The slug is a lowercased, hyphenated,
 * ascii-only rewrite of a name, so it is a second spelling of the name the
 * room prints and stands in when the lookup finds none. A token left with
 * neither says nothing, because the id it carries means nothing to a reader.
 */
/** Two spellings of one word, read without the dashes either one carries. */
function sameSpelling(one: string, other: string): boolean {
  return (
    one.toLowerCase().replaceAll("-", "") ===
    other.toLowerCase().replaceAll("-", "")
  );
}

function whoAMentionNames(
  key: string,
  slug: string,
  mentionNames?: ReadonlyMap<string, string>,
): string {
  // Looked up lowercased, the case `readChatMentionKeys` hands a caller. A
  // uuid is written in either case, and a key that missed the map for its
  // case would put the id itself back on the banner.
  const lookupKey = key.toLowerCase();
  // A slug that repeats the key is not a name. The composer writes one for a
  // soko bot whose name has no ascii in it, so the fallback below would put
  // the id on a banner once that bot leaves the room and the lookup stops
  // naming it.
  // The dashes are taken out of both before they are read against each other,
  // because a uuid is written both ways and the slug rule keeps a uuid whole
  // either way: `019fc7e4e4bd7005900c66e44d33f5e4` is the key as well.
  const readableSlug = sameSpelling(slug, lookupKey) ? "" : slug;
  // Read for what a name says rather than for whether it is there: a member
  // whose display name is empty, or is nothing but spaces, is named no better
  // than one the map does not carry, and the slug is what is left to say who.
  // A name comes from the lookup rather than from the body, so the body's own
  // read for control characters never sees it.
  const name = whatNamesSomeone(
    withoutNameAddresses(
      (mentionNames?.get(lookupKey) ?? "")
        .replace(CONTROL_CHARACTER_REGEX, "")
        .replace(ASCII_INVISIBLE_REGEX, ""),
    ).trim(),
  );
  // `all` is a word rather than an id, so it stands in for its own slug and a
  // reader loses nothing when the token carries none.
  const label =
    name ||
    whatNamesSomeone(readableSlug) ||
    (lookupKey === CHAT_MENTION_ALL_KEY ? lookupKey : "");

  return label ? `@${label}` : "";
}
