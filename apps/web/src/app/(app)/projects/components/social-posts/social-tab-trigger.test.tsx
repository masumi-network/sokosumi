import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Tabs, TabsList } from "@/components/ui/tabs";
import de from "../../../../../../messages/de.json";
import en from "../../../../../../messages/en.json";
import es from "../../../../../../messages/es.json";
import { SocialTabTrigger } from "./social-tab-trigger";

/**
 * Social's tabs on a phone are icons; the words move to screen-reader text.
 * These pin that every tab is still announced by its full name and count.
 */

function renderTrigger(props: Parameters<typeof SocialTabTrigger>[0]) {
  return render(
    <Tabs value="calendar">
      <TabsList>
        <SocialTabTrigger {...props} />
      </TabsList>
    </Tabs>,
  );
}

describe("SocialTabTrigger", () => {
  it.each([
    ["en", en],
    ["de", de],
    ["es", es],
  ])(
    "keeps the full %s name for screen readers when the phone shows only the icon",
    (_locale, messages) => {
      const label = messages.App.Projects.SocialPosts.sections.attention;
      renderTrigger({ alert: true, count: "3", label, tab: "attention" });

      const tab = screen.getByRole("tab");
      expect(tab).toHaveAccessibleName(`${label} 3`);
      // Where the labels do not fit, the words are sr-only, not removed.
      expect(within(tab).getByText(label)).toHaveClass("@max-[42rem]:sr-only");
      expect(within(tab).getByTestId("social-posts-tab-icon")).toBeVisible();
    },
  );

  it("puts the count on the phone icon's corner without announcing it twice", () => {
    renderTrigger({ count: "20+", label: "Drafts", tab: "drafts" });

    const tab = screen.getByRole("tab");
    expect(tab).toHaveAccessibleName("Drafts 20+");
    const badge = within(tab).getByText("20+", { selector: "[aria-hidden]" });
    expect(badge).toHaveClass("@min-[42rem]:hidden");
  });

  it("shows the icon only where labels do not fit, unless the tab warns", () => {
    const { unmount } = renderTrigger({ label: "Calendar", tab: "calendar" });
    expect(screen.getByTestId("social-posts-tab-icon")).toHaveClass(
      "@min-[42rem]:hidden",
    );
    unmount();

    renderTrigger({ alert: true, label: "Needs attention", tab: "attention" });
    expect(screen.getByTestId("social-posts-tab-icon")).not.toHaveClass(
      "@min-[42rem]:hidden",
    );
  });
});
