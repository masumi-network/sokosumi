import type { ContactDetail } from "@sokosumi/core-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LogTouchDialog } from "./log-touch-dialog";

// The service is a plain delegate, not the spy itself: Vitest fails a test
// whose spy returned a rejected promise, even when the component catches it.
const { logInteraction, respond } = vi.hoisted(() => ({
  logInteraction: vi.fn(),
  respond: { current: (): Promise<unknown> => Promise.resolve() },
}));
vi.mock("@/lib/services/contacts.client", () => ({
  contactsService: {
    logInteraction: (id: string, body: unknown) => {
      logInteraction(id, body);
      return respond.current();
    },
  },
}));
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn() } }));

const contact = {
  id: "c-1",
  name: "Ada Lovelace",
  version: 3,
  nextStep: "Send the deck",
  followUpAt: "2026-11-12",
} as ContactDetail;

function renderDialog() {
  const onClose = vi.fn();
  render(
    <QueryClientProvider client={new QueryClient()}>
      <LogTouchDialog contact={contact} onClose={onClose} />
    </QueryClientProvider>,
  );
  return onClose;
}

describe("LogTouchDialog", () => {
  beforeEach(() => {
    logInteraction.mockReset();
    respond.current = () => Promise.resolve();
  });

  it("asks what happened before saving", () => {
    renderDialog();
    fireEvent.click(screen.getByRole("button", { name: "logTouch.submit" }));
    expect(screen.getByRole("alert")).toHaveTextContent(
      "logTouch.summaryRequired",
    );
    expect(logInteraction).not.toHaveBeenCalled();
  });

  it("logs a note and leaves next step and follow-up alone", async () => {
    const onClose = renderDialog();
    fireEvent.change(screen.getByLabelText("logTouch.summary"), {
      target: { value: "  Sent the deck  " },
    });
    fireEvent.click(screen.getByRole("button", { name: "logTouch.submit" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    const [id, body] = logInteraction.mock.calls[0] ?? [];
    expect(id).toBe("c-1");
    expect(body).toMatchObject({
      channel: "MANUAL",
      direction: null,
      summary: "Sent the deck",
    });
    expect(body).not.toHaveProperty("contact");
  });

  it("logs a call with the changed next step and a cleared follow-up", async () => {
    renderDialog();
    fireEvent.click(screen.getByLabelText("panel.interactionChannels.CALL"));
    fireEvent.change(screen.getByLabelText("logTouch.summary"), {
      target: { value: "Wants a pilot" },
    });
    fireEvent.change(screen.getByLabelText("panel.nextStep"), {
      target: { value: "Send pilot terms" },
    });
    fireEvent.click(screen.getByRole("button", { name: "panel.noFollowUp" }));
    fireEvent.click(screen.getByRole("button", { name: "logTouch.submit" }));
    await waitFor(() => expect(logInteraction).toHaveBeenCalled());
    expect(logInteraction.mock.calls[0]?.[1]).toMatchObject({
      channel: "CALL",
      direction: "BOTH",
      contact: { version: 3, nextStep: "Send pilot terms", followUpAt: null },
    });
  });

  it("says so when a teammate saved the contact first", async () => {
    respond.current = () =>
      Promise.reject({ kind: "contact_version_conflict", error: "Conflict" });
    const onClose = renderDialog();
    fireEvent.change(screen.getByLabelText("logTouch.summary"), {
      target: { value: "Call" },
    });
    fireEvent.click(screen.getByRole("button", { name: "logTouch.inAWeek" }));
    fireEvent.click(screen.getByRole("button", { name: "logTouch.submit" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "errors.versionConflict",
    );
    expect(onClose).not.toHaveBeenCalled();
  });
});
