import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { TaskDesignMdAttachmentField } from "@/app/tasks/components/task-design-md-attachment";
import type { EffectiveDesignMdAttachment } from "@/lib/services/design-md.service";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) =>
    values ? `${key}:${JSON.stringify(values)}` : key,
}));

const { onGeneratedSpy } = vi.hoisted(() => ({ onGeneratedSpy: vi.fn() }));

vi.mock("@/components/design-md", () => ({
  DesignMdAdHocDialog: ({
    open,
    onGenerated,
  }: {
    open: boolean;
    onGenerated: (attachment: {
      label: string;
      url: string;
      sourceUrl: string;
    }) => void;
  }) => {
    onGeneratedSpy.mockImplementation(onGenerated);
    return open ? <div data-testid="adhoc-dialog" /> : null;
  },
}));

// Radix's AvatarImage and Favicon's <img> both gate rendering on a real
// image-load event that never fires in this DOM test environment, so
// asserting on the resulting <img> is untestable here — stub each down to
// its `src`/`sources` prop instead, which is the part this component
// actually controls.
vi.mock("@/components/ui/avatar", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/components/ui/avatar")>();
  return {
    ...actual,
    AvatarImage: (props: { src?: string; alt?: string }) => (
      <img data-testid="avatar-image" src={props.src} alt={props.alt} />
    ),
  };
});

vi.mock("@/components/ui/favicon", () => ({
  Favicon: (props: { sources: string[]; alt?: string }) => (
    <img data-testid="favicon-image" src={props.sources[0]} alt={props.alt} />
  ),
}));

const organizationAttachment: EffectiveDesignMdAttachment = {
  label: "DESIGN.md",
  url: "https://blob.example/org.md",
  owner: { type: "organization", name: "Acme Inc", logo: null },
};

const organizationAttachmentWithLogo: EffectiveDesignMdAttachment = {
  label: "DESIGN.md",
  url: "https://blob.example/org.md",
  owner: {
    type: "organization",
    name: "Acme Inc",
    logo: "https://blob.example/logo.png",
  },
};

const personalAttachment: EffectiveDesignMdAttachment = {
  label: "DESIGN.md",
  url: "https://blob.example/user.md",
  owner: { type: "user" },
};

describe("TaskDesignMdAttachmentField", () => {
  it("labels the checkbox for the organization's DESIGN.md and shows it checked", () => {
    render(
      <TaskDesignMdAttachmentField
        defaultAttachment={organizationAttachment}
        selection={{ enabled: true, custom: null }}
        onSelectionChange={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("checkbox", {
        name: 'organizationLabel:{"organization":"Acme Inc"}',
      }),
    ).toBeChecked();
  });

  it("shows the organization's initial when it has no logo", () => {
    render(
      <TaskDesignMdAttachmentField
        defaultAttachment={organizationAttachment}
        selection={{ enabled: true, custom: null }}
        onSelectionChange={vi.fn()}
      />,
    );

    expect(screen.getByText("A")).toBeInTheDocument();
  });

  it("renders an avatar image sourced from the organization's logo", () => {
    render(
      <TaskDesignMdAttachmentField
        defaultAttachment={organizationAttachmentWithLogo}
        selection={{ enabled: true, custom: null }}
        onSelectionChange={vi.fn()}
      />,
    );

    expect(screen.getByTestId("avatar-image")).toHaveAttribute(
      "src",
      "https://blob.example/logo.png",
    );
  });

  it("shows a favicon avatar for the swapped-in company", () => {
    render(
      <TaskDesignMdAttachmentField
        defaultAttachment={organizationAttachment}
        selection={{
          enabled: true,
          custom: {
            label: "DESIGN.md",
            url: "https://blob.example/adhoc.md",
            sourceUrl: "https://competitor.com",
          },
        }}
        onSelectionChange={vi.fn()}
      />,
    );

    expect(screen.getByTestId("favicon-image")).toHaveAttribute(
      "src",
      "https://competitor.com/favicon.ico",
    );
  });

  it("falls back to the personal label when there is no organization owner", () => {
    render(
      <TaskDesignMdAttachmentField
        defaultAttachment={personalAttachment}
        selection={{ enabled: true, custom: null }}
        onSelectionChange={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("checkbox", { name: "personalLabel" }),
    ).toBeInTheDocument();
  });

  it("reports unchecking the checkbox", async () => {
    const user = userEvent.setup();
    const onSelectionChange = vi.fn();

    render(
      <TaskDesignMdAttachmentField
        defaultAttachment={organizationAttachment}
        selection={{ enabled: true, custom: null }}
        onSelectionChange={onSelectionChange}
      />,
    );

    await user.click(screen.getByRole("checkbox"));

    expect(onSelectionChange).toHaveBeenCalledWith({
      enabled: false,
      custom: null,
    });
  });

  it("opens the ad hoc dialog from the swap button", async () => {
    const user = userEvent.setup();

    render(
      <TaskDesignMdAttachmentField
        defaultAttachment={organizationAttachment}
        selection={{ enabled: true, custom: null }}
        onSelectionChange={vi.fn()}
      />,
    );

    expect(screen.queryByTestId("adhoc-dialog")).not.toBeInTheDocument();
    await user.click(screen.getByText("useDifferentBranding"));
    expect(screen.getByTestId("adhoc-dialog")).toBeInTheDocument();
  });

  it("switches to the generated attachment's hostname label once one is chosen", () => {
    render(
      <TaskDesignMdAttachmentField
        defaultAttachment={organizationAttachment}
        selection={{
          enabled: true,
          custom: {
            label: "DESIGN.md",
            url: "https://blob.example/adhoc.md",
            sourceUrl: "https://www.competitor.com",
          },
        }}
        onSelectionChange={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("checkbox", {
        name: 'customLabel:{"hostname":"competitor.com"}',
      }),
    ).toBeInTheDocument();
    expect(screen.getByText("resetToDefault")).toBeInTheDocument();
  });

  it("clears the custom attachment when reset is clicked, without reopening the dialog", async () => {
    const user = userEvent.setup();
    const onSelectionChange = vi.fn();
    const custom = {
      label: "DESIGN.md",
      url: "https://blob.example/adhoc.md",
      sourceUrl: "https://competitor.com",
    };

    render(
      <TaskDesignMdAttachmentField
        defaultAttachment={organizationAttachment}
        selection={{ enabled: true, custom }}
        onSelectionChange={onSelectionChange}
      />,
    );

    await user.click(screen.getByText("resetToDefault"));

    expect(onSelectionChange).toHaveBeenCalledWith({
      enabled: true,
      custom: null,
    });
    expect(screen.queryByTestId("adhoc-dialog")).not.toBeInTheDocument();
  });

  it("enables the field and adopts the custom attachment once generation completes", async () => {
    const user = userEvent.setup();
    const onSelectionChange = vi.fn();

    render(
      <TaskDesignMdAttachmentField
        defaultAttachment={organizationAttachment}
        selection={{ enabled: false, custom: null }}
        onSelectionChange={onSelectionChange}
      />,
    );

    await user.click(screen.getByText("useDifferentBranding"));
    onGeneratedSpy({
      label: "DESIGN.md",
      url: "https://blob.example/adhoc.md",
      sourceUrl: "https://competitor.com",
    });

    expect(onSelectionChange).toHaveBeenCalledWith({
      enabled: true,
      custom: {
        label: "DESIGN.md",
        url: "https://blob.example/adhoc.md",
        sourceUrl: "https://competitor.com",
      },
    });
  });
});
