import { SOCIAL_POST_TEXT_LIMITS } from "@sokosumi/utils";
import { describe, expect, it } from "vitest";

import {
  bannedCopyProblems,
  SOCIAL_POST_WRITING_GUIDES,
  socialPostFormattingError,
  stackedCaveatsProblem,
  tagOwnLinks,
} from "./social-post-writing";

describe("social post writing guides", () => {
  it("covers every network and tells the bot to write plain text", () => {
    for (const provider of Object.keys(SOCIAL_POST_TEXT_LIMITS)) {
      const guide =
        SOCIAL_POST_WRITING_GUIDES[
          provider as keyof typeof SOCIAL_POST_WRITING_GUIDES
        ];
      expect(guide.join(" ")).toMatch(/Plain text/);
      expect(guide.join(" ")).toMatch(/first line/i);
    }
  });
});

const post = (
  body: string,
  extra: Partial<{
    firstComment: string;
    linkInPost: boolean;
    texts: string[];
  }> = {},
) => ({
  texts: extra.texts ?? [body, extra.firstComment ?? null],
  body,
  firstComment: extra.firstComment ?? null,
  linkInPost: extra.linkInPost,
});

describe("formatting a bot's post", () => {
  it("accepts a plain post with a hashtag or two", () => {
    expect(
      socialPostFormattingError(
        "x",
        post(
          "We shipped agent payments today. What would you build first? #AI",
        ),
      ),
    ).toBeNull();
  });

  it("refuses Markdown the network shows as raw symbols", () => {
    expect(
      socialPostFormattingError(
        "linkedin",
        post(
          "## Big news\n\nWe are **live**. Read the [launch post](https://nmkr.io/blog).",
          {
            linkInPost: true,
          },
        ),
      ),
    ).toBe(
      "Rewrite the post: it uses Markdown (**bold**, # headings, [label](url) links), which linkedin shows as raw symbols; write plain text.",
    );
  });

  it("refuses Markdown in a thread part or first comment", () => {
    expect(
      socialPostFormattingError(
        "x",
        post("Fine.", { texts: ["Fine.", "Use `npm i` to start"] }),
      ),
    ).toMatch(/`code`/);
  });

  it("counts hashtags against each network's cap", () => {
    expect(socialPostFormattingError("x", post("Ship it #a #b #c"))).toBe(
      "Rewrite the post: it has 3 hashtags; use at most 2 on x.",
    );
    expect(
      socialPostFormattingError("linkedin", post("Lessons\n\n#a #b #c #d #e")),
    ).toBeNull();
  });

  it("does not take a numbered point or a language name for a heading or hashtag", () => {
    expect(
      socialPostFormattingError(
        "x",
        post("#1 lesson: talk to users.\nC# and F#"),
      ),
    ).toBeNull();
  });

  it("moves a link out of the post body into the first comment", () => {
    expect(
      socialPostFormattingError("x", post("New post: https://nmkr.io/blog")),
    ).toBe(
      "Rewrite the post: the link in the post body makes x show it to fewer people; move it to firstComment. A link the owner gave you still goes in firstComment; pass linkInPost true only when they said in words to put it in the post itself.",
    );
    expect(
      socialPostFormattingError(
        "linkedin",
        post("Read our notes below.", { firstComment: "https://nmkr.io" }),
      ),
    ).toBeNull();
  });

  it("keeps a link the owner asked for in the post", () => {
    expect(
      socialPostFormattingError(
        "x",
        post("New post: https://nmkr.io/blog", { linkInPost: true }),
      ),
    ).toBeNull();
  });

  it("sends back copy the writing guide bans: em dashes, stock phrases, hedges", () => {
    expect(
      socialPostFormattingError(
        "linkedin",
        post("Our new plan — a game-changer for teams. Agree?"),
      ),
    ).toBe(
      'Rewrite the post: it uses a stock phrase (game-changer, unlock, elevate, seamless, say goodbye to, reimagined, delve, leverage); it ends on engagement bait ("Agree?", "Thoughts?"); it has an em dash.',
    );
    expect(
      socialPostFormattingError("instagram", post("Sizes vary by style.")),
    ).toMatch(/hedges/);
    expect(
      socialPostFormattingError("x", post("Fine.", { firstComment: "A — B" })),
    ).toMatch(/em dash/);
  });

  it("refuses a link Instagram would not make clickable", () => {
    expect(
      socialPostFormattingError("instagram", post("Shop at https://nmkr.io")),
    ).toMatch(/link in bio/);
  });

  it("sends back fake bold letters on every network", () => {
    expect(socialPostFormattingError("x", post("𝗡𝗲𝘄 menu today."))).toMatch(
      /fake bold or italic letters/,
    );
  });

  it("sends back a wall of text where people read paragraphs, and names it", () => {
    const wall = `We changed our whole menu this spring. ${"Every dish got a second look. ".repeat(14)}`;
    const error = socialPostFormattingError("linkedin", post(wall));
    expect(error).toMatch(/wall of text/);
    expect(error).toContain('"We changed our whole menu this"');
    expect(
      socialPostFormattingError(
        "linkedin",
        // Two sentences a paragraph: one a line would read as broetry.
        post(
          wall
            .trim()
            .split(/(?<=\.) /)
            .map((sentence, index) => `${sentence}${index % 2 ? "\n\n" : " "}`)
            .join(""),
        ),
      ),
    ).toBeNull();
    expect(socialPostFormattingError("youtube", post(wall))).toBeNull();
  });
});

