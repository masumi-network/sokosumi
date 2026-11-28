import type { ProjectSeoObservation } from "@sokosumi/database";
import { describe, expect, it } from "vitest";
import {
  publicSeoRedirectOrigin,
  validateSeoSiteEvidence,
} from "@/lib/seo/related-page-selection";
import type { SeoSiteEvidence } from "@/schemas/seo-site-evidence.schema";
import { projectSiteEvidence } from "./project-seo-site-evidence";

const seed = "https://example.test/",
  target = seed + "lesson",
  hub = seed + "library";
const currentAt = "2026-05-02T10:00:00.000Z",
  previousAt = "2026-05-01T10:00:00.000Z";
const sample: SeoSiteEvidence = {
  version: 1,
  complete: true,
  sampledPages: [hub],
  observations: [
    {
      sourceUrl: hub,
      targetUrl: target,
      sourceKind: "link",
      location: "content",
    },
  ],
  responses: [{ pageUrl: target, status: 404 }],
};
function snapshot(
  at = currentAt,
  evidence = sample,
  targets = [seed, target],
): ProjectSeoObservation {
  return {
    id: at,
    sourceTaskId: at,
    projectId: "project",
    auditId: null,
    sourceKey: at,
    kind: "site_evidence",
    source: "seo_worker",
    ownerId: "owner",
    visibility: "PRIVATE",
    pageIds: ["seed"],
    scopeVersion: 1,
    sourceFileId: null,
    artifactHash: "a".repeat(64),
    createdAt: new Date(at),
    observedAt: new Date(at),
    needsAuditRecheck: false,
    payload: { auditPageUrl: seed, targetUrls: targets, evidence },
  };
}
const audit: ProjectSeoObservation = {
  ...snapshot(),
  ownerId: null,
  kind: "audit_full",
  payload: {
    version: 1,
    kind: "audit_full",
    requestId: null,
    pageUrls: [seed],
    observedAt: currentAt,
    countryCode: "US",
    languageCode: "en",
    rulebookVersion: "v1",
    checks: [],
    keywords: [],
    competitors: [],
    findings: [],
    actions: [],
    coverage: { checked: 0, skipped: 0, failed: 0 },
    notes: [],
  },
};
const project = (...rows: ProjectSeoObservation[]) =>
  projectSiteEvidence(
    [audit, ...rows],
    new Set([seed]),
    {},
  ).siteEvidence?.targets.find((row) => row.targetUrl === target);

