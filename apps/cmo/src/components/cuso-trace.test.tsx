import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { toCusoMessages } from "../lib/chat-messages";
import { cmoChatMessage, cmoOverview } from "../test-fixtures/cmo";
import { CmoApp, type CmoAppActions } from "./app/cmo-app";
import { ReasoningLine, Working } from "./cuso-trace";

const reply = cmoChatMessage({
  metadata: {
    reasoning: [
      { type: "reasoning", text: "**Picking a look**\n\nCalm, few colours." },
      { type: "reasoning", text: "Looking for a picture style", kind: "step" },
    ],
  },
});

function chat(overview = cmoOverview(), messages = [reply]) {
  return renderToStaticMarkup(
    <CmoApp
      initialView="chat"
      overview={overview}
      messages={toCusoMessages(messages)}
      name="Alice"
      email="alice@sokosumi.test"
      actions={{} as CmoAppActions}
    />,
  );
}

describe("Working", () => {
  it("shows the step Cuso is on and his latest reasoning", () => {
    const html = renderToStaticMarkup(
      <Working
        activity={{
          step: "Looking for a picture style",
          reasoning: "**Picking a look**\n\nCalm, few colours.",
        }}
      />,
    );
    expect(html).toContain("Looking for a picture style");
    expect(html).toContain("Calm, few colours.");
    expect(html).not.toContain("**");
  });

  it("says he is working before his first step, with no reasoning line", () => {
    const html = renderToStaticMarkup(<Working activity={null} />);
    expect(html).toContain("Cuso is working");
    expect(html).not.toContain("working-why");
  });
});

describe("ReasoningLine", () => {
  it("renders nothing without a summary", () => {
    expect(
      renderToStaticMarkup(
        <ReasoningLine activity={{ step: "Planning", reasoning: null }} />,
      ),
    ).toBe("");
  });
});

describe("chat", () => {
  it("replaces the typing dots with what Cuso is doing while he works", () => {
    const html = chat(
      cmoOverview({
        botStatus: "RUNNING",
        activity: {
          step: "Reading acme.io/pricing",
          reasoning: "The pricing page says who it is for.",
        },
      }),
    );
    expect(html).toContain("Reading acme.io/pricing");
    expect(html).toContain("The pricing page says who it is for.");
  });

  it("folds the steps and reasoning under his reply", () => {
    const html = chat();
    expect(html).toContain("<summary>How I got here</summary>");
    expect(html).toContain("<li>Looking for a picture style</li>");
    expect(html).toContain("<b>Picking a look</b>");
    expect(html).toContain("Calm, few colours.");
    expect(html).not.toContain("**");
    // Folded until asked for.
    expect(html).not.toContain("<details open");
  });

  it("shows no fold under a reply with nothing to tell, or an owner's message", () => {
    const html = chat(cmoOverview(), [cmoChatMessage()]);
    expect(html).not.toContain("How I got here");
  });
});
