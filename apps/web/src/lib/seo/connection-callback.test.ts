import { describe, expect, it } from "vitest";
import {
  readSeoConnectionCallback,
  seoConnectionCallbackUrl,
  seoConnectionReturnPath,
} from "./connection-callback";

const ID = "39d1c2a6-aade-4322-aed5-3f139a34b127";
const path = (query: string) =>
  seoConnectionReturnPath(new URLSearchParams(query));

describe("seoConnectionReturnPath", () => {
  it("returns to an Audit or a Project's own SEO workspace, and to /seo for anything else", () => {
    expect(path(`auditId=${ID}`)).toBe(`/seo?auditId=${ID}`);
    expect(path(`projectId=${ID}&view=project`)).toBe(
      `/seo?projectId=${ID}&view=project`,
    );
    expect(path(`projectId=${ID}`)).toBe("/seo");
    expect(path("projectId=https://untrusted.example/&view=project")).toBe(
      "/seo",
    );
  });
  it("carries the return page through the provider callback to the return page", () => {
    const returned = (search: string) =>
      readSeoConnectionCallback(
        new URL(
          seoConnectionCallbackUrl({
            origin: "https://app.example",
            search,
            provider: "ga4",
            viewerId: "u1",
            organizationId: null,
            nonce: "n",
          }),
        ).searchParams,
      )?.returnPath;
    expect(returned(`?projectId=${ID}&view=project&tab=agent`)).toBe(
      `/seo?projectId=${ID}&view=project`,
    );
    expect(returned(`?projectId=${ID}&auditId=${ID}`)).toBe(
      `/seo?auditId=${ID}`,
    );
    expect(returned(`?projectId=${ID}`)).toBe("/seo");
  });
});
