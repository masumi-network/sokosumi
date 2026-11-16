import { describe, expect, it, vi } from "vitest";
import type { EmbedTexts } from "@/lib/embeddings";
import { findRepeats } from "@/lib/repeats";

/** One dimension per topic a text names, plus a little of everything. */
function fakeEmbed(topics: readonly RegExp[]): EmbedTexts & {
  calls: string[][];
} {
  const calls: string[][] = [];
  const embed = async (values: readonly string[]) => {
    calls.push([...values]);
    return {
      costUsd: 0.000_01 * values.length,
      embeddings: values.map((value) => {
        const vector: number[] = topics.map((topic) =>
          topic.test(value) ? 1 : 0,
        );
        vector.push(0.1);
        return vector;
      }),
    };
  };
  return Object.assign(embed, { calls });
}

describe("findRepeats", () => {
  it("names the earlier text a text says again, by meaning", async () => {
    const embed = fakeEmbed([/staking|stake/i, /esim|travel/i]);
    const { repeats, costUsd } = await findRepeats(
      [
        "Stake ADA from Begin Wallet (a1)",
        "Travel with an eSIM paid in crypto (a1)",
        "Begin Wallet makes staking simple (a1)",
      ],
      "post",
      embed,
    );

    expect(repeats).toEqual([null, null, 0]);
    expect(costUsd).toBeCloseTo(0.000_03);
  });

  it("calls a post a repeat at 0.88 and a title at 0.86", async () => {
    // Each text sits at its cosine from the first, the two on either side of it.
    const at =
      (scores: Record<string, number>): EmbedTexts =>
      async (values) => ({
        costUsd: 0,
        embeddings: values.map((value) => {
          const score = scores[value] ?? 1;
          const side = value.startsWith("Close ") ? -1 : 1;
          return [score, side * Math.sqrt(1 - score * score)];
        }),
      });
    const texts = ["Base (g1)", "Close (g1)", "Closer (g1)"];
    const embed = at({ "Close (g1)": 0.87, "Closer (g1)": 0.89 });

    expect((await findRepeats(texts, "post", embed)).repeats).toEqual([
      null,
      null,
      0,
    ]);
    const titles = ["Base (g2)", "Close (g2)", "Closer (g2)"];
    expect(
      (
        await findRepeats(
          titles,
          "title",
          at({ "Close (g2)": 0.85, "Closer (g2)": 0.865 }),
        )
      ).repeats,
    ).toEqual([null, null, 0]);
  });

  it("keeps texts on different topics apart", async () => {
    const embed = fakeEmbed([/staking/i, /esim/i, /governance/i]);
    const { repeats } = await findRepeats(
      [
        "Staking in two taps (b1)",
        "An eSIM for the trip (b1)",
        "Vote on governance (b1)",
      ],
      "title",
      embed,
    );

    expect(repeats).toEqual([null, null, null]);
  });

  it("embeds each text once, however often it is checked", async () => {
    const embed = fakeEmbed([/staking/i, /esim/i]);
    const month = ["Staking basics (c1)", "eSIM basics (c1)"];
    await findRepeats(month, "post", embed);
    await findRepeats([...month, "More on staking (c1)"], "post", embed);

    expect(embed.calls).toEqual([month, ["More on staking (c1)"]]);
  });

  it("skips the check when the embedding model fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const failing: EmbedTexts = async () => {
      throw new Error("Gateway timeout");
    };

    const result = await findRepeats(
      ["Staking (d1)", "Staking again (d1)"],
      "post",
      failing,
    );

    expect(result).toEqual({ repeats: [null, null], costUsd: 0 });
    expect(warn).toHaveBeenCalledWith(
      "[repeats] embedding failed; check skipped",
      expect.any(Error),
    );
    warn.mockRestore();
  });

  it("skips the check when the embedding model is slow, and keeps what it returns later", async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const embed = fakeEmbed([/staking/i]);
    const slow: EmbedTexts = (values) =>
      new Promise((resolve) =>
        setTimeout(() => resolve(embed(values)), 60_000),
      );
    const month = ["Staking (f1)", "Staking again (f1)"];

    const checking = findRepeats(month, "post", slow);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await checking).toEqual({ repeats: [null, null], costUsd: 0 });
    await vi.advanceTimersByTimeAsync(60_000);
    vi.useRealTimers();
    warn.mockRestore();

    expect((await findRepeats(month, "post", embed)).repeats).toEqual([
      null,
      0,
    ]);
    expect(embed.calls).toEqual([month]);
  });

  it("leaves blank texts out", async () => {
    const embed = fakeEmbed([/staking/i]);
    const { repeats } = await findRepeats(
      ["  ", "Staking (e1)", "", "Staking again (e1)"],
      "post",
      embed,
    );

    expect(repeats).toEqual([null, null, null, 1]);
    expect(embed.calls).toEqual([["Staking (e1)", "Staking again (e1)"]]);
  });
});
