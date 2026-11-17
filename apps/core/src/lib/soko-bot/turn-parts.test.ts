import { describe, expect, it } from "vitest";
import {
  partTools,
  type TurnPart,
  toolEndedTurn,
  withPartHandOvers,
} from "./turn-parts";

const parts: TurnPart[] = [
  { key: "website", title: "Website", message: "Read the site", tools: [] },
  { key: "reviews", title: "Reviews", message: "Read the reviews", tools: [] },
];

describe("withPartHandOvers", () => {
  it("leaves a turn without parts as it is", async () => {
    expect(await withPartHandOvers("Do it", [], async () => "never")).toBe(
      "Do it",
    );
  });

  it("runs the parts side by side, not one after another", async () => {
    let running = 0;
    let most = 0;
    await withPartHandOvers("Do it", parts, async () => {
      running++;
      most = Math.max(most, running);
      await new Promise((resolve) => setTimeout(resolve, 10));
      running--;
      return "done";
    });
    expect(most).toBe(2);
  });

  it("adds each part's hand-over under its title, in the parts' order", async () => {
    const message = await withPartHandOvers(
      "Write the essentials",
      parts,
      (part) =>
        part.key === "website"
          ? new Promise((resolve) =>
              setTimeout(() => resolve("Pricing: $9"), 10),
            )
          : Promise.resolve("Quote: love it"),
    );
    expect(message.startsWith("Write the essentials\n\n")).toBe(true);
    expect(message.indexOf("### Website\nPricing: $9")).toBeGreaterThan(0);
    expect(message.indexOf("### Reviews\nQuote: love it")).toBeGreaterThan(
      message.indexOf("### Website"),
    );
  });

  it("tries a failed part once more", async () => {
    let tries = 0;
    const message = await withPartHandOvers(
      "Go",
      [parts[0] as TurnPart],
      async () => {
        tries++;
        if (tries === 1) throw new Error("Gateway request failed");
        return "Pricing: $9";
      },
    );
    expect(tries).toBe(2);
    expect(message).toContain("### Website\nPricing: $9");
  });

  it("says when a part failed twice or handed nothing over, and goes on", async () => {
    const message = await withPartHandOvers("Go", parts, async (part) => {
      if (part.key === "website") throw new Error("Model gateway timed out");
      return "  ";
    });
    expect(message).toContain(
      "### Website\nThis part failed before its hand-over (Model gateway timed out).",
    );
    expect(message).toContain("### Reviews\nThis part handed nothing over.");
  });
});

describe("partTools", () => {
  it("offers a part only its own tools among the turn's", () => {
    expect(
      Object.keys(
        partTools(
          { web_fetch: 1, post_chat: 2, save_brand_brain: 3 },
          { tools: ["web_fetch", "save_brand_brain", "search_exa"] },
        ),
      ),
    ).toEqual(["web_fetch", "save_brand_brain"]);
  });
});

describe("toolEndedTurn", () => {
  const step = (...outputs: unknown[]) => ({
    toolResults: outputs.map((output) => ({ output })),
  });
  const report = (message: string) =>
    JSON.stringify({
      kind: "REPORT",
      message,
      question: null,
      observationToolCallIds: [],
    });

  it("answers with a tool's endTurn from the last step, bare or as a read", () => {
    expect(toolEndedTurn([step({ endTurn: " Done. " })])).toBe(report("Done."));
    expect(
      toolEndedTurn([
        step(
          { saved: "x" },
          { evidenceToolCallId: "c1", result: { endTurn: "Done." } },
        ),
      ]),
    ).toBe(report("Done."));
  });

  it("lets the turn go on otherwise", () => {
    expect(toolEndedTurn([])).toBeUndefined();
    expect(
      toolEndedTurn([step({ saved: "x" }), step(null, "text")]),
    ).toBeUndefined();
    expect(toolEndedTurn([step({ endTurn: "  " })])).toBeUndefined();
    expect(toolEndedTurn([step({ endTurn: 3 })])).toBeUndefined();
    // Only the step that just ran counts.
    expect(toolEndedTurn([step({ endTurn: "Done." }), step()])).toBeUndefined();
  });
});