describe("private public-site evidence", () => {
  it("cites the actual broken donor and compares dated complete samples of the same target", () => {
    const prior = snapshot(previousAt, { ...sample, observations: [] });
    const result = project(snapshot(), prior);
    expect(result).toMatchObject({
      status: "fix_link",
      httpStatus: 404,
      donorUrls: [hub],
      trend: { previousAt, previousCount: 0, currentCount: 1 },
    });
    expect(result?.action).toContain(hub);
    const redirect = project(
      snapshot(currentAt, {
        ...sample,
        responses: [{ pageUrl: target, status: 301, finalUrl: seed }],
      }),
    );
    const unresolved = project(
      snapshot(currentAt, {
        ...sample,
        responses: [{ pageUrl: target, status: 301 }],
      }),
    );
    expect(unresolved?.action).toContain("Verify the destination");
    expect(redirect?.action).toContain(seed);
    expect(redirect).toMatchObject({
      status: "review_redirect",
      finalUrl: seed,
    });
  });
  it("reports three declining daily counts and names only previously observed missing donors", () => {
    const donors = [hub, seed + "topic", seed + "chapter"];
    const firstAt = "2026-04-30T23:58:00.000Z";
    const readings = (
      at: string,
      links: string[],
      opts: Partial<SeoSiteEvidence> = {},
    ) =>
      snapshot(at, {
        ...sample,
        sampledPages: donors,
        observations: links.map((sourceUrl) => ({
          sourceUrl,
          targetUrl: target,
          sourceKind: "link",
          location: "content",
        })),
        responses: [{ pageUrl: target, status: 200 }],
        ...opts,
      });
    const first = readings(firstAt, donors),
      second = readings(previousAt, donors.slice(0, 2)),
      current = readings(currentAt, [hub]);
    const result = project(current, second, first);
    expect(result?.trend?.decline).toEqual({
      points: [
        { at: firstAt, count: 3 },
        { at: previousAt, count: 2 },
        { at: currentAt, count: 1 },
      ],
      missingDonorUrls: [donors[1], donors[2]],
    });
    expect(result?.action).toContain(donors[1]!);
    for (const responses of [[], [{ pageUrl: target, status: 204 }]]) {
      const unchecked = project(
        readings(currentAt, [hub], { responses }),
        second,
        first,
      );
      expect(unchecked?.trend?.decline).toEqual(result?.trend?.decline);
      expect(unchecked?.action).not.toContain("restore it");
    }
    expect(project(current, second)?.trend?.decline).toBeUndefined();
    expect(
      project(current, readings("2026-05-01T11:00:00.000Z", [hub]), second)
        ?.trend?.decline,
    ).toBeUndefined();
    expect(
      project(
        current,
        readings("2026-05-01T11:00:00.000Z", donors),
        second,
        first,
      )?.trend?.decline,
    ).toBeUndefined();
    expect(
      project(readings(currentAt, [hub], { complete: false }), second, first)
        ?.trend,
    ).toBeUndefined();
    expect(
      project(
        readings(currentAt, [hub], { sampledPages: donors.slice(0, 2) }),
        second,
        first,
      )?.trend?.decline,
    ).toBeUndefined();
    expect(
      project(
        readings(currentAt, [hub], {
          responses: [{ pageUrl: target, status: 404 }],
        }),
        second,
        first,
      )?.status,
    ).toBe("fix_link");
    expect(
      project(
        readings(currentAt, [hub], {
          responses: [{ pageUrl: target, status: 301, finalUrl: seed }],
        }),
        second,
        first,
      )?.status,
    ).toBe("review_redirect");
  });
  it("reviews an observed body link before proposing a new link", () => {
    const ok = { pageUrl: target, status: 200 };
    const existing = project(
      snapshot(currentAt, {
        ...sample,
        observations: [
          {
            sourceUrl: hub,
            targetUrl: target,
            sourceKind: "link",
            location: "body",
          },
        ],
        responses: [ok],
      }),
    );
    expect(existing?.action).toContain("Review the existing link on " + hub);
    expect(
      project(
        snapshot(currentAt, { ...sample, observations: [], responses: [ok] }),
      )?.action,
    ).toContain("No link was observed in these sampled pages.");
  });
  it("serves both in-period report versions without borrowing another Task's snapshot", () => {
    const priorAudit = {
      ...audit,
      sourceTaskId: previousAt,
      observedAt: new Date(previousAt),
    };
    const older = snapshot(previousAt, { ...sample, observations: [] });
    const rows = [audit, priorAudit, snapshot(), older];
    const views = projectSiteEvidence(rows, new Set([seed]), {});
    expect(views.siteEvidence?.taskId).toBe(currentAt);
    expect(
      views.auditSiteEvidence?.map((v) => [v.taskId, v.targets[1]?.donorUrls]),
    ).toEqual([
      [currentAt, [hub]],
      [previousAt, []],
    ]);
    expect(
      projectSiteEvidence(rows, new Set([seed]), {
        from: "2026-05-02",
      }).auditSiteEvidence?.map((v) => v.taskId),
    ).toEqual([currentAt]);
    expect(
      projectSiteEvidence(rows, new Set([hub]), {}).auditSiteEvidence,
    ).toEqual([]);
  });
  it("never treats a missing target, missed donor, different owner or incomplete sample as a trend", () => {
    const older = snapshot(previousAt);
    for (const prior of [
      snapshot(previousAt, sample, [seed]),
      snapshot(previousAt, { ...sample, sampledPages: [seed] }),
      snapshot(previousAt, { ...sample, complete: false }),
      { ...older, ownerId: "other" },
      { ...older, scopeVersion: 2 },
    ])
      expect(project(snapshot(), prior)?.trend).toBeUndefined();
    expect(
      project(snapshot(currentAt, { ...sample, complete: false }), older)
        ?.trend,
    ).toBeUndefined();
    expect(project({ ...snapshot(), sourceTaskId: "another" })).toBeUndefined();
  });
  it("joins an exact Google URL from this private Task and preserves its original check time", () => {
    const hash = "b".repeat(64);
    const page = {
      pageUrl: target,
      verdict: "FAIL",
      coverageState: "Not found (404)",
      robotsTxtState: null,
      lastCrawlTime: null,
      googleCanonical: null,
      userCanonical: null,
      indexingState: null,
      pageFetchState: null,
    };
    const receipt: ProjectSeoObservation = {
      ...snapshot(),
      source: "search_console",
      kind: "index_inspection",
      artifactHash: hash,
      payload: {
        contextFingerprint: hash,
        propertyId: "sc-domain:example.test",
        reusedCheckedAt: { [target]: previousAt },
        receipt: {
          version: 1,
          taskId: currentAt,
          checkedAt: currentAt,
          auditPageUrl: seed,
          receiptHash: hash,
          status: "available",
          pages: [page],
        },
      },
    };
    expect(project(snapshot(), receipt)).toMatchObject({
      googleReason: "Not found (404)",
      googleCheckedAt: previousAt,
    });
    const stored = receipt.payload as { receipt: { pages: unknown[] } };
    const alternate = {
      ...receipt,
      payload: {
        ...stored,
        receipt: {
          ...stored.receipt,
          pages: [
            {
              ...page,
              verdict: "NEUTRAL",
              coverageState: null,
              googleCanonical: hub,
            },
          ],
        },
      },
    } as ProjectSeoObservation;
    expect(
      project(
        snapshot(currentAt, {
          ...sample,
          observations: [],
          responses: [{ pageUrl: target, status: 200 }],
        }),
        alternate,
      )?.action,
    ).toContain("Google reported a duplicate or alternate page");
    expect(
      project(snapshot(), { ...receipt, ownerId: "another" })?.googleReason,
    ).toBeUndefined();
    expect(
      projectSiteEvidence([audit, snapshot(), receipt], new Set([seed]), {})
        .siteEvidence?.targets[0]?.googleReason,
    ).toBeUndefined();
  });
  it("rejects private, foreign and unobserved donors and limits redirect proof to the approved seed", () => {
    for (const sourceUrl of [
      seed + "login",
      seed + "reset-password/customer",
      seed + "users/someone%40example.com",
      seed + "invite/6bba1b36-ac42-4571-b7cf-72d353044572",
      seed + "%2561dmin",
      seed + "library?token=abc",
      "https://foreign.test/",
      "https://www.example.test/",
    ]) {
      expect(() =>
        validateSeoSiteEvidence(
          { ...sample, sampledPages: [sourceUrl] },
          [seed, target],
          null,
        ),
      ).toThrow();
    }
    expect(() =>
      validateSeoSiteEvidence(
        { ...sample, sampledPages: [] },
        [seed, target],
        null,
      ),
    ).toThrow();
    const alias = "https://www.example.test";
    const evidence = {
      ...sample,
      responses: [{ pageUrl: seed, status: 301, finalUrl: alias + "/" }],
    };
    expect(publicSeoRedirectOrigin(seed, evidence, null)).toBe(alias);
    expect(
      publicSeoRedirectOrigin(
        seed,
        {
          ...evidence,
          responses: [{ pageUrl: hub, status: 301, finalUrl: alias + "/" }],
        },
        null,
      ),
    ).toBeUndefined();
  });
});

