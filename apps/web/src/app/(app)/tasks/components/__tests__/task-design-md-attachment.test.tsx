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

const organizationAttachment: EffectiveDesignMdAttachment = {
  label: "DESIGN.md",
  url: "https://blob.example/org.md",
  owner: { type: "organization", name: "Acme Inc" },
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
