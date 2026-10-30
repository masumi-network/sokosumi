import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/config/env", () => ({
  getEnv: () => ({ EXA_API_KEY: "test-key" }),
}));

import { searchExa } from "./exa";

const fetchMock = vi.fn();

function reply(body: unknown, status = 200, headers: HeadersInit = {}) {
  return new Response(JSON.stringify(body), { status, headers });
}

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  fetchMock.mockReset();
  vi.unstubAllGlobals();
});

describe("searchExa", () => {
  it("asks for passages, drops dates on company searches and reads the company", async () => {
    fetchMock.mockResolvedValueOnce(
      reply({
        results: [
          {
            title: "SavvyCal",
            url: "https://savvycal.com/",
            highlights: ["SavvyCal is   a scheduling tool."],
            entities: [
              {
                type: "company",
                properties: {
                  name: "SavvyCal",
                  foundedYear: 2020,
                  workforce: { total: 12 },
                  headquarters: { city: "Chicago", country: "US" },
                },
              },
            ],
          },
        ],
        costDollars: { total: 0.007 },
      }),
    );
    const found = await searchExa(
      {
        query: "Scheduling tools that compete with Cal.com",
        category: "company",
        startPublishedDate: "2026-01-01",
      },
      { userIdentifier: "bot-1" },
    );
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(init.body));
    expect(url).toBe("https://api.exa.ai/search");
    expect((init.headers as Record<string, string>)["x-api-key"]).toBe(
      "test-key",
    );
    expect(body).toMatchObject({
      category: "company",
      numResults: 8,
      contents: { highlights: { maxCharacters: 700 } },
      userIdentifier: "bot-1",
    });
    expect(body.startPublishedDate).toBeUndefined();
    expect(found).toEqual({
      results: [
        {
          title: "SavvyCal",
          url: "https://savvycal.com/",
          publishedDate: undefined,
          author: undefined,
          passages: ["SavvyCal is a scheduling tool."],
          company: {
            name: "SavvyCal",
            foundedYear: 2020,
            employees: "12",
            headquarters: "Chicago, US",
            description: undefined,
          },
        },
      ],
      costUsd: 0.007,
    });
  });

  it("keeps the date on news and retries once when rate limited", async () => {
    fetchMock
      .mockResolvedValueOnce(reply({}, 429, { "retry-after": "0.01" }))
      .mockResolvedValueOnce(reply({ results: [], costDollars: {} }));
    const found = await searchExa({
      query: "Cal.com launches",
      category: "news",
      startPublishedDate: "2025-10-25",
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const body = JSON.parse(
      String((fetchMock.mock.calls[1] as [string, RequestInit])[1].body),
    );
    expect(body.startPublishedDate).toBe("2025-10-25T00:00:00.000Z");
    expect(found).toEqual({ results: [], costUsd: 0 });
  });

  it("fails plainly when Exa refuses", async () => {
    fetchMock.mockResolvedValueOnce(reply({ error: "no credits" }, 402));
    await expect(searchExa({ query: "anything" })).rejects.toThrow(
      "Exa search failed (402)",
    );
  });
});
