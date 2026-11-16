import { describe, expect, it } from "vitest";
import {
  SeoWorkspaceLoadError,
  seoLoadErrorStatus,
  seoLoadRecovery,
  shouldRetrySeoLoad,
} from "./seo-load-error-model";

const AUDIT = "687d2470-7c63-4779-b10c-462d24ac1e1b";
describe("SEO load error model", () => {
  it("retains HTTP status without exposing the server's private message", () => {
    const failure = new SeoWorkspaceLoadError(404);
    expect(seoLoadErrorStatus(failure)).toBe(404);
    expect(
      seoLoadErrorStatus({ status: 503, message: "private details" }),
    ).toBe(503);
    for (const error of [
      null,
      "404",
      { status: "404" },
      { status: 200 },
      { status: 600 },
    ])
      expect(seoLoadErrorStatus(error)).toBeUndefined();
  });

  it.each([401, 403, 404, 409])(
    "keeps status %s contextual without a repeated failing retry",
    (status) => {
      expect(seoLoadRecovery({ status })).toMatchObject({
        contextual: true,
        canRetry: false,
        titleKey: "unavailableTitle",
        bodyKey: "unavailableBody",
      });
      // A named Audit or Project says what is missing, and where it may be.
      expect(
        seoLoadRecovery({ status, owner: { kind: "audit", id: AUDIT } }),
      ).toMatchObject({
        titleKey: "auditNotHereTitle",
        bodyKey: "notHereBody",
      });
      expect(
        seoLoadRecovery({ status, owner: { kind: "project", id: AUDIT } }),
      ).toMatchObject({
        titleKey: "projectNotHereTitle",
        bodyKey: "notHereBody",
      });
      // A selected page can be the missing part: the Audit itself may be here.
      expect(
        seoLoadRecovery({
          status,
          owner: { kind: "audit", id: AUDIT },
          hasSelection: true,
        }),
      ).toMatchObject({
        titleKey: "unavailableTitle",
        bodyKey: "unavailableBody",
      });
    },
  );

  it.each([undefined, 429, 500, 502, 503, 504])(
    "keeps an explicit retry for transient status %s",
    (status) => {
      expect(seoLoadRecovery({ status })).toMatchObject({
        contextual: false,
        canRetry: true,
        titleKey: "errorTitle",
        bodyKey: "errorBody",
      });
      // A failed read says nothing about where the Audit lives.
      expect(
        seoLoadRecovery({ status, owner: { kind: "audit", id: AUDIT } }),
      ).toMatchObject({ titleKey: "errorTitle", bodyKey: "errorBody" });
    },
  );

  it("resets selected pages only through an explicit link to the same owner", () => {
    expect(
      seoLoadRecovery({
        status: 404,
        owner: { kind: "audit", id: AUDIT },
        hasSelection: true,
      }).allPagesHref,
    ).toBe(`/seo?auditId=${AUDIT}`);
    expect(
      seoLoadRecovery({
        status: 404,
        owner: { kind: "project", id: AUDIT },
        hasSelection: true,
      }).allPagesHref,
    ).toBe(`/seo?projectId=${AUDIT}&view=project`);
    expect(seoLoadRecovery({ status: 404 }).allPagesHref).toBeNull();
    expect(seoLoadRecovery({ invalidFilters: true }).canRetry).toBe(false);
  });

  it("rejects contextual auto-retries while retaining the normal transient retry limit", () => {
    for (const status of [401, 403, 404, 409])
      expect(shouldRetrySeoLoad(0, new SeoWorkspaceLoadError(status))).toBe(
        false,
      );
    for (const failureCount of [0, 1, 2]) {
      expect(
        shouldRetrySeoLoad(failureCount, new SeoWorkspaceLoadError(503)),
      ).toBe(true);
      expect(shouldRetrySeoLoad(failureCount, new Error("Offline"))).toBe(true);
    }
    expect(shouldRetrySeoLoad(3, new SeoWorkspaceLoadError(503))).toBe(false);
  });
});
