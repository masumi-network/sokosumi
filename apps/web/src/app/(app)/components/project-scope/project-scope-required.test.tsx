import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";

import de from "@/../messages/de.json";
import en from "@/../messages/en.json";
import es from "@/../messages/es.json";

const mocks = vi.hoisted(() => ({
  cancel: vi.fn(),
  openProjectScope: vi.fn(),
}));

vi.mock("./sidebar-project-scope-state", () => ({
  openProjectScope: mocks.openProjectScope,
}));

import {
  ProjectScopeRequired,
  RequireProjectScope,
} from "./project-scope-required";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.openProjectScope.mockReturnValue(mocks.cancel);
});

describe("ProjectScopeRequired", () => {
  it.each([
    { locale: "en", messages: en, label: "Select project" },
    { locale: "de", messages: de, label: "Projekt auswählen" },
    { locale: "es", messages: es, label: "Seleccionar proyecto" },
  ])(
    "offers a translated primary action in $locale without opening on arrival",
    ({ locale, messages, label }) => {
      render(
        <NextIntlClientProvider locale={locale} messages={messages}>
          <ProjectScopeRequired
            body="A project is needed."
            title="Choose a project"
          >
            <div data-testid="creative-backdrop" />
          </ProjectScopeRequired>
        </NextIntlClientProvider>,
      );

      expect(mocks.openProjectScope).not.toHaveBeenCalled();
      expect(screen.getByTestId("creative-backdrop")).toBeVisible();
      expect(screen.getByRole("button", { name: label })).toHaveClass(
        "bg-primary",
      );
      expect(screen.queryByTestId("project-scope-backdrop")).toBeNull();
    },
  );

  it("opens required scope on click and cancels its request when the page unmounts", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const { unmount } = render(
      <NextIntlClientProvider locale="en" messages={en}>
        <ProjectScopeRequired
          body="Choose a project to continue."
          onSelect={onSelect}
        />
      </NextIntlClientProvider>,
    );

    await user.click(screen.getByRole("button", { name: "Select project" }));

    expect(mocks.openProjectScope).toHaveBeenCalledExactlyOnceWith({
      required: true,
      reason: "Choose a project to continue.",
      onSelect,
    });
    expect(mocks.cancel).not.toHaveBeenCalled();

    unmount();
    expect(mocks.cancel).toHaveBeenCalledOnce();
  });

  it("opens on mount only when explicitly opted in and cancels on unmount", () => {
    const { unmount } = render(
      <NextIntlClientProvider locale="en" messages={en}>
        <ProjectScopeRequired
          autoOpen
          body="An explicit action needs a project."
        />
      </NextIntlClientProvider>,
    );

    expect(mocks.openProjectScope).toHaveBeenCalledExactlyOnceWith({
      required: true,
      reason: "An explicit action needs a project.",
      onSelect: undefined,
    });

    unmount();
    expect(mocks.cancel).toHaveBeenCalledOnce();
  });
});

it("keeps RequireProjectScope opening required scope for explicit actions", () => {
  const onSelect = vi.fn();
  const onDismiss = vi.fn();
  const { unmount } = render(
    <RequireProjectScope
      reason="Compose a post."
      onSelect={onSelect}
      onDismiss={onDismiss}
    />,
  );

  expect(mocks.openProjectScope).toHaveBeenCalledExactlyOnceWith({
    required: true,
    reason: "Compose a post.",
    onSelect,
    onDismiss,
  });

  unmount();
  expect(mocks.cancel).toHaveBeenCalledOnce();
});
