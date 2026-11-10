import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  brainFindUnique,
  brainUpdate,
  brainUpsert,
  resetCmoServiceMocks,
} from "@/test-fixtures/cmo-service";

vi.mock(
  "@/lib/db/prisma",
  async () =>
    (await import("@/test-fixtures/cmo-service")).cmoServiceMocks.prisma,
);

import {
  answerBrandBrainQuestion,
  brandBrainCorrections,
  brandBrainPreview,
  compactBrandBrain,
  parseBrandBrain,
  saveBrandBrain,
  saveBrandBrainPreview,
  saveStudioBrandCopy,
} from "./brand-brain.service";

const PROJECT_ID = "project-1";

beforeEach(resetCmoServiceMocks);

describe("saveStudioBrandCopy", () => {
  const copy = {
    summary: "A ceramics studio",
    tone: "Warm",
    audience: ["Home cooks"],
    approvedLines: ["Made from reclaimed clay."],
  };

  it("edits the shared essentials while preserving offers and other voice guidance", async () => {
    const updatedAt = new Date("2026-11-08T12:00:00.000Z");
    brainFindUnique.mockResolvedValueOnce({
      updatedAt,
      body: {
        summary: "Old description",
        voice: {
          tone: "Direct",
          do: ["Use real materials"],
          dont: ["Hype"],
          examples: [],
        },
        audience: [],
        products: ["Mugs"],
        competitors: [],
        channels: [],
        offers: [{ name: "Mug", what: "Clay mug", price: "EUR 15" }],
      },
    });
    const version = await saveStudioBrandCopy(
      PROJECT_ID,
      copy,
      updatedAt.toISOString(),
    );
    expect(brainUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: {
          updatedAt: new Date(version),
          body: expect.objectContaining({
            summary: copy.summary,
            audience: copy.audience,
            voice: {
              tone: copy.tone,
              do: ["Use real materials"],
              dont: ["Hype"],
              examples: copy.approvedLines,
            },
            offers: [{ name: "Mug", what: "Clay mug", price: "EUR 15" }],
            products: ["Mugs"],
          }),
        },
      }),
    );
  });

  it("rejects a stale version before writing", async () => {
    brainFindUnique.mockResolvedValueOnce({ updatedAt: new Date(), body: {} });
    await expect(
      saveStudioBrandCopy(PROJECT_ID, copy, null),
    ).rejects.toMatchObject({ status: 409 });
    expect(brainUpsert).not.toHaveBeenCalled();
  });
});