it("exposes draft eligibility only on directly sampled HTTP 200 pages", () => {
  const good = {
    ...sample,
    sampledPages: [target],
    responses: [
      { pageUrl: target, status: 200, sitemapEligible: true as const },
    ],
  };
  expect(project(snapshot(currentAt, good))?.sitemapEligible).toBe(true);
  for (const invalid of [
    {
      ...good,
      responses: [
        { pageUrl: target, status: 302, sitemapEligible: true as const },
      ],
    },
    { ...good, sampledPages: [] },
  ]) {
    expect(() =>
      validateSeoSiteEvidence(
        { ...invalid, observations: [] },
        [seed, target],
        undefined,
      ),
    ).toThrow(/draft sitemap/);
  }
});

it("uses a directly sampled alternate canonical before recommending new internal links", () => {
  const preferred = seed + "guide";
  const evidence = {
    ...sample,
    sampledPages: [hub, target],
    observations: [],
    responses: [{ pageUrl: target, status: 200, declaredCanonical: preferred }],
  };
  validateSeoSiteEvidence(evidence, [seed, target], null);
  const result = project(snapshot(currentAt, evidence));
  expect(result).toMatchObject({
    status: "review",
    declaredCanonical: preferred,
    action: expect.stringContaining(preferred),
  });
  expect(result?.action).toContain("declares");
  for (const invalid of [
    target,
    "https://other.test/page",
    seed + "private/page",
  ]) {
    expect(() =>
      validateSeoSiteEvidence(
        {
          ...evidence,
          responses: [
            { ...evidence.responses[0]!, declaredCanonical: invalid },
          ],
        },
        [seed, target],
        null,
      ),
    ).toThrow();
  }
});

it("excludes executable downloads from sitemap drafts at admission and on historical reads", () => {
  const file = seed + "download.dmg";
  const evidence: SeoSiteEvidence = {
    ...sample,
    sampledPages: [file],
    observations: [],
    responses: [{ pageUrl: file, status: 200, sitemapEligible: true }],
  };
  expect(() => validateSeoSiteEvidence(evidence, [seed, file], null)).toThrow();
  const renewed = projectSiteEvidence(
    [audit, snapshot(currentAt, evidence, [seed, file])],
    new Set([seed]),
    {},
  );
  const observed = renewed.siteEvidence?.targets.find(
    (row) => row.targetUrl === file,
  );
  expect(observed?.httpStatus).toBe(200);
  expect(observed?.sitemapEligible).toBeUndefined();
});
