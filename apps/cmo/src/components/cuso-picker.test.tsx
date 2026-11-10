import type { CmoCuso } from "@sokosumi/core-client";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";

import { CusoPicker } from "./cuso-picker";

function cuso(fields: Partial<CmoCuso>): CmoCuso {
  return {
    projectId: "project-1",
    businessName: "acme.io",
    websiteUrl: "https://acme.io",
    projectLogo: null,
    organizationId: "org-1",
    organizationName: "Agency",
    hiring: false,
    createdAt: new Date("2026-10-01T09:00:00Z"),
    ...fields,
  };
}

it("lists each Cuso by his Business and organization, then Hire a new Cuso", () => {
  const html = renderToStaticMarkup(
    <CusoPicker
      cusos={[
        cuso({
          projectId: "project-2",
          businessName: "beta.io",
          projectLogo: "https://beta.io/icon.png",
          hiring: true,
        }),
        cuso({}),
      ]}
    />,
  );
  const rows = [
    ...html.matchAll(/<a class="ob-picker-row" href="([^"]+)"/g),
  ].map(([, href]) => href);
  expect(rows).toEqual([
    "/?project=project-2",
    "/?project=project-1",
    "/?hire=1",
  ]);
  expect(html).toContain('src="https://beta.io/icon.png"');
  expect(html).toContain("<b>beta.io</b>");
  // Two Cusos of one organization still read apart.
  expect(html).toContain("Agency · Hiring");
  expect(html).toMatch(/Hire a new Cuso<\/span><\/a><\/li><\/ul>/);
});