describe("saveBrandBrain", () => {
  const essentials = {
    summary: "Acme sells rockets.",
    voice: { tone: "Direct", do: [], dont: [], examples: [] },
    audience: ["Founders"],
    products: ["Rockets"],
    competitors: [],
    channels: [],
  };
  const section = (answer: string) => ({
    answer,
    findings: [
      {
        point: answer,
        evidence: "fact" as const,
        confidence: "high" as const,
      },
    ],
  });

  it("keeps sections in a draft until the essentials arrive", async () => {
    brainFindUnique.mockResolvedValue(null);
    await saveBrandBrain(PROJECT_ID, {
      sections: { pricing: section("From 9 dollars") },
    });
    const data = brainUpsert.mock.calls[0]?.[0].update;
    expect(data.body).toEqual({
      profile: {
        pricing: { ...section("From 9 dollars"), openQuestions: [] },
      },
    });
    // The owner only sees a Brand Brain once it has its essentials.
    expect(data.updatedAt).toBeUndefined();
  });

  it("merges later saves: a sent section replaces its own, the rest stay", async () => {
    brainFindUnique.mockResolvedValue({
      body: {
        profile: {
          pricing: section("From 9 dollars"),
          company: section("Founded 2019"),
        },
      },
    });
    await saveBrandBrain(PROJECT_ID, {
      brandBrain: { ...essentials, profile: {} },
      sections: { pricing: section("From 12 dollars") },
    });
    const data = brainUpsert.mock.calls[0]?.[0].update;
    expect(data.body.summary).toBe("Acme sells rockets.");
    expect(data.body.profile.pricing.answer).toBe("From 12 dollars");
    expect(data.body.profile.company.answer).toBe("Founded 2019");
    expect(data.updatedAt).toBeInstanceOf(Date);
  });

  it("keeps the essentials when only sections change", async () => {
    brainFindUnique.mockResolvedValue({
      body: { ...essentials, profile: {} },
    });
    await saveBrandBrain(PROJECT_ID, {
      sections: { company: section("Founded 2019") },
    });
    const data = brainUpsert.mock.calls[0]?.[0].update;
    expect(data.body.summary).toBe("Acme sells rockets.");
    expect(data.body.profile.company.answer).toBe("Founded 2019");
  });

  describe("top-level reveal, marketingToday and questions", () => {
    const reveal = {
      positioning: "Rockets for founders",
      insights: [
        { title: "One", detail: "First" },
        { title: "Two", detail: "Second" },
        { title: "Three", detail: "Third" },
      ],
      buyers: [],
    };
    const marketingToday = { summary: "Posts weekly on LinkedIn." };
    const question = {
      id: "q1",
      question: "Do customers come from Google?",
      statement: "Customers come from Google",
      section: "marketing" as const,
    };
    const storedEssentials = (extra: object = {}) => ({
      body: { ...essentials, profile: {}, questions: [], ...extra },
    });

    it("adds reveal to the stored essentials", async () => {
      brainFindUnique.mockResolvedValue(storedEssentials());
      await saveBrandBrain(PROJECT_ID, { reveal });
      const data = brainUpsert.mock.calls[0]?.[0].update;
      expect(data.body).toMatchObject({ ...essentials, reveal });
      expect(data.updatedAt).toBeInstanceOf(Date);
    });

    it("adds marketingToday to the stored essentials", async () => {
      brainFindUnique.mockResolvedValue(storedEssentials());
      await saveBrandBrain(PROJECT_ID, { marketingToday });
      const data = brainUpsert.mock.calls[0]?.[0].update;
      expect(data.body).toMatchObject({ ...essentials, marketingToday });
    });

    it("replaces the questions and keeps the owner's answers", async () => {
      brainFindUnique.mockResolvedValue(
        storedEssentials({
          questions: [{ ...question, answer: "yes" as const }],
        }),
      );
      await saveBrandBrain(PROJECT_ID, {
        questions: [question, { ...question, id: "q2" }],
      });
      const saved = brainUpsert.mock.calls[0]?.[0].update.body;
      expect(saved.summary).toBe("Acme sells rockets.");
      expect(saved.questions.map((q: { id: string }) => q.id)).toEqual([
        "q1",
        "q2",
      ]);
      expect(saved.questions[0].answer).toBe("yes");
    });

    it("lets top-level questions win over brandBrain.questions", async () => {
      brainFindUnique.mockResolvedValue(storedEssentials());
      await saveBrandBrain(PROJECT_ID, {
        brandBrain: { ...essentials, profile: {}, questions: [question] },
        questions: [{ ...question, id: "q2" }],
      });
      const saved = brainUpsert.mock.calls[0]?.[0].update.body;
      expect(saved.questions.map((q: { id: string }) => q.id)).toEqual(["q2"]);
    });

    it("adds to brandBrain sent in the same call", async () => {
      brainFindUnique.mockResolvedValue(null);
      await saveBrandBrain(PROJECT_ID, {
        brandBrain: { ...essentials, profile: {}, questions: [] },
        reveal,
      });
      const saved = brainUpsert.mock.calls[0]?.[0].update.body;
      expect(saved.reveal).toEqual(reveal);
    });

    it("refuses them while no essentials are stored", async () => {
      brainFindUnique.mockResolvedValue({ body: { profile: {} } });
      await expect(saveBrandBrain(PROJECT_ID, { reveal })).rejects.toThrow(
        "Save the essentials in brandBrain first",
      );
      expect(brainUpsert).not.toHaveBeenCalled();
    });

    it("refuses an empty questions list before it can wipe stored ones", async () => {
      brainFindUnique.mockResolvedValue(
        storedEssentials({
          questions: [{ ...question, answer: "yes" as const }],
        }),
      );
      await expect(
        saveBrandBrain(PROJECT_ID, { questions: [] }),
      ).rejects.toThrow();
      expect(brainUpsert).not.toHaveBeenCalled();
    });
  });
});

