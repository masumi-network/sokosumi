import { describe, expect, it } from "vitest";
import {
  buildChatMessagePreview,
  CHAT_MESSAGE_PREVIEW_MAX_LENGTH,
  readChatMentionKeys,
} from "./chat-message-preview";

describe("readChatMentionKeys", () => {
  it("reads the key of every mention, once each and in order", () => {
    expect(
      readChatMentionKeys(
        "@019fc7e4-e4bd-7005-900c-66e44d33f5e4:ada @all:all @019fc7e4-e4bd-7005-900c-66e44d33f5e4:ada again",
      ),
    ).toEqual(["019fc7e4-e4bd-7005-900c-66e44d33f5e4", "all"]);
  });

  /** A uuid is stored lowercased, so a key is looked up that way. */
  it("reads a key written in capitals as the id it stands for", () => {
    expect(
      readChatMentionKeys("@019FC7E4-E4BD-7005-900C-66E44D33F5E4:Ada hi"),
    ).toEqual(["019fc7e4-e4bd-7005-900c-66e44d33f5e4"]);
  });

  it("reads the key of a mention whose slug is empty", () => {
    expect(
      readChatMentionKeys("@019fc7e4-e4bd-7005-900c-66e44d33f5e4: hi"),
    ).toEqual(["019fc7e4-e4bd-7005-900c-66e44d33f5e4"]);
  });

  /** The same rule the preview reads by: a time is not a mention. */
  it("reads nothing from text that only looks like a mention", () => {
    expect(readChatMentionKeys("standup @10:30am")).toEqual([]);
  });
});

