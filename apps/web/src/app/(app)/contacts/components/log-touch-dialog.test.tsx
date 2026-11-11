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

const client = new QueryClient();

function renderDialog() {
  const onClose = vi.fn();
  const view = render(
    <QueryClientProvider client={client}>
      <LogTouchDialog contact={contact} onClose={onClose} />
    </QueryClientProvider>,
  );
  // A teammate's save arriving through the contact query.
  const refetch = (next: Partial<ContactDetail>) =>
    view.rerender(
      <QueryClientProvider client={client}>
        <LogTouchDialog contact={{ ...contact, ...next }} onClose={onClose} />
      </QueryClientProvider>,
    );
  return Object.assign(onClose, { refetch });
}

function sentContact() {
  return logInteraction.mock.calls.at(-1)?.[1]?.contact;
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

  it("takes a teammate's next step it was not changing, on the new version", () => {
    const dialog = renderDialog();
    fireEvent.change(screen.getByLabelText("logTouch.summary"), {
      target: { value: "Call" },
    });
    fireEvent.change(screen.getByLabelText("columns.followUp"), {
      target: { value: "2026-12-01" },
    });
    dialog.refetch({ version: 4, nextStep: "Wait for procurement" });
    expect(screen.getByLabelText("panel.nextStep")).toHaveValue(
      "Wait for procurement",
    );
    expect(screen.queryByRole("alert")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "logTouch.submit" }));
    expect(sentContact()).toEqual({ version: 4, followUpAt: "2026-12-01" });
  });

  it("keeps the summary after a conflict and retries without undoing the teammate", async () => {
    respond.current = () =>
      Promise.reject({ kind: "contact_version_conflict", error: "Conflict" });
    const dialog = renderDialog();
    fireEvent.change(screen.getByLabelText("logTouch.summary"), {
      target: { value: "Agreed on terms" },
    });
    fireEvent.change(screen.getByLabelText("columns.followUp"), {
      target: { value: "2026-12-01" },
    });
    fireEvent.click(screen.getByRole("button", { name: "logTouch.submit" }));
    await screen.findByRole("alert");
    dialog.refetch({ version: 4, nextStep: "Wait for procurement" });
    respond.current = () => Promise.resolve();
    expect(screen.getByLabelText("logTouch.summary")).toHaveValue(
      "Agreed on terms",
    );
    fireEvent.click(screen.getByRole("button", { name: "logTouch.submit" }));
    await waitFor(() => expect(dialog).toHaveBeenCalled());
    expect(logInteraction.mock.calls.at(-1)?.[1]).toMatchObject({
      summary: "Agreed on terms",
    });
    expect(sentContact()).toEqual({ version: 4, followUpAt: "2026-12-01" });
  });

  it("keeps the reader's own next step when a teammate changed it too, and says so", () => {
    const dialog = renderDialog();
    fireEvent.change(screen.getByLabelText("panel.nextStep"), {
      target: { value: "Mine" },
    });
    dialog.refetch({ version: 4, nextStep: "Theirs" });
    expect(screen.getByRole("alert")).toHaveTextContent(
      "logTouch.changedMeanwhile",
    );
    expect(screen.getByLabelText("panel.nextStep")).toHaveValue("Mine");
    fireEvent.change(screen.getByLabelText("logTouch.summary"), {
      target: { value: "Call" },
    });
    fireEvent.click(screen.getByRole("button", { name: "logTouch.submit" }));
    expect(sentContact()).toEqual({ version: 4, nextStep: "Mine" });
  });
});
