import { describe, expect, it } from "vitest";
import { type TurnPart, withPartHandOvers } from "./turn-parts";

const parts: TurnPart[] = [
  { key: "website", title: "Website", message: "Read the site" },
  { key: "reviews", title: "Reviews", message: "Read the reviews" },
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

  it("says when a part failed or handed nothing over, and goes on", async () => {
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
