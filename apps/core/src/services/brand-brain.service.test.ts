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
  saveBrandBrain,
} from "./brand-brain.service";

const PROJECT_ID = "project-1";

beforeEach(resetCmoServiceMocks);

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
});