describe("Brand Brain preview", () => {
  const preview = {
    line: "Acme sells rockets to founders who ship weekly.",
    facts: ["From 9 dollars a month", "Based in Berlin"],
  };
  const essentials = {
    summary: "Acme sells rockets.",
    voice: { tone: "Direct", do: [], dont: [], examples: [] },
    audience: ["Founders"],
    products: ["Rockets"],
    competitors: [],
    channels: [],
    profile: {},
  };
  const section = {
    answer: "From 9 dollars",
    findings: [],
    openQuestions: [],
  };

  it("stores a first look beside the sections saved so far", async () => {
    brainFindUnique.mockResolvedValue({
      body: { profile: { pricing: section } },
    });
    await expect(saveBrandBrainPreview(PROJECT_ID, preview)).resolves.toBe(
      true,
    );
    const body = brainUpsert.mock.calls[0]?.[0].update.body;
    expect(body).toEqual({ profile: { pricing: section }, preview });
    expect(brandBrainPreview(body)).toEqual(preview);
  });

  it("keeps the first look while sections land", async () => {
    brainFindUnique.mockResolvedValue({ body: { profile: {}, preview } });
    await saveBrandBrain(PROJECT_ID, { sections: { pricing: section } });
    const body = brainUpsert.mock.calls[0]?.[0].update.body;
    expect(body.preview).toEqual(preview);
  });

  it("drops the first look once the essentials save", async () => {
    brainFindUnique.mockResolvedValue({ body: { profile: {}, preview } });
    await saveBrandBrain(PROJECT_ID, { brandBrain: essentials });
    const body = brainUpsert.mock.calls[0]?.[0].update.body;
    expect(body.preview).toBeUndefined();
    expect(brandBrainPreview(body)).toBeNull();
  });

  it("never writes a first look over the essentials", async () => {
    brainFindUnique.mockResolvedValue({ body: essentials });
    await expect(saveBrandBrainPreview(PROJECT_ID, preview)).resolves.toBe(
      false,
    );
    expect(brainUpsert).not.toHaveBeenCalled();
  });

  it("never reaches a turn's packet", () => {
    const packet = compactBrandBrain(
      parseBrandBrain({ ...essentials, preview }),
    );
    expect(JSON.stringify(packet)).not.toContain(preview.line);
  });

  it("reads nothing from a missing or malformed preview", () => {
    expect(brandBrainPreview(null)).toBeNull();
    expect(brandBrainPreview({ profile: {}, preview: { line: 3 } })).toBeNull();
  });
});

