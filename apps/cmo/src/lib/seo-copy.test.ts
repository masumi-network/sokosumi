import { describe, expect, it } from "vitest";
import { pageChangeCopy, plainIssueDetail, withoutAuditIds } from "./seo-copy";

const ID = /\b[A-Z]{1,2}\d?-\d{2,3}\b/;

/** NMKR's weekly audit of 18 Nov 2026, as production stored it. */
const RN_01 = {
  source: "audit" as const,
  title: "Fix the HubSpot script that fails to load during rendering",
  why: "The Finding RN-01 shows that 1 of the 17 script and style files the page's main frame requested during rendering failed: https://js-eu1.hs-scripts.com/27172445.js returned net::ERR_BLOCKED_BY_ORB. This is the HubSpot tracking/chat script. Since the page cannot rely on this file loading, check why the response is blocked: an ORB block usually means the file is served with a wrong Content-Type, is redirected to a non-script response (for example an HTML error page, a consent/cookie-walled response, or a bot-block), or is served from a region/CDN path that returns an unexpected body. Verify the URL returns the JavaScript directly (correct Content-Type: application/javascript, HTTP 200, no redirect to HTML), and if the HubSpot snippet is outdated, update it to the current embed code from the HubSpot account for portal ID 27172445. If the script is not intended to load for non-browser or non-EU contexts, make sure the page degrades gracefully without it. Note: the loading check for the 20 file URLs on hosts whose robots.txt the run did not read was limited to loading only, so robots.txt on those hosts was not checked.",
  body: "Once the script loads correctly, the page's render is complete and any HubSpot chat or tracking behavior works as intended for visitors and for Googlebot's render of the page. This removes the render error itself; no rank or traffic change can be forecast from it.",
  newText: null,
};

describe("plainIssueDetail", () => {
  it("says the files that did not load as a plain sentence", () => {
    expect(
      plainIssueDetail(
        "1 of 17 script and style files rendering asks for failed to load",
      ),
    ).toBe("1 of the 17 script and style files this page needs did not load.");
    expect(
      plainIssueDetail(
        "1 of 1 script and style files rendering asks for failed to load",
      ),
    ).toBe("The only script or style file this page needs did not load.");
  });

  it("says the files robots.txt blocks as plain sentences", () => {
    expect(
      plainIssueDetail(
        "robots.txt blocks 3 of 17 script and style files rendering asks for; Google renders without them",
      ),
    ).toBe(
      "Your robots.txt blocks 3 of the 17 script and style files this page needs. Google reads the page without them.",
    );
  });

  it("drops the audit's source ids and leaves other details as they are", () => {
    expect(
      plainIssueDetail(
        "Google sets no length limit and cuts title links to the device width (N1-061)",
      ),
    ).toBe(
      "Google sets no length limit and cuts title links to the device width",
    );
    expect(
      plainIssueDetail(
        "position rule: rank_group counts the items of one type (DataForSEO, N2-508)",
      ),
    ).toBe(
      "position rule: rank_group counts the items of one type (DataForSEO)",
    );
    expect(plainIssueDetail("https://www.nmkr.io/careers → 404")).toBe(
      "https://www.nmkr.io/careers → 404",
    );
  });
});

describe("withoutAuditIds", () => {
  it.each([
    [
      "The Finding RN-01 shows that 1 of the 17 files failed.",
      "1 of the 17 files failed.",
    ],
    [
      "Finding P-06 (minor, mobile) found no download link among the 18 controls.",
      "The audit found no download link among the 18 controls.",
    ],
    [
      "SN-19 fired on mobile: the site's favicon is too small.",
      "The site's favicon is too small.",
    ],
    [
      "Finding SN-19: the favicon at https://www.acme.io/logo.png is 16 pixels.",
      "The favicon at https://www.acme.io/logo.png is 16 pixels.",
    ],
    [
      'The page has meta robots="noindex, follow" on both mobile and desktop (AC-05). Remove it.',
      'The page has meta robots="noindex, follow" on both mobile and desktop. Remove it.',
    ],
    [
      "Rewrite the title. O-11 (major) fired: the title holds none of the words.",
      "Rewrite the title. The title holds none of the words.",
    ],
    [
      "The price differs, as the `SD-06` Finding says.",
      "The price differs, as the audit says.",
    ],
    ["Findings O-06 and O-09 show long texts.", "The audit shows long texts."],
  ])("%s", (from, to) => {
    expect(withoutAuditIds(from)).toBe(to);
  });

  it("keeps text that only looks like an id", () => {
    const text =
      "Serve it as UTF-8 with HTTP 200, hash it with SHA-256 and keep ISO-8601 dates.";
    expect(withoutAuditIds(text)).toBe(text);
  });
});

describe("pageChangeCopy", () => {
  it("leads an audit fix with what to change, without the check's id", () => {
    const copy = pageChangeCopy(RN_01);
    expect(copy.what).toBe(
      "1 of the 17 script and style files the page's main frame requested during rendering failed: https://js-eu1.hs-scripts.com/27172445.js returned net::ERR_BLOCKED_BY_ORB. This is the HubSpot tracking/chat script.",
    );
    expect(copy.why).toBe(RN_01.body);
    expect(`${copy.title} ${copy.what} ${copy.why} ${copy.detail}`).not.toMatch(
      ID,
    );
  });

  it("keeps every step the owner needs in the detail", () => {
    const { detail } = pageChangeCopy(RN_01);
    expect(detail).toMatch(/^Since the page cannot rely on this file loading/);
    expect(detail).toContain(
      "update it to the current embed code from the HubSpot account for portal ID 27172445",
    );
    expect(detail).toMatch(/robots\.txt on those hosts was not checked\.$/);
  });

  it("leaves a short change by Cuso as he wrote it", () => {
    expect(
      pageChangeCopy({
        source: "cuso",
        title: "Name team booking in the Teams page title",
        body: "Replace the page title.",
        why: "The page ranks 11 for the search that sells Teams; its title never says team booking.",
        newText: "Team Booking Software for Sales and Support | Acme",
      }),
    ).toEqual({
      title: "Name team booking in the Teams page title",
      what: "Replace the page title.",
      why: "The page ranks 11 for the search that sells Teams; its title never says team booking.",
      detail: null,
    });
  });

  it("reads an audit fix with new text as what to change, then why", () => {
    const copy = pageChangeCopy({
      source: "audit",
      title: "Put the target keyword in the title",
      body: 'Change the title from "Features".',
      why: 'O-11 (major) fired: neither the title "Features" nor the description holds the words people search for.',
      newText: "Team Booking Features | Acme",
    });
    expect(copy.what).toBe('Change the title from "Features".');
    expect(copy.why).toBe(
      'Neither the title "Features" nor the description holds the words people search for.',
    );
  });
});
