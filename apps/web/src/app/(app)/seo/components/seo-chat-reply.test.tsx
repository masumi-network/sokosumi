import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { SeoChatReply } from "./seo-chat-reply";

afterEach(cleanup);

function reply(text: string) {
  return render(<SeoChatReply text={text} />).container;
}

describe("SEO agent reply", () => {
  it("shows an HTML tag as the text the agent wrote, in prose and in code", () => {
    const prose = reply("The <title> is 82 characters. Add </head> later.");
    expect(prose.textContent).toBe(
      "The <title> is 82 characters. Add </head> later.",
    );
    expect(prose.querySelector("title")).toBeNull();

    const inline = reply("Your `<title>` tag and `<script>` tag stay.");
    expect(
      [...inline.querySelectorAll("code")].map((code) => code.textContent),
    ).toEqual(["<title>", "<script>"]);
    expect(inline.textContent).toContain("tag stay.");
  });

  it("keeps tags inside a list fence, an open fence and a CRLF fence", () => {
    const list = reply("- Step\n\n  ```html\n  <title>Shop</title>\n  ```\n");
    expect(list.querySelector("li pre")?.textContent).toBe(
      "<title>Shop</title>\n",
    );
    expect(
      reply("```\n<meta name=robots>").querySelector("pre")?.textContent,
    ).toBe("<meta name=robots>\n");
    expect(
      reply("```html\r\n<h1>Shop</h1>\r\n```\r\nDone").querySelector("pre")
        ?.textContent,
    ).toContain("<h1>Shop</h1>");
  });

  it("makes no element from a tag in the reply", () => {
    const html = reply(
      '<script>alert(1)</script> then <img src="https://outside.example/p.png"> and <iframe src="https://outside.example"></iframe> end',
    );
    expect(html.querySelector("script, img, iframe")).toBeNull();
    expect(html.textContent).toContain("<script>alert(1)</script> then");
    expect(html.textContent).toContain("end");
  });

  it("loads no image and keeps its alt text", () => {
    const image = reply("![Clicks by week](https://outside.example/p.png)");
    expect(image.querySelector("img")).toBeNull();
    expect(image.textContent).toBe("Clicks by week");
  });

  it("leaves signs that look like emoticons as typed", () => {
    expect(
      reply("Score <3 of 10, 8) pages, B) links, :/ and :D").textContent,
    ).toBe("Score <3 of 10, 8) pages, B) links, :/ and :D");
  });

  it("opens outside links in a new tab, and makes no link from any other address", () => {
    const auto = reply("<https://example.com/a?b=1&c=2>").querySelector("a");
    expect(auto?.getAttribute("href")).toBe("https://example.com/a?b=1&c=2");
    expect(auto?.getAttribute("target")).toBe("_blank");
    expect(auto?.getAttribute("rel")).toBe("noopener noreferrer");
    expect(
      reply("[Search Console](<https://example.com/x y>)")
        .querySelector("a")
        ?.getAttribute("href"),
    ).toBe("https://example.com/x%20y");
    for (const address of [
      "javascript:alert(1)",
      "/api/auth/sign-out",
      "//outside.example/p",
      "#top",
    ]) {
      const plain = reply(`[run](${address})`);
      expect(plain.querySelector("a")).toBeNull();
      expect(plain.textContent).toBe("run");
    }
  });

  it("shows a bare page address without its scheme and www, and keeps a named link", () => {
    const links = [
      ...reply(
        "See https://www.site.app/ and https://site.app/guides/plug-in/ or [the guide](https://site.app/guide).",
      ).querySelectorAll("a"),
    ].map((link) => [link.textContent, link.getAttribute("href")]);
    expect(links).toEqual([
      ["site.app", "https://www.site.app/"],
      ["site.app/guides/plug-in", "https://site.app/guides/plug-in/"],
      ["the guide", "https://site.app/guide"],
    ]);
  });

  it("puts reply headings below the chat heading and wraps a table", () => {
    const structure = reply(
      "# Summary\n\n| Page | Clicks |\n| --- | --- |\n| / | 4 |",
    );
    expect(structure.querySelector("h1")).toBeNull();
    expect(structure.querySelector("h4")?.textContent).toBe("Summary");
    expect(structure.querySelector("div > table")).not.toBeNull();
  });
});
