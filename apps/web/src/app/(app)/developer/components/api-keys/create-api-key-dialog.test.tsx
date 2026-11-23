import { act, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it, vi } from "vitest";

import messages from "@/messages/en.json";

import { CreateApiKeyDialog } from "./create-api-key-dialog";
import type { CreateApiKeyResult } from "./types";

describe("CreateApiKeyDialog", () => {
  it("stays open while a create is pending, then shows the one-time key", async () => {
    const pending = Promise.withResolvers<CreateApiKeyResult>();
    const onOpenChange = vi.fn();

    render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <CreateApiKeyDialog
          open
          onOpenChange={onOpenChange}
          onSuccess={() => {}}
          createApiKey={() => pending.promise}
        />
      </NextIntlClientProvider>,
    );

    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "Production" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create API key" }));
    await screen.findByRole("button", { name: "Cancel" });
    await vi.waitFor(() =>
      expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled(),
    );

    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(onOpenChange).not.toHaveBeenCalledWith(false);

    await act(async () => {
      pending.resolve({ ok: true, value: { key: "coworker_secret" } });
      await pending.promise;
    });

    expect(await screen.findByText("coworker_secret")).toBeInTheDocument();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });
});
