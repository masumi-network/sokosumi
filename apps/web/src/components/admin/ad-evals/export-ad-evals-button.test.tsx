import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import en from "@/messages/en.json";
import { ExportAdEvalsButton } from "./export-ad-evals-button";

const mocks = vi.hoisted(() => ({ export: vi.fn(), error: vi.fn() }));
vi.mock("@/lib/actions/admin-ad-evals/action", () => ({
  exportAdminAdEvals: mocks.export,
}));
vi.mock("sonner", () => ({ toast: { error: mocks.error } }));

beforeEach(() => vi.resetAllMocks());

describe("ExportAdEvalsButton", () => {
  it("downloads the returned JSONL as a file", async () => {
    mocks.export.mockResolvedValue({ ok: true, value: '{"type":"rating"}\n' });
    const createUrl = vi
      .spyOn(URL, "createObjectURL")
      .mockReturnValue("blob:ad-evals");
    let downloadName: string | undefined;
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(function (this: HTMLAnchorElement) {
        downloadName = this.download;
      });
    render(
      <NextIntlClientProvider locale="en" messages={en}>
        <ExportAdEvalsButton />
      </NextIntlClientProvider>,
    );
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Download JSONL" }));
    await waitFor(() => expect(click).toHaveBeenCalledOnce());
    const blob = createUrl.mock.calls[0][0];
    expect(blob).toBeInstanceOf(Blob);
    expect(blob instanceof Blob && blob.type).toBe("application/x-ndjson");
    expect(downloadName).toBe("ad-evals.jsonl");
    createUrl.mockRestore();
    click.mockRestore();
  });

  it("announces export failures and allows retry", async () => {
    mocks.export.mockResolvedValue({
      ok: false,
      error: { code: "UNAUTHORIZED" },
    });
    render(
      <NextIntlClientProvider locale="en" messages={en}>
        <ExportAdEvalsButton />
      </NextIntlClientProvider>,
    );
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Download JSONL" }));
    await waitFor(() =>
      expect(mocks.error).toHaveBeenCalledWith(
        "Failed to export ad data. Try again.",
      ),
    );
    expect(
      screen.getByRole("button", { name: "Download JSONL" }),
    ).toBeEnabled();
  });
});