describe("the copy rules code checks", () => {
  it("catches the AI tells the skills ban", () => {
    expect(bannedCopyProblems("Not just a tool, but a partner.")).toEqual([
      'uses "not just X, but Y"',
    ]);
    expect(bannedCopyProblems("We tried it. The result? Faster.")).toHaveLength(
      1,
    );
    expect(bannedCopyProblems("Let that sink in.")).toHaveLength(1);
    expect(bannedCopyProblems("Thread: how we price")).toHaveLength(1);
    expect(bannedCopyProblems("Tag a friend who bakes")).toHaveLength(1);
    expect(
      bannedCopyProblems("Fresh rye today. Like if you agree"),
    ).toHaveLength(1);
    expect(
      bannedCopyProblems("Fresh rye is back: like if this is your loaf"),
    ).toHaveLength(1);
    for (const fine of [
      "We would like to know if you prefer rye.",
      "Share your screen if you want help with setup.",
      "It feels like if you had a barista at home.",
    ])
      expect(bannedCopyProblems(fine)).toEqual([]);
    expect(bannedCopyProblems("Let's delve into fees.")).toHaveLength(1);
    expect(bannedCopyProblems("We cut our fees to 3%.")).toEqual([]);
  });

  it("refuses emoji bullets and one sentence per line", () => {
    expect(bannedCopyProblems("Why:\n✅ Fast\n✅ Cheap\n✅ Simple")).toEqual([
      "uses emoji as bullets; start lines with words or '-'",
    ]);
    const broetry = Array.from({ length: 6 }, (_, i) => `Line ${i}.`).join(
      "\n\n",
    );
    expect(bannedCopyProblems(broetry)).toEqual([
      "puts every sentence on its own line; join related sentences into short paragraphs",
    ]);
  });
});

describe("stackedCaveatsProblem", () => {
  it("refuses a post that qualifies its fact twice and keeps one condition", () => {
    expect(
      stackedCaveatsProblem(
        "No monthly subscription. That does not make every operation free: fees depend on the network.",
      ),
    ).toMatch(/stacks caveats \("depend on", "does not make"\)/);
    expect(
      stackedCaveatsProblem(
        "Minting costs 2 ADA; the fee depends on the chain.",
      ),
    ).toBeNull();
  });
});

describe("tagOwnLinks", () => {
  const tags = {
    siteUrl: "https://www.nmkr.io",
    source: "linkedin",
    campaign: "cmo-2026-11",
  };

  it("tags links to the business's own site and leaves others", () => {
    expect(
      tagOwnLinks(
        "Start at https://studio.nmkr.io/pricing. Or https://cardano.org",
        tags,
      ),
    ).toBe(
      "Start at https://studio.nmkr.io/pricing?utm_source=linkedin&utm_medium=social&utm_campaign=cmo-2026-11. Or https://cardano.org",
    );
  });

  it("keeps brackets and apostrophes inside a link, and drops the prose around it", () => {
    expect(
      tagOwnLinks(
        "See https://nmkr.io/shirt_(blue) and (https://nmkr.io/it's).",
        tags,
      ),
    ).toBe(
      "See https://nmkr.io/shirt_(blue)?utm_source=linkedin&utm_medium=social&utm_campaign=cmo-2026-11 and (https://nmkr.io/it's?utm_source=linkedin&utm_medium=social&utm_campaign=cmo-2026-11).",
    );
  });

  it("keeps a link that already has UTM tags", () => {
    const text = "https://nmkr.io/?utm_source=x";
    expect(tagOwnLinks(text, tags)).toBe(text);
  });
});
