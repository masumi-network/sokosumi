import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { mockCoreCoworker } from "@/test-fixtures/coworker";

const toastErrorMock = vi.fn();
const toastSuccessMock = vi.fn();

vi.mock("sonner", () => ({
  toast: {
    error: (...args: unknown[]) => toastErrorMock(...args),
    success: (...args: unknown[]) => toastSuccessMock(...args),
  },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    refresh: vi.fn(),
    push: vi.fn(),
  }),
}));

import { CoworkerDisplayForm } from "../coworker-display-form";

const messages = {
  App: {
    Coworkers: {
      DisplayForm: {
        title: "Display",
        description: "Update how this coworker appears in Sokosumi.",
        fields: {
          name: { label: "Name" },
          caption: { label: "Caption" },
          description: { label: "Description" },
        },
        image: {
          label: "Image",
          description: "PNG, JPEG, WebP, or GIF up to 2 MB.",
          upload: "Upload image",
          replace: "Replace image",
          remove: "Remove image",
          previewAlt: "Coworker image preview",
          fileTooLarge: "Image must be 2 MB or smaller.",
          fileTypeNotAccepted: "Use PNG, JPEG, WebP, or GIF.",
          maxFilesExceeded: "Upload one image at a time.",
          uploadError: "Could not process the selected image.",
        },
        saveChanges: "Save display",
        saving: "Saving…",
        cancel: "Cancel",
        validation: {
          nameMinLength: "Name must be at least {min} characters.",
          noChanges: "No changes to save.",
          captionMaxLength: "Caption must be at most {max} characters.",
        },
        success: {
          saved: "Coworker display updated.",
          imageSaved: "Image saved.",
          imageRemoved: "Image removed.",
        },
        errors: {
          saveFailed: "Failed to save coworker display.",
          imageSaveFailed: "Failed to update image.",
        },
      },
    },
  },
};

describe("CoworkerDisplayForm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses localized image error when service returns imageError", async () => {
    const user = userEvent.setup();
    const updateAction = vi.fn().mockResolvedValue({
      ok: true,
      value: {
        coworker: mockCoreCoworker({ name: "Ops Agent Updated" }),
        imageError: "blob down",
      },
    });

    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <CoworkerDisplayForm
          coworker={mockCoreCoworker({ name: "Ops Agent" })}
          cancelHref="/developer/coworkers"
          updateAction={updateAction}
          onNotFound={vi.fn()}
        />
      </NextIntlClientProvider>,
    );

    await user.clear(screen.getByLabelText("Name"));
    await user.type(screen.getByLabelText("Name"), "Ops Agent Updated");
    await user.click(screen.getByRole("button", { name: "Save display" }));

    expect(updateAction).toHaveBeenCalled();
    expect(toastErrorMock).toHaveBeenCalledWith("Failed to update image.");
    expect(toastErrorMock).not.toHaveBeenCalledWith("blob down");
  });

  it("notifies parent busy state during mutations", async () => {
    const user = userEvent.setup();
    const onBusyChange = vi.fn();
    let resolveAction: ((value: unknown) => void) | undefined;
    const updateAction = vi.fn().mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveAction = resolve;
        }),
    );

    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <CoworkerDisplayForm
          coworker={mockCoreCoworker({ name: "Ops Agent" })}
          cancelHref="/admin/coworkers"
          onBusyChange={onBusyChange}
          updateAction={updateAction}
          onNotFound={vi.fn()}
        />
      </NextIntlClientProvider>,
    );

    await user.clear(screen.getByLabelText("Name"));
    await user.type(screen.getByLabelText("Name"), "Ops Agent Renamed");
    await user.click(screen.getByRole("button", { name: "Save display" }));

    expect(onBusyChange).toHaveBeenCalledWith(true);

    resolveAction?.({
      ok: true,
      value: {
        coworker: mockCoreCoworker({ name: "Ops Agent Renamed" }),
      },
    });

    await vi.waitFor(() => {
      expect(onBusyChange).toHaveBeenLastCalledWith(false);
    });
  });

  it("respects external disabled state", () => {
    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <CoworkerDisplayForm
          coworker={mockCoreCoworker()}
          cancelHref="/admin/coworkers"
          disabled
          updateAction={vi.fn()}
          onNotFound={vi.fn()}
        />
      </NextIntlClientProvider>,
    );

    expect(screen.getByLabelText("Name")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Save display" })).toBeDisabled();
  });
});
