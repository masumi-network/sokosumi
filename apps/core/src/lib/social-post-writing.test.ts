import { SOCIAL_POST_TEXT_LIMITS } from "@sokosumi/utils";
import { describe, expect, it } from "vitest";

import {
  SOCIAL_POST_WRITING_GUIDES,
  socialPostFormattingError,
} from "./social-post-writing";

describe("social post writing guides", () => {
  it("covers every network and tells the bot to write plain text", () => {
    for (const provider of Object.keys(SOCIAL_POST_TEXT_LIMITS)) {
      const guide =
        SOCIAL_POST_WRITING_GUIDES[
          provider as keyof typeof SOCIAL_POST_WRITING_GUIDES
        ];
      expect(guide.join(" ")).toMatch(/Plain text only/);
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

  it("refuses a link Instagram would not make clickable", () => {
    expect(
      socialPostFormattingError("instagram", post("Shop at https://nmkr.io")),
    ).toMatch(/link in bio/);
  });
});
