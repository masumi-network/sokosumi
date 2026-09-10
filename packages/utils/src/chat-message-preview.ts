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

/** The text back when it names someone, and nothing when it does not. */
function whatNamesSomeone(text: string): string {
  return NAMING_CHARACTER_REGEX.test(text) ? text : "";
}

/**
 * A `www.` address whose `www` a name ends with and whose dot the message
 * text carries: read without the word rule that guards the one in a sentence.
 *
 * `seewww.example.test` is a word, and the address rule leaves it alone for
 * that reason. A name and the message it sits in are two texts by two hands,
 * though, so a member named `Bobwww` and a message whose words go on
 * `.evil.test/pay` spell an address between them that no word rule should
 * protect.
 */
const SEAM_ADDRESS_REGEX =
  /(?<=[A-Za-z0-9_])www\.[A-Za-z0-9\-._~:/?#!$&*+,;=%[\]]+/giu;

/**
 * The name up to the address it starts, when the message text carries the
 * rest of that address. The message keeps its own words: what is left of them
 * is a domain with no scheme, which this module leaves standing either way.
 */
function withoutSeamAddress(label: string, after: string): string {
  for (const match of `${label}${after}`.matchAll(SEAM_ADDRESS_REGEX)) {
    const end = match.index + match[0].length;

    if (match.index < label.length && end > label.length) {
      return label.slice(0, match.index);
    }
  }

  return label;
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
 * What stands in for a mention while the rest of the body is cleaned.
 *
 * NUL is the one character a message body cannot carry: Postgres rejects it in
 * text, so no writer can spell a marker of their own. The markdown clean and
 * the whitespace collapse both leave it alone, which is what lets a name go in
 * after them and keep the punctuation the person spells it with.
 */
const MENTION_MARKER = "\u0000";

/** A marker and the mention it stands for, as written above. */
const MENTION_MARKER_REGEX = /\u0000(\d+)\u0000/g;

/**
 * A name this code wrote, as it stands on the line once the addresses are
 * out of it: the `@` in front of it, and the number saying whose name it is.
 *
 * The marker sits behind the `@` rather than in front of it. An `@` is a
 * character an address is written with, so a marker in front of one cuts the
 * address a message and a name spell together: `www.@<id>:x` with a member
 * named `evil.test/pay` reads as one address only while nothing stands
 * between the two halves. The `@` is optional here because that read eats it.
 *
 * The number is what says whether the name after it is still there. An
 * address inside a name runs rightwards, so it takes the end of a name and
 * never the start: a name whose first character is gone is gone, and the `@`
 * in front of it names nobody.
 */
const LABEL_MARKER_REGEX = /@?\u0000(\d+)\u0000/g;

/**
 * A web address written as words: a scheme, or the `www.` people write
 * instead of one, running to the next space.
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
 * A `www.` with no scheme in front of it starts after anything but an ascii
 * word character, so the one inside `seewww.example.test` is a word and the
 * one in a sentence written without spaces is an address. Chinese, Japanese
 * and Thai are written that way, and a boundary made of letters in general
 * never lets an address start in them.
 *
 * It ends the same way: at the first character an address is not written
 * with, rather than at the next space, for those same sentences. What that
 * misses is a domain spelled in another script, which stays as written.
 *
 * A mention marker is not an address character either, so an address written
 * up against a mention leaves the person it names standing.
 *
 * The punctuation that ends a sentence is put back: it is the writer's, not
 * the address's.
 */
const BARE_URL_REGEX =
  /(?:(?:https?|ftps?):\/\/|(?<![A-Za-z0-9_])www\.)[A-Za-z0-9\-._~:/?#@!$&*+,;=%[\]]+/gi;

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
    .replace(MARKDOWN_FENCED_BLOCK_REGEX, " ")
    .replace(FENCE_DELIMITER_LINE_REGEX, "");
  // A name is a person's to spell, and the markdown clean below takes
  // `* _ ~ > #` out of whatever it is handed. So each mention leaves a marker
  // here and the name goes in after the clean, which is what keeps `R_D` from
  // reading as `RD` on a banner. A marker is built from NUL, a byte Postgres
  // will not store in a message body, so no message can write one itself.
  const labels: string[] = [];
  const readable = stripTags(withoutCode)
    .replace(MARKDOWN_IMAGE_BANG_REGEX, "")
    .replace(BACKTICK_RUN_REGEX, "`")
    .replace(MENTION_TOKEN_REGEX, (_match, key: string, slug: string) => {
      // Looked up lowercased, the case `readChatMentionKeys` hands a caller.
      // A uuid is written in either case, and a key that missed the map for
      // its case would put the id itself back on the banner.
      const lookupKey = key.toLowerCase();
      // `all` is a word rather than an id, so it stands in for its own slug
      // and a reader loses nothing when the token carries none. Every other
      // key is a uuid, which says nothing to anyone, so a token left with no
      // name and no slug says less by saying nothing.
      // A slug that repeats the key is not a name. The composer writes one
      // for a soko bot whose name has no ascii in it, so the fallback below
      // would put the id on a banner once that bot leaves the room and the
      // lookup stops naming it.
      const readableSlug = slug.toLowerCase() === lookupKey ? "" : slug;
      // Read for what it says rather than for whether it is there: a member
      // whose display name is empty is named no better than one the map does
      // not carry, and the slug is what is left to say who.
      // A display name is a member's to choose and nobody's to check, so an
      // address written into one is read the same way as an address written
      // into a message: taken out. Otherwise a member renames themselves
      // `www.evil.test/pay` and every reader of the room has that on a lock
      // screen, which is what this rule exists to prevent.
      // Read for whether a letter or a digit is left of it, rather than for
      // whether anything is: a name of spaces, and a name the address rule
      // cut down to the punctuation it gave back, both name nobody, and the
      // slug below says more. A member renaming themselves `www.evil.test.`
      // otherwise reads as `@.` on every lock screen in the room.
      const name = whatNamesSomeone(
        withoutAddresses(mentionNames?.get(lookupKey) ?? "").trim(),
      );
      const label =
        name ||
        whatNamesSomeone(readableSlug) ||
        (lookupKey === CHAT_MENTION_ALL_KEY ? lookupKey : "");

      labels.push(label);

      return `${MENTION_MARKER}${labels.length - 1}${MENTION_MARKER}`;
    });

  // An address goes after the markdown clean, which has already turned
  // `[docs](url)` into `docs`, so what is left is a link the sender typed as
  // words. A reader cannot check one from a lock screen and cannot act on it
  // there either, so the preview says the words around it and nothing else.
  // A message that is only a link cleans to nothing and the caller falls back
  // to the line naming the author and the room.
  const oneLine = withoutAddresses(cleanChatMessageText(readable))
    .replace(/\s+/g, " ")
    .trim();
  // The names go in last, and the line is closed up again: a mention that
  // stands for nobody leaves the space its marker sat in, and a preview cut
  // to length has to count the names it shows rather than the markers.
  const withNames = oneLine.replace(
    MENTION_MARKER_REGEX,
    (match: string, index: string, at: number) => {
      // A name that starts an address the message text finishes is cut where
      // that address starts, before the name reaches the line at all.
      const label = whatNamesSomeone(
        withoutSeamAddress(
          labels[Number(index)] ?? "",
          oneLine.slice(at + match.length),
        ),
      );

      labels[Number(index)] = label;

      // Each name keeps a marker of its own, so the read after the addresses
      // can tell an `@` this code wrote from an `@` the sender typed, as in
      // "meet @ 5pm".
      return label ? `@${MENTION_MARKER}${index}${MENTION_MARKER}${label}` : "";
    },
  );

  // A name and the words around it can spell an address between them: a
  // member named `www` and a message reading `@<id>:x.evil.test` put one on
  // the line only once the name was in it. So the line is read once more, and
  // a name that read took says nobody, `@` and all.
  const named = withoutAddresses(withNames)
    .replace(
      LABEL_MARKER_REGEX,
      (match: string, index: string, at: number, line: string) => {
        const label = labels[Number(index)] ?? "";
        const kept =
          label !== "" && line.startsWith(label[0], at + match.length);

        return kept && match.startsWith("@") ? "@" : "";
      },
    )
    .replace(/\s+/g, " ")
    .trim();

  return capPreview(named);
}