describe("Brand Brain questions", () => {
  const question = {
    id: "found-via-google",
    question: "Do most customers find you through Google?",
    statement: "Most customers find the business through Google",
    section: "marketing" as const,
  };
  const stored = (extra: object = {}) => ({
    body: {
      summary: "Acme sells rockets.",
      voice: { tone: "Direct", do: [], dont: [], examples: [] },
      audience: [],
      products: [],
      competitors: [],
      channels: [],
      profile: {
        marketing: {
          answer: "Mostly referrals.",
          findings: [
            {
              point: "Referrals bring most deals",
              evidence: "inference" as const,
              confidence: "low" as const,
            },
          ],
          openQuestions: [],
        },
      },
      questions: [question],
      ...extra,
    },
  });

  beforeEach(() => {});

  it("puts a yes into its section as a confirmed finding", async () => {
    brainFindUnique.mockResolvedValue(stored());

    await answerBrandBrainQuestion(PROJECT_ID, {
      questionId: question.id,
      answer: "yes",
    });

    const brain = brainUpdate.mock.lastCall?.[0].data.body;
    expect(brain.questions[0].answer).toBe("yes");
    expect(brain.profile.marketing.findings[0]).toMatchObject({
      point: question.statement,
      evidence: "fact",
      confidence: "high",
    });
    expect(brain.profile.marketing.findings).toHaveLength(2);
  });

  it("replaces an earlier answer's finding with what the no says is true", async () => {
    brainFindUnique.mockResolvedValue(
      stored({
        questions: [{ ...question, answer: "yes" }],
        profile: {
          marketing: {
            answer: "Google.",
            findings: [
              {
                point: question.statement,
                evidence: "fact",
                confidence: "high",
              },
            ],
            openQuestions: [],
          },
        },
      }),
    );

    await answerBrandBrainQuestion(PROJECT_ID, {
      questionId: question.id,
      answer: "no",
      note: "Most come through LinkedIn",
    });

    const brain = brainUpdate.mock.lastCall?.[0].data.body;
    expect(brain.questions[0]).toMatchObject({
      answer: "no",
      note: "Most come through LinkedIn",
    });
    expect(
      brain.profile.marketing.findings.map((f: { point: string }) => f.point),
    ).toEqual(["Most come through LinkedIn"]);
  });

  it("records not sure without touching the section", async () => {
    brainFindUnique.mockResolvedValue(stored());

    await answerBrandBrainQuestion(PROJECT_ID, {
      questionId: question.id,
      answer: "unsure",
    });

    const brain = brainUpdate.mock.lastCall?.[0].data.body;
    expect(brain.questions[0].answer).toBe("unsure");
    expect(brain.profile.marketing.findings).toHaveLength(1);
  });

  it("refuses an answer to a question that is not there", async () => {
    brainFindUnique.mockResolvedValue(stored());

    await expect(
      answerBrandBrainQuestion(PROJECT_ID, {
        questionId: "nope",
        answer: "yes",
      }),
    ).rejects.toThrow("not in the Brand Brain");
    expect(brainUpdate).not.toHaveBeenCalled();
  });

  it("keeps the members' answers when Cuso saves the questions again", async () => {
    brainFindUnique.mockResolvedValue(
      stored({ questions: [{ ...question, answer: "no", note: "LinkedIn" }] }),
    );
    const { body } = stored();

    await saveBrandBrain(PROJECT_ID, {
      brandBrain: { ...body, questions: [question] },
    });

    const saved = brainUpsert.mock.lastCall?.[0].update.body;
    expect(saved.questions[0]).toMatchObject({
      answer: "no",
      note: "LinkedIn",
    });
  });

  it("marks a no without a note as not true, and waits for the section to be rewritten", async () => {
    brainFindUnique.mockResolvedValue(stored());

    await answerBrandBrainQuestion(PROJECT_ID, {
      questionId: question.id,
      answer: "no",
    });

    const brain = brainUpdate.mock.lastCall?.[0].data.body;
    expect(brain.questions[0]).toMatchObject({
      answer: "no",
      corrected: false,
    });
    expect(brain.profile.marketing.findings[0].point).toBe(
      `Not true: ${question.statement}`,
    );
    expect(brandBrainCorrections(brain)).toHaveLength(1);
  });

  it("drops the not-true finding when a later yes replaces the no", async () => {
    brainFindUnique.mockResolvedValue(
      stored({
        questions: [{ ...question, answer: "no", corrected: false }],
        profile: {
          marketing: {
            answer: "Mostly referrals.",
            findings: [
              {
                point: `Not true: ${question.statement}`,
                evidence: "fact",
                confidence: "high",
              },
            ],
            openQuestions: [],
          },
        },
      }),
    );

    await answerBrandBrainQuestion(PROJECT_ID, {
      questionId: question.id,
      answer: "yes",
    });

    const brain = brainUpdate.mock.lastCall?.[0].data.body;
    expect(brain.questions[0]).not.toHaveProperty("corrected");
    expect(
      brain.profile.marketing.findings.map((f: { point: string }) => f.point),
    ).toEqual([question.statement]);
  });

  it("closes the no once its section is rewritten, and only then", async () => {
    const waiting = { ...question, answer: "no" as const, corrected: false };
    brainFindUnique.mockResolvedValue(stored({ questions: [waiting] }));

    await saveBrandBrain(PROJECT_ID, {
      sections: {
        company: { answer: "Acme builds rockets.", findings: [] },
      },
    });
    expect(
      brainUpsert.mock.lastCall?.[0].update.body.questions[0],
    ).toMatchObject({ corrected: false });

    await saveBrandBrain(PROJECT_ID, {
      sections: {
        marketing: { answer: "Mostly LinkedIn and referrals.", findings: [] },
      },
    });
    const saved = brainUpsert.mock.lastCall?.[0].update.body;
    expect(saved.questions[0]).toMatchObject({ corrected: true });
    expect(saved.profile.marketing.findings).toHaveLength(1);
  });

  it("ignores a corrected flag a save sends", async () => {
    const waiting = { ...question, answer: "no" as const, corrected: false };
    brainFindUnique.mockResolvedValue(stored({ questions: [waiting] }));
    const { body } = stored();

    await saveBrandBrain(PROJECT_ID, {
      brandBrain: { ...body, questions: [{ ...waiting, corrected: true }] },
    });

    expect(
      brainUpsert.mock.lastCall?.[0].update.body.questions[0],
    ).toMatchObject({ corrected: false });
  });
});
