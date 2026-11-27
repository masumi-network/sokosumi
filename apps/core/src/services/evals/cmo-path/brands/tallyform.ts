import type { CmoPathBrand } from "../types";
import { page } from "./page";

const STYLE = {
  primary: "#1f4fd8",
  accent: "#ffb020",
  ink: "#14182b",
  font: "'Inter Tight', 'Helvetica Neue', Arial, sans-serif",
};

/** A fictional B2B SaaS: invoice approvals for mid-size finance teams. */
export const TALLYFORM: CmoPathBrand = {
  id: "tallyform",
  domain: "tallyform.example",
  eval: {
    name: "Tallyform",
    url: "https://tallyform.example/",
    goal: "More finance teams start a free trial",
    main: "invoice|approval",
    price: "29",
    minOffers: 2,
    siteLanguage: "en",
  },
  facts: [
    { label: "the product", pattern: "invoice approval" },
    { label: "the Team plan's price", pattern: "€\\s?29|29\\s?€|EUR\\s?29" },
    {
      label: "the free plan",
      pattern: "free.{0,40}(5|five)|(5|five).{0,40}free",
    },
    { label: "the city", pattern: "Rotterdam" },
    { label: "the Slack app", pattern: "Slack" },
  ],
  colors: [STYLE.primary, STYLE.accent],
  owner: {
    firstName: "Maren",
    lastName: "Oosterhout",
    timeZone: "Europe/Amsterdam",
  },
  ownerBrief: [
    "You run Tallyform, a Rotterdam company founded in 2021 that makes invoice approval software for finance teams at companies with 50 to 500 people.",
    "Plans: Free for teams of up to 5 people; Team at €29 per user per month; Scale at €49 per user per month with SSO and audit exports.",
    "Products: Approvals (route each invoice to the right approver), Spend reports, and a Slack app for approving from Slack.",
    "Your buyers are finance leads and controllers who chase approvals by email today.",
    "You want more free trials. You post on X and LinkedIn (your own profile and the company page). You do not want video, you have no time to film.",
    "You never ran ads and have no ad budget this month.",
  ].join(" "),
  networks: ["x", "linkedin", "linkedin-page"],
  pages: [
    page("/", "Tallyform: invoice approvals without the email chase", STYLE, [
      "<h1>Invoice approvals without the email chase</h1>",
      "<p>Tallyform routes every invoice to the right approver, reminds them, and keeps an audit trail your auditor will like. Built in Rotterdam for finance teams at companies with 50 to 500 people.</p>",
      "<p><a href='/pricing'>See pricing</a> · Free for teams of up to 5 people.</p>",
      "<h2>What finance leads tell us</h2>",
      "<blockquote>We closed the month two days earlier after moving approvals to Tallyform. (Controller, logistics company)</blockquote>",
      "<p>Approve from Slack with the Tallyform Slack app, or from your inbox.</p>",
      "<p><a href='https://www.linkedin.com/company/tallyform-example'>LinkedIn</a> · <a href='https://x.com/tallyform_example'>X</a></p>",
    ]),
    page("/pricing", "Pricing | Tallyform", STYLE, [
      "<h1>Pricing</h1>",
      "<ul><li><b>Free</b>: €0, for teams of up to 5 people.</li>",
      "<li><b>Team</b>: €29 per user per month. Approval flows, reminders, Spend reports, Slack app.</li>",
      "<li><b>Scale</b>: €49 per user per month. Everything in Team, plus SSO and audit exports.</li></ul>",
      "<p>Every paid plan starts with a 14-day free trial.</p>",
    ]),
    page("/about", "About | Tallyform", STYLE, [
      "<h1>About Tallyform</h1>",
      "<p>Founded in 2021 in Rotterdam by two former controllers who spent too many month-ends chasing approvals by email.</p>",
      "<p>12 people, one product: approvals that finish on time.</p>",
    ]),
    page(
      "/blog/close-the-month-faster",
      "Close the month two days faster | Tallyform",
      STYLE,
      [
        "<h1>Close the month two days faster</h1>",
        "<p>Most month-end delays are not accounting problems. They are approval problems: an invoice waits in someone's inbox.</p>",
        "<p>Three habits help: one approver per cost centre, an automatic reminder after 48 hours, and approvals where people already work, such as Slack.</p>",
      ],
    ),
    {
      path: "/logo.svg",
      contentType: "image/svg+xml",
      body: `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="40" viewBox="0 0 160 40"><rect width="40" height="40" rx="8" fill="${STYLE.primary}"/><path d="M10 12h20v4h-8v14h-4V16h-8z" fill="#fff"/><text x="50" y="27" font-family="Arial" font-size="20" fill="${STYLE.ink}">Tallyform</text></svg>`,
    },
  ],
  change: {
    kind: "change-fact",
    message:
      "Heads-up: from next week the Team plan costs €34 per user per month, not €29. Please fix every upcoming post that mentions the price.",
    selector: { phrase: "29" },
    replacement: "34",
  },
  analytics: {
    winner: { network: "linkedin", kinds: ["carousel", "image"] },
    factor: 3,
    winnerWords: ["linkedin"],
  },
};
