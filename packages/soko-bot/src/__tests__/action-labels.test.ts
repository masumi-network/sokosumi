import { describe, expect, it } from "vitest";
import { withoutActionReceipts } from "../action-labels.js";

describe("withoutActionReceipts", () => {
  it("drops Core's receipt paragraph above the bot's words", () => {
    expect(
      withoutActionReceipts(
        "Configured schedule.\n\nDone — I'll remind you every Monday at 9:00.",
      ),
    ).toBe("Done — I'll remind you every Monday at 9:00.");
  });

  it("drops several receipt lines, counted, named and earlier ones", () => {
    expect(
      withoutActionReceipts(
        [
          "Created 3 Tasks: [A](/tasks/1), [B](/tasks/2), [C](/tasks/3).",
          "Updated social post (28×).",
          "Previously verified: Assigned task [D](/tasks/4).",
          "",
          "All set.",
        ].join("\n"),
      ),
    ).toBe("All set.");
  });

  it("keeps a reply that is only receipts", () => {
    expect(withoutActionReceipts("Configured schedule.")).toBe(
      "Configured schedule.",
    );
  });

  it("keeps a first paragraph that is the bot's own words", () => {
    const text = "Created a plan for you.\n\nHere it is.";
    expect(withoutActionReceipts(text)).toBe(text);
  });

  it("keeps a refusal, which the reader needs to see", () => {
    const text = "Not confirmed: archived task.\n\nI could not archive it.";
    expect(withoutActionReceipts(text)).toBe(text);
  });

  it("keeps a first paragraph that only starts like a receipt", () => {
    const text =
      "Already satisfied with the draft? I would still verify the numbers.\n\nHere are the details.";
    expect(withoutActionReceipts(text)).toBe(text);
  });

  it("keeps a sentence that names a label and goes on in prose", () => {
    const text = "Updated memory with your timezone.\n\nAnything else?";
    expect(withoutActionReceipts(text)).toBe(text);
  });

  it("drops a receipt whose linked target spans lines", () => {
    expect(
      withoutActionReceipts(
        "Created task [Week 1\nLaunch](/tasks/1).\n\nDone.",
      ),
    ).toBe("Done.");
  });

  it("drops a receipt naming who got the Task, and a linked-out one", () => {
    expect(
      withoutActionReceipts(
        "Created task [Plan](/tasks/1) → Ada.\nCreated table ([Open table](/drive/tables/t1)).\n\nDone.",
      ),
    ).toBe("Done.");
  });

  it("keeps prose that follows a receipt on its next line", () => {
    const text = "Created task [A](/tasks/1).\nI also moved B.\n\nDone.";
    expect(withoutActionReceipts(text)).toBe(text);
  });

  it("drops a receipt whose Task name holds an escaped bracket", () => {
    expect(
      withoutActionReceipts(
        "Created task [\\[TEST\\] Launch](/tasks/1).\n\nDone.",
      ),
    ).toBe("Done.");
  });

  it("keeps bracketed prose that starts like a receipt", () => {
    const text =
      "Already satisfied [with the draft]? I would still verify the numbers.\n\nHere are the details.";
    expect(withoutActionReceipts(text)).toBe(text);
  });

  it("keeps a linked receipt that goes on in a sentence", () => {
    const text =
      "Already satisfied [with the draft](/tasks/1)? I would still verify the numbers.\n\nHere are the details.";
    expect(withoutActionReceipts(text)).toBe(text);
    const trailing =
      "Created task [Plan](/tasks/1). I would still check it.\n\nDone.";
    expect(withoutActionReceipts(trailing)).toBe(trailing);
  });

  it("reads a link's whole label before the next receipt, even one that starts like one", () => {
    expect(
      withoutActionReceipts(
        "Created task [Week 1\nUpdated task tracker](/tasks/1).\n\nDone.",
      ),
    ).toBe("Done.");
  });

  it("drops a SEO receipt and a counted list of links", () => {
    expect(
      withoutActionReceipts(
        [
          "Created SEO action task [Fix titles](/tasks/9) ([Open SEO](/seo?projectId=p&view=project)).",
          "Archived 2 Tasks: [A](/tasks/1), [B](/tasks/2).",
          "",
          "Done.",
        ].join("\n"),
      ),
    ).toBe("Done.");
  });
});
