import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  contactList: { findFirst: vi.fn() },
  contactPeopleSearch: { aggregate: vi.fn(), create: vi.fn() },
  contactSuggestion: { findMany: vi.fn(), createMany: vi.fn() },
  contact: { findMany: vi.fn() },
}));
const env = vi.hoisted(() => ({
  EXA_API_KEY: "exa-test" as string | undefined,
  FUNDRAISING_EXA_MONTHLY_CAP_USD: 25,
}));
vi.mock("@/lib/db/prisma", () => ({ default: prismaMock }));
vi.mock("@/config/env", () => ({ getEnv: () => env }));
vi.mock("@/services/contacts.service", () => ({ CONTACT_INCLUDE: {} }));

import { ExaUnavailableError } from "@/lib/soko-bot/exa";
import {
  findInvestors,
  investorProfileUrl,
  parseFoundInvestors,
  researchStatus,
} from "./fundraising-research.service";

const actor = {
  workspaceId: "11111111-1111-7111-8111-111111111111",
  userId: "alice",
  sokoBotId: null,
  organizationId: "org",
};

const answer = {
  investors: [
    {
      name: "Ann Partner",
      title: "Partner",
      firm: "Ann Capital",
      linkedin_url: "https://www.linkedin.com/in/ann-partner/",
      location: "Berlin",
      evidence: "Led the seed round of AgentPay in 2026.",
      source_url: "https://anncapital.com/portfolio",
    },
    {
      name: "Bob Known",
      firm: "Draper Dragon",
      linkedin_url: "https://linkedin.com/in/bob-known",
      evidence: "Backs agent infrastructure.",
      source_url: "https://draperdragon.com/team",
    },
    {
      name: "No Source",
      firm: "X",
      evidence: "Something",
    },
    {
      name: "Cara Angel",
      firm: "Angel",
      evidence: "Angel in three agent startups.",
      source_url: "https://news.example.com/cara",
    },
  ],
};

describe("parseFoundInvestors", () => {
  it("keeps rows with a name, firm, evidence and a source, and normalizes urls", () => {
    const parsed = parseFoundInvestors(answer);
    expect(parsed.map((row) => row.name)).toEqual([
      "Ann Partner",
      "Bob Known",
      "Cara Angel",
    ]);
    expect(parsed[0]?.linkedinUrl).toBe(
      "https://www.linkedin.com/in/ann-partner/",
    );
    expect(investorProfileUrl(parsed[2] as never)).toBe(
      "https://news.example.com/cara",
    );
    expect(parseFoundInvestors(null)).toEqual([]);
    expect(parseFoundInvestors({ investors: "none" })).toEqual([]);
  });
});

describe("findInvestors", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    env.EXA_API_KEY = "exa-test";
    prismaMock.contactList.findFirst.mockResolvedValue({
      id: "22222222-2222-7222-8222-222222222222",
      name: "Investors",
    });
    prismaMock.contactPeopleSearch.aggregate.mockResolvedValue({
      _sum: { costUsdMicros: 1_500_000 },
    });
    prismaMock.contactSuggestion.findMany.mockResolvedValue([
      { profileKey: "news.example.com/cara", name: "Cara Angel" },
    ]);
    prismaMock.contact.findMany.mockResolvedValue([
      {
        name: "Bob Known",
        organization: "Draper Dragon",
        channels: [{ value: "https://www.linkedin.com/in/bob-known/" }],
      },
    ]);
    prismaMock.contactPeopleSearch.create.mockResolvedValue({ id: "run-1" });
    prismaMock.contactSuggestion.createMany.mockResolvedValue({ count: 1 });
  });

  it("reports the month's spend against the cap", async () => {
    expect(await researchStatus(actor)).toEqual({
      monthUsd: 1.5,
      capUsd: 25,
      perSearchUsd: 0.5,
      exaConfigured: true,
    });
  });

  it("skips people already on the list or suggested, records the run and keeps the rest", async () => {
    const run = vi.fn().mockResolvedValue({
      runId: "agent_run_1",
      structured: answer,
      text: null,
      costUsd: 0.5,
      citations: [],
    });
    const result = await findInvestors(
      actor,
      { brief: "Seed investors in AI agents in Europe", size: 10 },
      { run },
    );
    expect(result.found).toBe(1);
    expect(result.costUsd).toBe(0.5);
    expect(run.mock.calls[0]?.[0]).toMatchObject({ effort: "high" });
    expect(run.mock.calls[0]?.[0].query).toContain("Bob Known (Draper Dragon)");
    expect(prismaMock.contactPeopleSearch.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          requested: 10,
          found: 1,
          costUsdMicros: 500_000,
        }),
      }),
    );
    const rows =
      prismaMock.contactSuggestion.createMany.mock.calls[0]?.[0].data;
    expect(rows).toEqual([
      expect.objectContaining({
        name: "Ann Partner",
        role: "Partner",
        organization: "Ann Capital",
        location: "Berlin",
        profileKey: "linkedin.com/in/ann-partner",
        reason: "Led the seed round of AgentPay in 2026.",
      }),
    ]);
  });

  it("tells the caller when Exa did not answer", async () => {
    const run = vi
      .fn()
      .mockRejectedValue(
        new ExaUnavailableError("Exa agent run failed: budget"),
      );
    await expect(
      findInvestors(
        actor,
        { brief: "Seed investors in Europe", size: 10 },
        { run },
      ),
    ).rejects.toMatchObject({
      status: 503,
      message: expect.stringContaining("Nothing was charged"),
    });
    expect(prismaMock.contactPeopleSearch.create).not.toHaveBeenCalled();
  });

  it("refuses past the monthly cap and without Exa, before spending anything", async () => {
    const run = vi.fn();
    prismaMock.contactPeopleSearch.aggregate.mockResolvedValue({
      _sum: { costUsdMicros: 24_800_000 },
    });
    await expect(
      findInvestors(
        actor,
        { brief: "Seed investors in Europe", size: 10 },
        { run },
      ),
    ).rejects.toMatchObject({ status: 422 });
    env.EXA_API_KEY = undefined;
    prismaMock.contactPeopleSearch.aggregate.mockResolvedValue({
      _sum: { costUsdMicros: 0 },
    });
    await expect(
      findInvestors(
        actor,
        { brief: "Seed investors in Europe", size: 10 },
        { run },
      ),
    ).rejects.toMatchObject({ status: 422 });
    expect(run).not.toHaveBeenCalled();
  });
});
