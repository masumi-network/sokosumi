import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  cmoFindUnique,
  cmoUpdate,
  resetCmoServiceMocks,
} from "@/test-fixtures/cmo-service";

vi.mock(
  "@/lib/db/prisma",
  async () =>
    (await import("@/test-fixtures/cmo-service")).cmoServiceMocks.prisma,
);
vi.mock(
  "@/services/social-posts.service",
  async () =>
    (await import("@/test-fixtures/cmo-service")).cmoServiceMocks.socialPosts,
);
vi.mock(
  "@/services/soko-bot-shared-create.service",
  async () =>
    (await import("@/test-fixtures/cmo-service")).cmoServiceMocks.sharedCreate,
);
vi.mock(
  "@/services/soko-bot-control-plane.service",
  async () =>
    (await import("@/test-fixtures/cmo-service")).cmoServiceMocks.controlPlane,
);
vi.mock(
  "@/helpers/organization-workspace",
  async () =>
    (await import("@/test-fixtures/cmo-service")).cmoServiceMocks
      .organizationWorkspace,
);
vi.mock(
  "@/helpers/user-workspaces",
  async () =>
    (await import("@/test-fixtures/cmo-service")).cmoServiceMocks
      .userWorkspaces,
);
vi.mock(
  "@/helpers/subscription",
  async () =>
    (await import("@/test-fixtures/cmo-service")).cmoServiceMocks.subscription,
);
vi.mock(
  "@/services/soko-bot-billing.service",
  async () =>
    (await import("@/test-fixtures/cmo-service")).cmoServiceMocks.billing,
);
vi.mock(
  "@vercel/functions",
  async () =>
    (await import("@/test-fixtures/cmo-service")).cmoServiceMocks
      .vercelFunctions,
);
vi.mock(
  "@/services/soko-bot-integration-connection.service",
  async () =>
    (await import("@/test-fixtures/cmo-service")).cmoServiceMocks
      .integrationConnection,
);
vi.mock("@/config/env", async (importOriginal) =>
  (await import("@/test-fixtures/cmo-service")).cmoServiceMocks.env(
    await importOriginal<typeof import("@/config/env")>(),
  ),
);

import {
  answerCmoBrandQuestion,
  saveCmoBrandBrain,
} from "./cmo-brand-brain.service";

beforeEach(resetCmoServiceMocks);

describe("saveCmoBrandBrain", () => {
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
    cmoFindUnique.mockResolvedValue({ id: "cmo-1", brandBrain: null });
    cmoUpdate.mockClear();
    await saveCmoBrandBrain(
      { sokoBotId: "bot-1" },
      { sections: { pricing: section("From 9 dollars") } },
    );
    const data = cmoUpdate.mock.calls[0]?.[0].data;
    expect(data.brandBrain).toEqual({
      profile: {
        pricing: { ...section("From 9 dollars"), openQuestions: [] },
      },
    });
    // The owner only sees a Brand Brain once it has its essentials.
    expect(data.brandBrainUpdatedAt).toBeUndefined();
  });

  it("merges later saves: a sent section replaces its own, the rest stay", async () => {
    cmoFindUnique.mockResolvedValue({
      id: "cmo-1",
      brandBrain: {
        profile: {
          pricing: section("From 9 dollars"),
          company: section("Founded 2019"),
        },
      },
    });
    cmoUpdate.mockClear();
    await saveCmoBrandBrain(
      { sokoBotId: "bot-1" },
      {
        brandBrain: { ...essentials, profile: {} },
        sections: { pricing: section("From 12 dollars") },
      },
    );
    const data = cmoUpdate.mock.calls[0]?.[0].data;
    expect(data.brandBrain.summary).toBe("Acme sells rockets.");
    expect(data.brandBrain.profile.pricing.answer).toBe("From 12 dollars");
    expect(data.brandBrain.profile.company.answer).toBe("Founded 2019");
    expect(data.brandBrainUpdatedAt).toBeInstanceOf(Date);
  });

  it("keeps the essentials when only sections change", async () => {
    cmoFindUnique.mockResolvedValue({
      id: "cmo-1",
      brandBrain: { ...essentials, profile: {} },
    });
    cmoUpdate.mockClear();
    await saveCmoBrandBrain(
      { userId: "user-1" },
      { sections: { company: section("Founded 2019") } },
    );
    const data = cmoUpdate.mock.calls[0]?.[0].data;
    expect(data.brandBrain.summary).toBe("Acme sells rockets.");
    expect(data.brandBrain.profile.company.answer).toBe("Founded 2019");
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
    id: "cmo-1",
    brandBrain: {
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

  beforeEach(() => {
    cmoUpdate.mockClear();
  });

  it("puts a yes into its section as a confirmed finding", async () => {
    cmoFindUnique.mockResolvedValue(stored());

    await answerCmoBrandQuestion("user-1", {
      questionId: question.id,
      answer: "yes",
    });

    const brain = cmoUpdate.mock.lastCall?.[0].data.brandBrain;
    expect(brain.questions[0].answer).toBe("yes");
    expect(brain.profile.marketing.findings[0]).toMatchObject({
      point: question.statement,
      evidence: "fact",
      confidence: "high",
    });
    expect(brain.profile.marketing.findings).toHaveLength(2);
  });

  it("replaces an earlier answer's finding with what the no says is true", async () => {
    cmoFindUnique.mockResolvedValue(
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

    await answerCmoBrandQuestion("user-1", {
      questionId: question.id,
      answer: "no",
      note: "Most come through LinkedIn",
    });

    const brain = cmoUpdate.mock.lastCall?.[0].data.brandBrain;
    expect(brain.questions[0]).toMatchObject({
      answer: "no",
      note: "Most come through LinkedIn",
    });
    expect(
      brain.profile.marketing.findings.map((f: { point: string }) => f.point),
    ).toEqual(["Most come through LinkedIn"]);
  });

  it("records not sure without touching the section", async () => {
    cmoFindUnique.mockResolvedValue(stored());

    await answerCmoBrandQuestion("user-1", {
      questionId: question.id,
      answer: "unsure",
    });

    const brain = cmoUpdate.mock.lastCall?.[0].data.brandBrain;
    expect(brain.questions[0].answer).toBe("unsure");
    expect(brain.profile.marketing.findings).toHaveLength(1);
  });

  it("refuses an answer to a question that is not there", async () => {
    cmoFindUnique.mockResolvedValue(stored());

    await expect(
      answerCmoBrandQuestion("user-1", { questionId: "nope", answer: "yes" }),
    ).rejects.toThrow("not in the Brand Brain");
    expect(cmoUpdate).not.toHaveBeenCalled();
  });

  it("keeps the owner's answers when Cuso saves the questions again", async () => {
    cmoFindUnique.mockResolvedValue(
      stored({ questions: [{ ...question, answer: "no", note: "LinkedIn" }] }),
    );
    const { brandBrain } = stored();

    await saveCmoBrandBrain(
      { sokoBotId: "bot-1" },
      { brandBrain: { ...brandBrain, questions: [question] } },
    );

    const saved = cmoUpdate.mock.lastCall?.[0].data.brandBrain;
    expect(saved.questions[0]).toMatchObject({
      answer: "no",
      note: "LinkedIn",
    });
  });
});
