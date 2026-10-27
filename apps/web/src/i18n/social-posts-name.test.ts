import { describe, expect, it } from "vitest";

import de from "../../messages/de.json";
import en from "../../messages/en.json";
import es from "../../messages/es.json";

const NAMES = {
  en: "Social posts",
  de: "Social-Media-Beiträge",
  es: "Publicaciones sociales",
};

interface SocialNames {
  Components: { Breadcrumb: { social: string } };
  App: {
    Sidebar: { Content: { MenuItems: Record<string, string> } };
    Social: { title: string };
  };
}

/**
 * The Social destination is named as the sidebar names it (GLOSSARY.md,
 * "Announced feature"): one key for the sidebar row, the You page and the
 * badge admin, and the breadcrumb's segment key and the Social page's own
 * title saying the same.
 */
describe("Social posts destination name", () => {
  it.each([
    ["en", en],
    ["de", de],
    ["es", es],
  ] as const)("is %s everywhere it is shown", (locale, messages) => {
    const names = messages as unknown as SocialNames;
    const menu = names.App.Sidebar.Content.MenuItems;

    expect(menu.social).toBe(NAMES[locale]);
    expect(menu).not.toHaveProperty("socialPosts");
    expect(names.Components.Breadcrumb.social).toBe(NAMES[locale]);
    expect(names.App.Social.title).toBe(NAMES[locale]);
  });
});