describe("buildChatMessagePreview", () => {
  it("reads a plain message back as it was written", () => {
    expect(buildChatMessagePreview("can you look at the login flow")).toBe(
      "can you look at the login flow",
    );
  });

  it("shows a mention as the name it carries", () => {
    expect(
      buildChatMessagePreview(
        "@019fc7e4-e4bd-7005-900c-66e44d33f5e4:Ada can you take this one",
      ),
    ).toBe("@Ada can you take this one");
  });

  /**
   * The slug in a token is the name rewritten to lowercase ascii words, so a
   * banner reading it back spells a person's name differently from the room.
   * The map is what the caller looked up, and it wins.
   */
  it("shows a mention as the name the room shows, not its slug", () => {
    expect(
      buildChatMessagePreview(
        "@019fc7e4-e4bd-7005-900c-66e44d33f5e4:ada-lovelace can you take this one",
        new Map([["019fc7e4-e4bd-7005-900c-66e44d33f5e4", "Ada Lovelace"]]),
      ),
    ).toBe("@Ada Lovelace can you take this one");
  });

  /**
   * A name the slug rule keeps nothing of leaves the token with no slug at
   * all, and the id is what a reader would otherwise be shown.
   */
  it("shows a name the slug rule writes as nothing", () => {
    expect(
      buildChatMessagePreview(
        "@019fc7e4-e4bd-7005-900c-66e44d33f5e4: できますか",
        new Map([["019fc7e4-e4bd-7005-900c-66e44d33f5e4", "あかり"]]),
      ),
    ).toBe("@あかり できますか");
  });

  /**
   * The markdown clean takes `* _ ~ > #` out of what it is handed, and a name
   * is a person's to spell. So the name goes in after the clean.
   */
  it("keeps the punctuation a member spells their name with", () => {
    expect(
      buildChatMessagePreview(
        "@019fc7e4-e4bd-7005-900c-66e44d33f5e4:c-r-d ping",
        new Map([["019fc7e4-e4bd-7005-900c-66e44d33f5e4", "C# R_D"]]),
      ),
    ).toBe("@C# R_D ping");
  });

  /**
   * A slug is letters, digits, `_` and `-`. What follows one is the message,
   * and reading it into the token deletes it: the comma below, and the
   * bracket that closes the link in the two after it.
   */
  it("keeps the punctuation that follows a mention", () => {
    expect(
      buildChatMessagePreview(
        "@019fc7e4-e4bd-7005-900c-66e44d33f5e4:ada, are you free?",
        new Map([["019fc7e4-e4bd-7005-900c-66e44d33f5e4", "Ada Lovelace"]]),
      ),
    ).toBe("@Ada Lovelace, are you free?");
  });

  it("shows only the label of a link whose address holds a mention", () => {
    expect(
      buildChatMessagePreview(
        "[docs](https://example.test/@019fc7e4-e4bd-7005-900c-66e44d33f5e4:ada)",
        new Map([["019fc7e4-e4bd-7005-900c-66e44d33f5e4", "Ada Lovelace"]]),
      ),
    ).toBe("docs");
  });

  it("names a mention written inside a link label", () => {
    expect(
      buildChatMessagePreview(
        "[hi @019fc7e4-e4bd-7005-900c-66e44d33f5e4:ada](https://example.test/p)",
        new Map([["019fc7e4-e4bd-7005-900c-66e44d33f5e4", "Ada Lovelace"]]),
      ),
    ).toBe("hi @Ada Lovelace");
  });

  it("names a mention written inside a code span", () => {
    expect(
      buildChatMessagePreview(
        "code `@019fc7e4-e4bd-7005-900c-66e44d33f5e4:ada` end",
        new Map([["019fc7e4-e4bd-7005-900c-66e44d33f5e4", "Ada Lovelace"]]),
      ),
    ).toBe("code @Ada Lovelace end");
  });

  /** An empty name is no name, so the slug is what is left to say who. */
  it("keeps the slug when the lookup carries an empty name", () => {
    expect(
      buildChatMessagePreview(
        "@019fc7e4-e4bd-7005-900c-66e44d33f5e4:ada hi",
        new Map([["019fc7e4-e4bd-7005-900c-66e44d33f5e4", ""]]),
      ),
    ).toBe("@ada hi");
  });

  /**
   * A reader cannot check an address from a lock screen, and the room is
   * where they would open it anyway. So the words stay and the link goes.
   */
  it("says the words around a link the sender typed as words", () => {
    expect(
      buildChatMessagePreview("see https://example.test/a/b?q=1 for details"),
    ).toBe("see for details");
  });

  it("takes an address written without a scheme", () => {
    expect(buildChatMessagePreview("try www.example.test today")).toBe(
      "try today",
    );
  });

  /** The caller shows the line naming the author and the room instead. */
  it("says nothing at all for a message that is only a link", () => {
    expect(buildChatMessagePreview("https://example.test/a")).toBe("");
  });

  /** A label is words the sender wrote, and it is what the room shows. */
  it("still says the label of a markdown link", () => {
    expect(buildChatMessagePreview("[the plan](https://example.test/a)")).toBe(
      "the plan",
    );
  });

  /** A marker stands for a person, so an address stops at one. */
  it("keeps a mention an address is written up against", () => {
    expect(
      buildChatMessagePreview(
        "see https://example.test/x@019fc7e4-e4bd-7005-900c-66e44d33f5e4:ada please",
        new Map([["019fc7e4-e4bd-7005-900c-66e44d33f5e4", "Ada Lovelace"]]),
      ),
    ).toBe("see @Ada Lovelace please");
  });

  /**
   * Chinese, Japanese and Thai are written without spaces. An address rule
   * that waits for one never starts, and never ends either.
   */
  it("takes an address out of a sentence written without spaces", () => {
    expect(buildChatMessagePreview("请访问www.example.test获取密码")).toBe(
      "请访问获取密码",
    );
    expect(buildChatMessagePreview("見てhttps://example.test/xを")).toBe(
      "見てを",
    );
  });

  /**
   * A scheme is named rather than read as a word before `://`. A rule that
   * read one takes the word in front of the address with it.
   */
  it("keeps the word an address is written up against", () => {
    expect(buildChatMessagePreview("Read the notes.https://example.test")).toBe(
      "Read the notes.",
    );
    expect(buildChatMessagePreview("our cta-https://example.test today")).toBe(
      "our cta- today",
    );
    expect(
      buildChatMessagePreview("see the docs*https://example.test* now"),
    ).toBe("see the docs now");
  });

  /**
   * A display name is a member's to choose and nobody's to check. A member
   * who renames themselves after an address would otherwise put one on every
   * reader's lock screen.
   */
  it("takes an address out of a display name", () => {
    expect(
      buildChatMessagePreview(
        "hi @019fc7e4-e4bd-7005-900c-66e44d33f5e4:ada",
        new Map([
          ["019fc7e4-e4bd-7005-900c-66e44d33f5e4", "www.evil.test/pay"],
        ]),
      ),
    ).toBe("hi @ada");
  });

  it("names a member after an address in their name is taken out", () => {
    expect(
      buildChatMessagePreview(
        "hi @019fc7e4-e4bd-7005-900c-66e44d33f5e4:ada",
        new Map([
          ["019fc7e4-e4bd-7005-900c-66e44d33f5e4", "Ada https://evil.test"],
        ]),
      ),
    ).toBe("hi @Ada");
  });

  /** The words before a name can spell one with it too. */
  it("takes an address the message and a name spell together", () => {
    expect(
      buildChatMessagePreview(
        "see www.@019fc7e4-e4bd-7005-900c-66e44d33f5e4:zz now",
        new Map([["019fc7e4-e4bd-7005-900c-66e44d33f5e4", "evil.test/pay"]]),
      ),
    ).toBe("see evil.test/pay now");
    expect(
      buildChatMessagePreview(
        "mail me at www.@019fc7e4-e4bd-7005-900c-66e44d33f5e4:zz",
        new Map([
          ["019fc7e4-e4bd-7005-900c-66e44d33f5e4", "evil.test/pay?x=1"],
        ]),
      ),
    ).toBe("mail me at evil.test/pay?x=1");
  });

  /** A name and the words after it can spell an address between them. */
  it("takes an address a name and the message spell together", () => {
    expect(
      buildChatMessagePreview(
        "hi @019fc7e4-e4bd-7005-900c-66e44d33f5e4:x.evil.test",
        new Map([["019fc7e4-e4bd-7005-900c-66e44d33f5e4", "www"]]),
      ),
    ).toBe("hi");
  });

  /**
   * The `@` a person types is theirs. Only the one this code writes in front
   * of a name is dropped, and only when the address rule took the name.
   */
  it("keeps an `@` the sender wrote as a word", () => {
    expect(buildChatMessagePreview("meet @ 5pm at the cafe")).toBe(
      "meet @ 5pm at the cafe",
    );
    expect(buildChatMessagePreview("rates @ 5% and @ 10%")).toBe(
      "rates @ 5% and @ 10%",
    );
    expect(buildChatMessagePreview("price is 30 @")).toBe("price is 30 @");
  });

  /**
   * The punctuation that closes a sentence comes back after an address goes.
   * The `@` in front of the name the address took does not.
   */
  it("leaves no `@` behind when an address takes the whole name", () => {
    const names = new Map([["019fc7e4-e4bd-7005-900c-66e44d33f5e4", "www"]]);

    expect(
      buildChatMessagePreview(
        "@019fc7e4-e4bd-7005-900c-66e44d33f5e4:zz.evil.test/pay!",
        names,
      ),
    ).toBe("!");
    expect(
      buildChatMessagePreview(
        "(@019fc7e4-e4bd-7005-900c-66e44d33f5e4:zz.evil.test/pay)",
        names,
      ),
    ).toBe("()");
  });

  /** A name the address rule cut down to punctuation names nobody either. */
  it("names a member by their slug when an address leaves only a stop", () => {
    expect(
      buildChatMessagePreview(
        "x @019fc7e4-e4bd-7005-900c-66e44d33f5e4:zz y",
        new Map([["019fc7e4-e4bd-7005-900c-66e44d33f5e4", "www.evil.test."]]),
      ),
    ).toBe("x @zz y");
  });

  /** A name of nothing but spaces names nobody, so the slug says who. */
  it("names a member by their slug when their name is only spaces", () => {
    expect(
      buildChatMessagePreview(
        "hi @019fc7e4-e4bd-7005-900c-66e44d33f5e4:zz there",
        new Map([
          ["019fc7e4-e4bd-7005-900c-66e44d33f5e4", "  www.evil.test/pay"],
        ]),
      ),
    ).toBe("hi @zz there");
  });

  /**
   * A word rule guards the `www` inside a word a person wrote. It does not
   * guard one a name and a message spell between them, by two hands.
   */
  it("takes an address a name ending in `www` starts", () => {
    expect(
      buildChatMessagePreview(
        "hi @019fc7e4-e4bd-7005-900c-66e44d33f5e4:x.evil.test/pay now",
        new Map([["019fc7e4-e4bd-7005-900c-66e44d33f5e4", "Bobwww"]]),
      ),
    ).toBe("hi @Bob.evil.test/pay now");
  });

  /**
   * A name is one hand's text throughout, so the word rule that guards a
   * `www` inside a word guards nothing here: a member who writes a whole
   * address into their name, one word character in front of it, is the case
   * this rule exists for.
   */
  it("takes an address out of a name that reads as a word", () => {
    const preview = (name: string) =>
      buildChatMessagePreview(
        "hi @019fc7e4-e4bd-7005-900c-66e44d33f5e4: now",
        new Map([["019fc7e4-e4bd-7005-900c-66e44d33f5e4", name]]),
      );

    expect(preview("Bobwww.evil.test/pay")).toBe("hi @Bob now");
    expect(preview("BobWWW.evil.test")).toBe("hi @Bob now");
    expect(preview("Bobwww.evil.test Guy")).toBe("hi @Bob Guy now");
    expect(preview("www.еvil.test/pay")).toBe("hi now");
    expect(preview("Bobwww.еvil.test")).toBe("hi @Bob now");
  });

  /**
   * A mention that names nobody leaves nothing on the line, so the name
   * before it ends up against the words after it.
   */
  it("takes an address a dropped mention closes up into", () => {
    expect(
      buildChatMessagePreview(
        "Hi @11111111-1111-4111-8111-111111111111:bob@22222222-2222-4222-8222-222222222222:.evil.test/pay",
        new Map([["11111111-1111-4111-8111-111111111111", "Bobwww"]]),
      ),
    ).toBe("Hi @Bob.evil.test/pay");
  });

  /** A name is a person's to choose, emoji and all. */
  it("names a member whose name has no letter in it", () => {
    expect(
      buildChatMessagePreview(
        "x @019fc7e4-e4bd-7005-900c-66e44d33f5e4: y",
        new Map([["019fc7e4-e4bd-7005-900c-66e44d33f5e4", "\u{1F389}"]]),
      ),
    ).toBe("x @\u{1F389} y");
  });

  /** The `www.` inside a word is a word. */
  it("leaves a word that only ends in an address alone", () => {
    expect(buildChatMessagePreview("seewww.example.test now")).toBe(
      "seewww.example.test now",
    );
  });

  /** The stop belongs to the sentence, not to the address. */
  it("keeps the punctuation that closes a sentence around an address", () => {
    expect(
      buildChatMessagePreview("go to https://example.test/a. Then wait"),
    ).toBe("go to . Then wait");
  });

  /**
   * A scheme without `//` stays: a rule that took `mailto:a@e.test` would
   * take `note:remember` and `TODO:ship` with it.
   */
  it("leaves a word that only looks like a scheme alone", () => {
    expect(buildChatMessagePreview("note:remember the standup")).toBe(
      "note:remember the standup",
    );
  });

  /** A sentence is not an address, whatever the dots in it look like. */
  it("leaves a word with a dot in it alone", () => {
    expect(buildChatMessagePreview("node.js broke again, e.g. the build")).toBe(
      "node.js broke again, e.g. the build",
    );
  });

  /** The words around a dropped mention still read as one line. */
  it("closes the line up around a mention it drops", () => {
    expect(
      buildChatMessagePreview(
        "before @019fc7e4-e4bd-7005-900c-66e44d33f5e4: after",
      ),
    ).toBe("before after");
  });

  it("drops a mention that has neither a name nor a slug", () => {
    expect(
      buildChatMessagePreview("@019fc7e4-e4bd-7005-900c-66e44d33f5e4: hi"),
    ).toBe("hi");
  });

  /**
   * The composer writes the id as the slug for a soko bot whose name has no
   * ascii in it, so the token reads `@<id>:<id>`. Once that bot leaves the
   * room the lookup stops naming it, and the id must not stand in for a name.
   */
  it("drops a mention whose slug is the id again", () => {
    expect(
      buildChatMessagePreview(
        "@019fc7e4-e4bd-7005-900c-66e44d33f5e4:019fc7e4-e4bd-7005-900c-66e44d33f5e4 ping",
      ),
    ).toBe("ping");
  });

  it("names that bot while the room still holds it", () => {
    expect(
      buildChatMessagePreview(
        "@019fc7e4-e4bd-7005-900c-66e44d33f5e4:019fc7e4-e4bd-7005-900c-66e44d33f5e4 ping",
        new Map([["019fc7e4-e4bd-7005-900c-66e44d33f5e4", "そこ"]]),
      ),
    ).toBe("@そこ ping");
  });

  /** A key the lookup did not name is still written as the sender wrote it. */
  it("keeps the slug of a mention the lookup does not name", () => {
    expect(
      buildChatMessagePreview(
        "@019fc7e4-e4bd-7005-900c-66e44d33f5e4:Ada hi",
        new Map([["019fc7e4-e4bd-7005-900c-66e44d33f5e5", "Ben Green"]]),
      ),
    ).toBe("@Ada hi");
  });

  /** `all` names a room rather than a member, so it stands for itself. */
  it("keeps a room-wide mention written without a slug", () => {
    expect(buildChatMessagePreview("@all: standup in five")).toBe(
      "@all standup in five",
    );
  });

  it("shows a room-wide mention as the word the composer inserts", () => {
    expect(buildChatMessagePreview("@all:all standup in five")).toBe(
      "@all standup in five",
    );
  });

  it("shows every mention in a message, not only the first", () => {
    expect(
      buildChatMessagePreview(
        "@019fc7e4-e4bd-7005-900c-66e44d33f5e4:Ada @019fc7e4-e4bd-7005-900c-66e44d33f5e5:Ben standup?",
      ),
    ).toBe("@Ada @Ben standup?");
  });

  /**
   * The key stops at `@`, so the token starts at the last one. Reading from
   * the first would eat the words in front of it.
   */
  it("starts a mention at the last @, not the first", () => {
    expect(
      buildChatMessagePreview(
        "@ada@019fc7e4-e4bd-7005-900c-66e44d33f5e4:Ada hi",
      ),
    ).toBe("@ada@Ada hi");
  });

  /**
   * A uuid is written in either case. The room looks the key up, falls back
   * to the slug when the key names nobody, and shows the name either way.
   */
  it("shows a mention whose key is written in capitals", () => {
    expect(
      buildChatMessagePreview(
        "@019FC7E4-E4BD-7005-900C-66E44D33F5E4:Ada can you take this one",
      ),
    ).toBe("@Ada can you take this one");
  });

  /** The id is stored lowercased, and the token is not always written so. */
  it("names a member whose key is written in capitals", () => {
    expect(
      buildChatMessagePreview(
        "@019FC7E4-E4BD-7005-900C-66E44D33F5E4:ada-lovelace hi",
        new Map([["019fc7e4-e4bd-7005-900c-66e44d33f5e4", "Ada Lovelace"]]),
      ),
    ).toBe("@Ada Lovelace hi");
  });

  /**
   * The room reads the slug as `[^\s]+` (`MENTION_MATCH_REGEX`), so the name
   * runs to the next space whatever it starts with. Reading less leaves the
   * token unmatched, and a banner shows the reader a raw uuid.
   */
  it("shows a name the room reads but a word rule would not", () => {
    expect(
      buildChatMessagePreview(
        "@019fc7e4-e4bd-7005-900c-66e44d33f5e4:-ada can you take this one",
      ),
    ).toBe("@-ada can you take this one");
  });

  /**
   * A mention key is a uuid or `all`. The room rewrites a token only when its
   * key names someone in the room, so every other `word:word` is text a
   * person wrote and the preview has to leave it whole.
   */
  it("leaves a time alone, which only looks like a mention", () => {
    expect(buildChatMessagePreview("standup @10:30am")).toBe(
      "standup @10:30am",
    );
    expect(buildChatMessagePreview("export @16:9 please")).toBe(
      "export @16:9 please",
    );
  });

  it("leaves an address alone, which the room leaves alone too", () => {
    expect(
      buildChatMessagePreview("git clone git@github.com:org/repo.git"),
    ).toBe("git clone git@github.com:org/repo.git");
    expect(buildChatMessagePreview("ssh ada@10.0.0.4:2222")).toBe(
      "ssh ada@10.0.0.4:2222",
    );
    expect(buildChatMessagePreview("note @TODO:fix the header")).toBe(
      "note @TODO:fix the header",
    );
  });

  it("strips markdown markers", () => {
    expect(buildChatMessagePreview("**ship it** and _then_ tell me")).toBe(
      "ship it and then tell me",
    );
  });

  it("keeps the label of a link and drops the url", () => {
    expect(
      buildChatMessagePreview("see [the design](https://example.test/spec)"),
    ).toBe("see the design");
  });

  it("keeps the text of an inline code span", () => {
    expect(buildChatMessagePreview("run `pnpm test` first")).toBe(
      "run pnpm test first",
    );
  });

  /**
   * `sanitizeMarkdown` runs over the raw body before the room parses it, so an
   * inline code span is no shelter: the room renders this as "use `` not ``".
   * A preview that kept the tag names would read back words the room removed.
   */
  it("drops a tag between backticks, which the room drops as well", () => {
    expect(buildChatMessagePreview("use `<Button>` not `<button>`")).toBe(
      "use not",
    );
  });

  /**
   * `sanitizeMarkdown` drops a comment before the room renders it, so nobody
   * reading the message ever sees this. A banner that showed it would be the
   * one surface the text reaches.
   */
  it("drops an html comment, which the room shows to nobody", () => {
    expect(
      buildChatMessagePreview("looks fine <!-- token=sk-live-abc123 -->"),
    ).toBe("looks fine");
  });

  /**
   * These five are `sanitize-html`'s own `nonTextTags`. It throws the words
   * away with the tags, so a reader opening the message sees nothing of them.
   */
  it.each(["script", "style", "textarea", "option", "xmp"])(
    "drops the words inside a <%s>, which the room shows to nobody",
    (tag) => {
      expect(
        buildChatMessagePreview(
          `nothing to see <${tag}>the door code is 4417</${tag}>`,
        ),
      ).toBe("nothing to see");
    },
  );

  /** A tag name is case-insensitive, and so is the room reading one. */
  it("drops the words inside a non-text element written in capitals", () => {
    expect(
      buildChatMessagePreview(
        "nothing to see <SCRIPT>the code is 4417</SCRIPT>",
      ),
    ).toBe("nothing to see");
  });

  /**
   * The room reads to the close tag that matches the open one and treats
   * every other tag on the way as part of the text it throws away.
   */
  it("reads a non-text element to the close tag that matches it", () => {
    expect(
      buildChatMessagePreview(
        "note <script>a</b> the code is 4417</script> end",
      ),
    ).toBe("note end");
  });

  it("reads two non-text elements as two, not as one long one", () => {
    expect(
      buildChatMessagePreview(
        "one <style>a</style> MIDDLE <style>b</style> two",
      ),
    ).toBe("one MIDDLE two");
  });

  it("drops the words inside an element the writer never closed", () => {
    expect(
      buildChatMessagePreview("nothing to see <script>the door code is 4417"),
    ).toBe("nothing to see");
  });

  it("drops an html comment the writer never closed", () => {
    expect(
      buildChatMessagePreview("looks fine <!-- token=sk-live-abc123"),
    ).toBe("looks fine");
  });

  it("leaves the words either side of a comment two words", () => {
    expect(buildChatMessagePreview("meet<!-- not today -->at five")).toBe(
      "meet at five",
    );
  });

  /** The address belongs to the markup: markdown prints the label alone. */
  it("drops a link reference definition and keeps the words", () => {
    expect(
      buildChatMessagePreview(
        "see [the doc][1]\n\n[1]: https://internal.example/secret",
      ),
    ).toBe("see [the doc][1]");
  });

  it("keeps a colon in the words, which starts no definition", () => {
    expect(buildChatMessagePreview("note: [the doc] is ready")).toBe(
      "note: [the doc] is ready",
    );
  });

  /**
   * A definition holds one destination and an optional title. What follows
   * the colon here is a sentence, and markdown prints it as one.
   */
  it("keeps a bracketed line the room prints as a sentence", () => {
    expect(buildChatMessagePreview("[Note]: this is important")).toBe(
      "[Note]: this is important",
    );
    expect(
      buildChatMessagePreview(
        "deploy stopped\n\n[Warning]: do not ship on friday",
      ),
    ).toBe("deploy stopped [Warning]: do not ship on friday");
  });

  it("drops a definition that carries a title beside its address", () => {
    expect(
      buildChatMessagePreview(
        'see [the doc][1]\n\n[1]: https://e.test/x "The doc"',
      ),
    ).toBe("see [the doc][1]");
  });

  /**
   * Markdown closes a fence at the end of the message, on a line indented up
   * to three spaces, and on tildes. The room prints no delimiter line and no
   * info string, and an info string is a whole line the writer chose.
   */
  it.each([
    ["an unclosed fence", "```call 555-0100 to unlock your account"],
    ["a tilde fence", "~~~call 555-0100 to unlock\ny\n~~~"],
    ["a closer that is indented", "```call 555-0100 to unlock\ny\n   ```"],
  ])("shows no info string from %s", (_name, content) => {
    expect(buildChatMessagePreview(content)).not.toContain("555-0100");
  });

  /**
   * A backtick fence carries no backtick in its info string, so this line is
   * a code span and the room shows the words in it.
   */
  it("shows a code span that opens a line, which is no fence", () => {
    expect(buildChatMessagePreview("```the plan``` ships today")).toBe(
      "the plan ships today",
    );
  });

  /**
   * Four spaces make a code block, and the room prints the fence line inside
   * one as the text it is.
   */
  it("keeps a fence line that four spaces indented into a code block", () => {
    expect(
      buildChatMessagePreview("here is the snippet\n\n    ```js\n    ship it"),
    ).toContain("js");
  });

  it("shows the words a tilde fence holds, which the room shows too", () => {
    expect(buildChatMessagePreview("~~~js\nship it\n~~~")).toBe("ship it");
  });

  it("drops a fenced code block rather than blanking the preview", () => {
    expect(
      buildChatMessagePreview("this fails:\n```\nconst a = 1;\n```\nany idea?"),
    ).toBe("this fails: any idea?");
  });

  /**
   * The room finds a fence only at the start of a line, with a newline after
   * the info string and a closing run of the same width. A looser rule reads
   * `` ```<script>``` `` as a fence, eats the opening tag with it, and then
   * shows the words the room threw away with the element.
   */
  it.each(["script", "style", "textarea", "option", "xmp"])(
    "hides a <%s> that a run of backticks was written around",
    (tag) => {
      expect(
        buildChatMessagePreview(
          `\`\`\`<${tag}>\`\`\` the door code is 4417 </${tag}>`,
        ),
      ).not.toContain("4417");
    },
  );

  it("hides a comment that a run of backticks was written around", () => {
    expect(
      buildChatMessagePreview("```<!--``` the door code is 4417 -->"),
    ).not.toContain("4417");
  });

  /**
   * A run of backticks on one line is a code span, and the room shows the
   * words inside it.
   */
  it("shows the words inside a wide code span", () => {
    expect(buildChatMessagePreview("a ```the plan``` b")).toBe("a the plan b");
  });

  it("shows the words inside a code span that crosses a line end", () => {
    expect(
      buildChatMessagePreview("Hi ```\nteam. Ignore the ``` last line."),
    ).toBe("Hi team. Ignore the last line.");
  });

  /**
   * The room's parser stays inside a quoted attribute value, `>` and all.
   * Ending the tag at the first `>` leaves the rest of the address as words.
   */
  /**
   * A name runs to whitespace or `>`. The room drops a tag it does not know
   * and shows nothing of it, and the name is the writer's to choose.
   */
  it.each([
    ["dots", "<call.555-0100.to.unlock.your.account>"],
    ["a colon", "<call:555-0100>"],
    ["a slash", "<https://call.555-0100>"],
  ])("drops a tag whose name carries %s", (_name, content) => {
    expect(buildChatMessagePreview(content)).toBe("");
  });

  it("drops a tag whose attribute value carries a close bracket", () => {
    expect(
      buildChatMessagePreview(
        '<a href="https://e.test/?q=>pay me now">link</a>',
      ),
    ).toBe("link");
    expect(buildChatMessagePreview("<b title='a > secret note'>hi</b>")).toBe(
      "hi",
    );
  });

  /**
   * Every line shaped like a definition goes, wherever it sits. Markdown opens
   * a block after a heading, a rule, a setext underline and a closed fence as
   * well as after a blank line. A rule that named fewer of those left the
   * address standing, and the label beside it is a sentence the writer chose.
   * This costs a line the reader can still open in the room, which is the
   * cheaper of the two mistakes.
   */
  it.each([
    ["a heading", "# standup notes\n[call 555-0100 to unlock]: https://e.test"],
    ["a line of words", "deadline moved\n[note]: https://e.test/read-this"],
    ["four spaces of indent", "    [ref]: https://e.test/secret"],
    ["a closed fence", "```\nx\n```\n[note]: https://e.test/read-this"],
  ])("drops a definition that follows %s", (_name, content) => {
    expect(buildChatMessagePreview(content)).not.toContain("e.test");
  });

  /** The title may sit on the line below, and a label may escape a bracket. */
  it("drops a definition whose title is on the next line", () => {
    expect(buildChatMessagePreview('[a]: b\n "the secret title"')).toBe("");
  });

  it("drops a definition whose label holds an escaped bracket", () => {
    expect(buildChatMessagePreview("[a\\]x]: https://internal.example")).toBe(
      "",
    );
  });

  /** One block holds a run of them, and only the first opens the block. */
  it("drops every definition in a block, not only the first", () => {
    expect(
      buildChatMessagePreview(
        "see [a][1] and [b][2]\n\n[1]: https://internal.example/one\n[2]: https://internal.example/two",
      ),
    ).toBe("see [a][1] and [b][2]");
  });

  /** The strip repeats a fixed number of times, and a block may hold more. */
  it("drops a block of four definitions in one pass", () => {
    expect(
      buildChatMessagePreview(
        "see it\n\n[1]: https://internal.example/one\n[2]: https://internal.example/two\n[3]: https://internal.example/three\n[4]: https://internal.example/four",
      ),
    ).toBe("see it");
  });

  /**
   * The blank line that opened the block stays put. Taking it away joins the
   * next definition to the line above, and a definition that opens no block
   * is left standing with its address.
   */
  it("drops two definitions that a blank line stands between", () => {
    expect(
      buildChatMessagePreview(
        "a\n\n[1]: https://internal.example/one\n\n[2]: https://internal.example/two",
      ),
    ).toBe("a");
  });

  it("keeps a bracketed line whose colon is followed by nothing", () => {
    expect(buildChatMessagePreview("[Todo]:\nbuy milk")).toBe(
      "[Todo]: buy milk",
    );
  });

  it("keeps a line whose brackets hold no label", () => {
    expect(buildChatMessagePreview("[]: nothing\nreal words")).toBe(
      "[]: nothing real words",
    );
  });

  /**
   * The room tokenizes a fence out before it sanitizes, so markup written
   * inside one is text there. Read as markup here, an unclosed tag or comment
   * runs to the end of the body and swallows the words that follow it.
   */
  it("reads the words after a fence that holds an unclosed element", () => {
    expect(
      buildChatMessagePreview(
        "```html\n<script>\n```\n\nprod is down, roll back release 42",
      ),
    ).toBe("prod is down, roll back release 42");
  });

  it("reads the words after a fence that holds an unclosed comment", () => {
    expect(buildChatMessagePreview("```\n<!-- todo\n```\nship it")).toBe(
      "ship it",
    );
  });

  it("reads a message that carries html as its words alone", () => {
    expect(buildChatMessagePreview("Hello <b>world</b>")).toBe("Hello world");
  });

  /**
   * A name runs to whitespace or `>`, so `<di<div>` is one tag here and one
   * tag to the room, which shows `v>alert(1) hi`. The `>` goes to the blunt
   * marker strip, which is a limit this rule already carries.
   */
  it("leaves no partial tag behind when one tag hides inside another", () => {
    expect(buildChatMessagePreview("<di<div>v>alert(1)</div> hi")).toBe(
      "valert(1) hi",
    );
  });

  /**
   * The same trick around a non-text element. What the strip leaves is a
   * fragment of markup rather than words, and the words the room threw away
   * are gone either way, which is the part that matters.
   */
  it("keeps the words out of a non-text element hidden inside another tag", () => {
    expect(
      buildChatMessagePreview(
        "<scr<script>ipt>the door code is 4417</script> hi",
      ),
    ).not.toContain("4417");
  });

  /**
   * Both halves matter: without the tag name, `< 10 and y >` reads as one tag
   * and the words between it go. The `>` goes either way, because the cleaner
   * reads it as a quote marker.
   */
  it("keeps a comparison, which is not a tag", () => {
    expect(buildChatMessagePreview("use x < 10 and y > 3 as the range")).toBe(
      "use x < 10 and y 3 as the range",
    );
  });

  it("keeps two paragraphs two words apart", () => {
    expect(buildChatMessagePreview("<p>one</p><p>two</p>")).toBe("one two");
  });

  it("reads a tag that closes itself as one tag", () => {
    expect(buildChatMessagePreview("line one<br/>line two")).toBe(
      "line one line two",
    );
  });

  /**
   * A pass can reveal one more construct, so the strip repeats. It repeats a
   * fixed number of times, because a body of half-open brackets would
   * otherwise buy a pass each and cost seconds of the server's only thread.
   *
   * The budget is loose on purpose. This body takes about 18 seconds without
   * the cap and about a third of a second with it, so a second and a half
   * tells the two apart while leaving room for a machine running the rest of
   * the suite beside it.
   */
  it("reads a message of broken brackets without stalling", () => {
    const body = `${"[](".repeat(1666)}${"<a".repeat(1666)}${">".repeat(1666)}`;
    const started = performance.now();

    buildChatMessagePreview(body);

    expect(performance.now() - started).toBeLessThan(1500);
  });

  /**
   * Interleaved brackets are what buy a pass each: every tag closing at the
   * same level goes in one pass, so only this shape reaches the cap.
   */
  it("clears three levels of interleaved tags", () => {
    expect(buildChatMessagePreview("<a<b<c>>> hi")).toBe("hi");
  });

  it("keeps a link whose address is written in angle brackets", () => {
    expect(
      buildChatMessagePreview("see [the design](<https://example.test/spec>)"),
    ).toBe("see the design");
  });

  it("joins a multi-line message into one line", () => {
    expect(buildChatMessagePreview("first line\n\nsecond line")).toBe(
      "first line second line",
    );
  });

  it("names the file when the message is only a file", () => {
    expect(
      buildChatMessagePreview("[report.pdf](https://example.test/report.pdf)"),
    ).toBe("report.pdf");
  });

  it("names the image when the message is only an image", () => {
    expect(
      buildChatMessagePreview("![shot](https://example.test/shot.png)"),
    ).toBe("shot");
  });

  it("drops an image that carries no alt rather than showing its url", () => {
    expect(buildChatMessagePreview("![](https://example.test/shot.png)")).toBe(
      "",
    );
  });

  it("drops a link that carries no label rather than showing its url", () => {
    expect(buildChatMessagePreview("[](https://example.test/shot.png)")).toBe(
      "",
    );
  });

  it("drops an empty link that only appears once the outer one goes", () => {
    expect(
      buildChatMessagePreview("[[]()](https://example.test/shot.png)"),
    ).toBe("");
  });

  it("keeps the words of a message whose image carries no alt", () => {
    expect(
      buildChatMessagePreview(
        "here is the chart\n![](data:image/png;base64,iVBORw0KGgoAAAANSUhEUg)",
      ),
    ).toBe("here is the chart");
  });

  it("keeps the file's name beside the words that came with it", () => {
    expect(
      buildChatMessagePreview(
        "here it is [report.pdf](https://example.test/report.pdf)",
      ),
    ).toBe("here it is report.pdf");
  });

  it("names every image when a message carries more than one", () => {
    expect(
      buildChatMessagePreview(
        "![one](https://example.test/1.png) ![two](https://example.test/2.png)",
      ),
    ).toBe("one two");
  });

  it("drops every unlabelled link, not only the first", () => {
    expect(
      buildChatMessagePreview(
        "[](https://example.test/1.png)[](https://example.test/2.png)" +
          "[](https://example.test/3.png)[](https://example.test/4.png)",
      ),
    ).toBe("");
  });

  it("names every file when a message carries more than one", () => {
    expect(
      buildChatMessagePreview(
        "[a.pdf](https://example.test/a.pdf) [b.pdf](https://example.test/b.pdf)",
      ),
    ).toBe("a.pdf b.pdf");
  });

  it("returns nothing when the body cleans to nothing", () => {
    expect(buildChatMessagePreview("   \n  ")).toBe("");
  });

  it("cuts a long message and says it was cut", () => {
    const preview = buildChatMessagePreview("a".repeat(400));

    expect([...preview]).toHaveLength(CHAT_MESSAGE_PREVIEW_MAX_LENGTH);
    expect(preview.endsWith("…")).toBe(true);
  });

  it("leaves a message at the limit whole", () => {
    const body = "a".repeat(CHAT_MESSAGE_PREVIEW_MAX_LENGTH);

    expect(buildChatMessagePreview(body)).toBe(body);
  });

  /**
   * The limit counts codepoints, so a message of emoji at the limit is whole
   * too. Counting the string's length instead would cut it and claim a cut
   * that the reader's message did not have.
   */
  it("leaves a message of emoji at the limit whole", () => {
    const body = "\u{1F642}".repeat(CHAT_MESSAGE_PREVIEW_MAX_LENGTH);

    expect(buildChatMessagePreview(body)).toBe(body);
  });

  it("does not leave a space hanging before the ellipsis", () => {
    const preview = buildChatMessagePreview(
      `${"a".repeat(CHAT_MESSAGE_PREVIEW_MAX_LENGTH - 2)} ${"b".repeat(50)}`,
    );

    expect(preview.endsWith("a\u2026")).toBe(true);
  });

  it("never cuts inside a character built from several codepoints", () => {
    const family = "\u{1F468}\u200D\u{1F469}\u200D\u{1F467}\u200D\u{1F466}";
    const preview = buildChatMessagePreview(family.repeat(40));

    expect(preview.endsWith(`${family}\u2026`)).toBe(true);
    expect([...preview].length).toBeLessThanOrEqual(
      CHAT_MESSAGE_PREVIEW_MAX_LENGTH,
    );
  });

  /**
   * The ellipsis stands for the words it replaced. On its own it stands for
   * nothing, and the caller reads an empty preview as "show the sender".
   */
  it("returns nothing when one character is longer than the whole limit", () => {
    const body = `a${"\u0301".repeat(CHAT_MESSAGE_PREVIEW_MAX_LENGTH)}`;

    expect(buildChatMessagePreview(body)).toBe("");
  });

  it("never cuts inside an emoji", () => {
    const preview = buildChatMessagePreview("🙂".repeat(400));

    expect([...preview]).toHaveLength(CHAT_MESSAGE_PREVIEW_MAX_LENGTH);
    expect(preview.endsWith("🙂…")).toBe(true);
  });
});
