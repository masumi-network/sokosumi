export const SERVICE_LOGOS: Array<{
  src: string;
  labelKey:
    | "gmail"
    | "outlook"
    | "google_calendar"
    | "google_sheets"
    | "google_docs"
    | "slack"
    | "teams"
    | "notion"
    | "linear"
    | "jira"
    | "github"
    | "hubspot"
    | "twitter"
    | "linkedin";
}> = [
  { src: "/icons/gmail.svg", labelKey: "gmail" },
  { src: "/icons/outlook.svg", labelKey: "outlook" },
  { src: "/icons/google-calendar.svg", labelKey: "google_calendar" },
  { src: "/icons/google-sheets.svg", labelKey: "google_sheets" },
  { src: "/icons/google-docs.svg", labelKey: "google_docs" },
  { src: "/icons/slack.svg", labelKey: "slack" },
  { src: "/icons/teams.svg", labelKey: "teams" },
  { src: "/icons/notion.svg", labelKey: "notion" },
  { src: "/icons/linear.svg", labelKey: "linear" },
  { src: "/icons/jira.svg", labelKey: "jira" },
  { src: "/icons/github.svg", labelKey: "github" },
  { src: "/icons/hubspot.svg", labelKey: "hubspot" },
  { src: "/icons/x.svg", labelKey: "twitter" },
  { src: "/icons/linkedin.svg", labelKey: "linkedin" },
];

/** A subset of connectors surfaced as an icon-only proof rail in the hero.
 * The full labelled grid lives in the Integrations section below. */
export const HERO_RAIL = SERVICE_LOGOS.slice(0, 9);
