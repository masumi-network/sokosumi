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
  openScopeCreate: vi.fn(),
  setScopeCreateOpen: vi.fn(),
  useHasAnyScopeProject: vi.fn(),
}));

vi.mock("./sidebar-project-scope-state", () => ({
  openProjectScope: mocks.openProjectScope,
  openScopeCreate: mocks.openScopeCreate,
  setScopeCreateOpen: mocks.setScopeCreateOpen,
}));

vi.mock("./use-scope-projects", () => ({
  useHasAnyScopeProject: mocks.useHasAnyScopeProject,
}));

import {
  ProjectScopeRequired,
  RequireProjectScope,
} from "./project-scope-required";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.openProjectScope.mockReturnValue(mocks.cancel);
  mocks.useHasAnyScopeProject.mockReturnValue({
    isPending: false,
    hasProjects: true,
  });
});

describe("ProjectScopeRequired", () => {
  it.each([
    { locale: "en", messages: en, hasProjects: true, label: "Select project" },
    {
      locale: "de",
      messages: de,
      hasProjects: true,
      label: "Projekt auswählen",
    },
    {
      locale: "es",
      messages: es,
      hasProjects: true,
      label: "Seleccionar proyecto",
    },
    { locale: "en", messages: en, hasProjects: false, label: "Create project" },
    {
      locale: "de",
      messages: de,
      hasProjects: false,
      label: "Projekt erstellen",
    },
    { locale: "es", messages: es, hasProjects: false, label: "Crear proyecto" },
  ])(
    "offers $label in $locale without opening on arrival",
    ({ locale, messages, hasProjects, label }) => {
      mocks.useHasAnyScopeProject.mockReturnValue({
        isPending: false,
        hasProjects,
      });
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
      expect(mocks.openScopeCreate).not.toHaveBeenCalled();
      expect(screen.getByTestId("creative-backdrop")).toBeVisible();
      expect(screen.getByRole("button", { name: label })).toHaveClass(
        "bg-primary",
      );
      expect(screen.queryByTestId("project-scope-backdrop")).toBeNull();
    },
  );

  it.each([
    { hasProjects: true, label: "Select project" },
    { hasProjects: false, label: "Create project" },
  ])(
    "renders only $label in action mode without prompt chrome",
    ({ hasProjects, label }) => {
      mocks.useHasAnyScopeProject.mockReturnValue({
        isPending: false,
        hasProjects,
      });
      const { container } = render(
        <NextIntlClientProvider locale="en" messages={en}>
          <ProjectScopeRequired
            body="Choose a project to continue."
            testId="compact-project-action"
            title="Choose a project"
            variant="action"
          >
            <div data-testid="creative-backdrop" />
          </ProjectScopeRequired>
        </NextIntlClientProvider>,
      );

      expect(screen.getByRole("button", { name: label })).toHaveClass(
        "bg-primary",
      );
      expect(screen.queryByRole("heading")).toBeNull();
      expect(screen.queryByText("Choose a project to continue.")).toBeNull();
      expect(screen.queryByTestId("creative-backdrop")).toBeNull();
      expect(container.querySelector("svg")).toBeNull();
      const wrapper = screen.getByTestId("compact-project-action");
      expect(wrapper.tagName).toBe("DIV");
      expect(wrapper).toHaveClass("flex", "justify-center");
      expect(wrapper).not.toHaveClass("py-10", "sm:py-16");
      expect(wrapper).not.toHaveAttribute("aria-labelledby");
      expect(mocks.openProjectScope).not.toHaveBeenCalled();
      expect(mocks.openScopeCreate).not.toHaveBeenCalled();
    },
  );

  it.each(["prompt", "action"] as const)(
    "seeds required scope before opening Create in %s mode on click and cleans up on unmount",
    async (variant) => {
      const user = userEvent.setup();
      const onSelect = vi.fn();
      mocks.useHasAnyScopeProject.mockReturnValue({
        isPending: false,
        hasProjects: false,
      });
      const { unmount } = render(
        <NextIntlClientProvider locale="en" messages={en}>
          <ProjectScopeRequired
            body="Choose a project to continue."
            onSelect={onSelect}
            variant={variant}
          />
        </NextIntlClientProvider>,
      );

      const button = screen.getByRole("button", { name: "Create project" });
      expect(button).toHaveAttribute(
        "data-testid",
        "project-scope-select-button",
      );
      await user.click(button);

      expect(mocks.openProjectScope).toHaveBeenCalledExactlyOnceWith({
        required: true,
        reason: "Choose a project to continue.",
        onSelect,
      });
      expect(mocks.openScopeCreate).toHaveBeenCalledExactlyOnceWith(button);
      expect(mocks.openProjectScope).toHaveBeenCalledBefore(
        mocks.openScopeCreate,
      );
      expect(mocks.cancel).not.toHaveBeenCalled();
      expect(mocks.setScopeCreateOpen).not.toHaveBeenCalled();

      unmount();
      expect(mocks.cancel).toHaveBeenCalledOnce();
      expect(mocks.setScopeCreateOpen).toHaveBeenCalledExactlyOnceWith(false);
    },
  );

  it("keeps the backdrop, copy and Select button when projects exist and autoOpen is false", () => {
    const onSelect = vi.fn();
    mocks.useHasAnyScopeProject.mockReturnValue({
      isPending: false,
      hasProjects: true,
    });
    const { unmount } = render(
      <NextIntlClientProvider locale="en" messages={en}>
        <ProjectScopeRequired
          autoOpen={false}
          body="Choose a project to continue."
          onSelect={onSelect}
          title="Choose a project"
        >
          <div data-testid="creative-backdrop" />
        </ProjectScopeRequired>
      </NextIntlClientProvider>,
    );

    expect(mocks.openProjectScope).not.toHaveBeenCalled();
    expect(screen.getByTestId("creative-backdrop")).toBeVisible();
    expect(
      screen.getByRole("heading", { name: "Choose a project" }),
    ).toBeVisible();
    expect(screen.getByText("Choose a project to continue.")).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Select project" }),
    ).toBeVisible();
    expect(mocks.openScopeCreate).not.toHaveBeenCalled();

    unmount();
    expect(mocks.cancel).not.toHaveBeenCalled();
    expect(mocks.setScopeCreateOpen).not.toHaveBeenCalled();
  });

  it.each([false, true])(
    "keeps a button while pending and after availability resolves to hasProjects=%s without opening",
    (hasProjects) => {
      mocks.useHasAnyScopeProject.mockReturnValue({
        isPending: true,
        hasProjects: false,
      });
      const content = () => (
        <NextIntlClientProvider locale="en" messages={en}>
          <ProjectScopeRequired
            body="Choose a project to continue."
            title="Choose a project"
          >
            <div data-testid="creative-backdrop" />
          </ProjectScopeRequired>
        </NextIntlClientProvider>
      );
      const { rerender } = render(content());

      expect(screen.getByTestId("creative-backdrop")).toBeVisible();
      expect(
        screen.getByRole("heading", { name: "Choose a project" }),
      ).toBeVisible();
      expect(screen.getByText("Choose a project to continue.")).toBeVisible();
      const button = screen.getByRole("button", { name: "Select project" });
      expect(button).toBeVisible();
      expect(mocks.openProjectScope).not.toHaveBeenCalled();
      expect(mocks.openScopeCreate).not.toHaveBeenCalled();

      mocks.useHasAnyScopeProject.mockReturnValue({
        isPending: false,
        hasProjects,
      });
      rerender(content());

      expect(
        screen.getByRole("button", {
          name: hasProjects ? "Select project" : "Create project",
        }),
      ).toBe(button);
      expect(mocks.openProjectScope).not.toHaveBeenCalled();
      expect(mocks.openScopeCreate).not.toHaveBeenCalled();
    },
  );

  describe.each(["prompt", "action"] as const)("%s mode", (variant) => {
    it.each([
      { isPending: false, hasProjects: true },
      { isPending: true, hasProjects: false },
      { isPending: true, hasProjects: true },
    ])(
      "opens only the required selector on click when availability is $isPending/$hasProjects",
      async (availability) => {
        const user = userEvent.setup();
        const onSelect = vi.fn();
        mocks.useHasAnyScopeProject.mockReturnValue(availability);
        const { unmount } = render(
          <NextIntlClientProvider locale="en" messages={en}>
            <ProjectScopeRequired
              body="Choose a project to continue."
              onSelect={onSelect}
              variant={variant}
            />
          </NextIntlClientProvider>,
        );

        const button = screen.getByRole("button", { name: "Select project" });
        expect(button).toHaveAttribute(
          "data-testid",
          "project-scope-select-button",
        );
        expect(mocks.openProjectScope).not.toHaveBeenCalled();
        expect(mocks.openScopeCreate).not.toHaveBeenCalled();

        await user.click(button);

        expect(mocks.openProjectScope).toHaveBeenCalledExactlyOnceWith({
          required: true,
          reason: "Choose a project to continue.",
          onSelect,
        });
        expect(mocks.openScopeCreate).not.toHaveBeenCalled();
        expect(mocks.cancel).not.toHaveBeenCalled();

        unmount();
        expect(mocks.cancel).toHaveBeenCalledOnce();
      },
    );
  });

  it("leaves other create dialogs alone when the prompt unmounts without a click", () => {
    const { unmount } = render(
      <NextIntlClientProvider locale="en" messages={en}>
        <ProjectScopeRequired body="Choose a project to continue." />
      </NextIntlClientProvider>,
    );

    unmount();

    expect(mocks.cancel).not.toHaveBeenCalled();
    expect(mocks.setScopeCreateOpen).not.toHaveBeenCalled();
  });

  it.each([
    { isPending: false, hasProjects: false },
    { isPending: false, hasProjects: true },
    { isPending: true, hasProjects: false },
    { isPending: true, hasProjects: true },
  ])(
    "keeps explicit autoOpen working with availability $isPending/$hasProjects",
    (availability) => {
      mocks.useHasAnyScopeProject.mockReturnValue(availability);
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
      expect(screen.queryByTestId("project-scope-select-button")).toBeNull();
      expect(mocks.openScopeCreate).not.toHaveBeenCalled();

      unmount();
      expect(mocks.cancel).toHaveBeenCalledOnce();
      expect(mocks.setScopeCreateOpen).not.toHaveBeenCalled();
    },
  );
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
