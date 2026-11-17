import { expect, it } from "vitest";
import { parsePublicSeoArtifact } from "@/helpers/project-seo-report";
import { legacyReport } from "@/test-fixtures/project-seo";
import { checkIdentity, issueIdentity } from "./project-seo-check-identity";

it("normalizes equivalent URLs but keeps the measured rulebook separate from issue identity", () => {
  const source = parsePublicSeoArtifact(legacyReport());
  const first = {
    pageUrl: "https://EXAMPLE.com:443/guide#top",
    rowId: "AC-20",
    device: null,
  };
  const equivalent = { ...first, pageUrl: "https://example.com/guide" };
  expect(checkIdentity(source, first)).toBe(checkIdentity(source, equivalent));
  const newer = { ...source, rulebookVersion: "new-rulebook" };
  expect(checkIdentity(source, first)).not.toBe(checkIdentity(newer, first));
  expect(issueIdentity(source, first)).toBe(issueIdentity(newer, equivalent));
});
