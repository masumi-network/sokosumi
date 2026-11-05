import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it, vi } from "vitest";

import de from "../../../../../../messages/de.json";
import en from "../../../../../../messages/en.json";
import es from "../../../../../../messages/es.json";
import { SocialLoadError, type SocialLoadErrorKind } from "./social-load-error";

const { refreshMock } = vi.hoisted(() => ({ refreshMock: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: refreshMock }),
}));

const KINDS: SocialLoadErrorKind[] = [
  "drafts",
  "attention",
  "accounts",
  "calendar",
  "post",
  "project",
];

function renderError(
  kind: SocialLoadErrorKind,
  variant?: "card" | "banner",
  messages: typeof en = en,
  locale = "en",
) {
  return render(
    <NextIntlClientProvider locale={locale} messages={messages}>
      <SocialLoadError data-testid="failed" kind={kind} variant={variant} />
    </NextIntlClientProvider>,
  );
}

describe("SocialLoadError", () => {
  it.each(KINDS.filter((kind) => kind !== "project"))(
    "says what failed and that the rest works for %s",
    (kind) => {
      renderError(kind);

      const failed = screen.getByTestId("failed");
      expect(failed).toHaveAttribute("role", "alert");
      expect(within(failed).getByRole("heading").textContent).toBe(
        en.App.Projects.SocialPosts.loadError.title[kind],
      );
      expect(failed).toHaveTextContent(
        "Everything else still works. Check your connection and try again.",
      );
    },
  );

  it("uses the same retry for every part and asks the server again", async () => {
    const user = userEvent.setup();
    refreshMock.mockClear();
    renderError("calendar");

    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(refreshMock).toHaveBeenCalledOnce();
  });

  it("offers the project notice as a slim banner that points to another project", () => {
    renderError("project", "banner");

    const banner = screen.getByTestId("failed");
    expect(banner).toHaveAttribute("role", "status");
    expect(banner).toHaveTextContent("Couldn't load that project");
    expect(banner).toHaveTextContent("choose another one");
    expect(
      within(banner).getByRole("button", { name: "Try again" }),
    ).toBeVisible();
  });

  it.each([
    ["de", de],
    ["es", es],
  ] as const)("is translated for every part in %s", (locale, messages) => {
    const loadError = messages.App.Projects.SocialPosts.loadError;
    const english = en.App.Projects.SocialPosts.loadError;
    for (const kind of KINDS) {
      expect(loadError.title[kind]).toBeTruthy();
      expect(loadError.title[kind]).not.toBe(english.title[kind]);
    }
    expect(loadError.help).not.toBe(english.help);
    expect(loadError.tryAgain).toBeTruthy();

    renderError("accounts", "card", messages as typeof en, locale);
    expect(screen.getByRole("heading")).toHaveTextContent(
      loadError.title.accounts,
    );
  });
});
