import { type AbstractIntlMessages, createTranslator } from "next-intl";
import { describe, expect, it } from "vitest";

import messages from "@/messages/en.json";

import { getNewsletterTabs } from "./newsletter-tabs";

const catalog: AbstractIntlMessages = messages;
const t = createTranslator({
  locale: "en",
  messages: catalog,
  namespace: "App.Projects.Newsletter",
});

describe("getNewsletterTabs", () => {
  it("puts Signup form after Subscribers and keeps every tab project-scoped", () => {
    const tabs = getNewsletterTabs("project/one", true, t);

    expect(tabs.map((tab) => tab.id)).toEqual([
      "issues",
      "calendar",
      "subscribers",
      "signup-form",
      "analytics",
      "settings",
    ]);
    expect(tabs.map((tab) => tab.href)).toEqual([
      "/newsletter/issues?projectId=project%2Fone",
      "/newsletter/calendar?projectId=project%2Fone",
      "/newsletter/subscribers?projectId=project%2Fone",
      "/newsletter/signup-form?projectId=project%2Fone",
      "/newsletter/analytics?projectId=project%2Fone",
      "/newsletter/settings?projectId=project%2Fone",
    ]);
    expect(tabs.find((tab) => tab.id === "signup-form")?.label).toBe(
      messages.App.Projects.Newsletter.SignupForm.title,
    );
  });

  it("only offers Settings until the newsletter is configured", () => {
    expect(getNewsletterTabs("project/one", false, t)).toEqual([
      {
        id: "settings",
        href: "/newsletter/settings?projectId=project%2Fone",
        label: messages.App.Projects.Newsletter.settings,
      },
    ]);
  });
});
