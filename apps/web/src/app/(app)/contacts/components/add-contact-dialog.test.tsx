import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AddContactDialog } from "./add-contact-dialog";

// The service is a plain delegate, not the spy itself: Vitest fails a test
// whose spy returned a rejected promise, even when the component catches it.
const { create, respond } = vi.hoisted(() => ({
  create: vi.fn(),
  respond: { current: (): Promise<unknown> => Promise.resolve() },
}));
vi.mock("@/lib/services/contacts.client", () => ({
  contactsService: {
    create: (body: unknown) => {
      create(body);
      return respond.current();
    },
  },
}));
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

function renderDialog() {
  const props = {
    onClose: vi.fn(),
    onCreated: vi.fn(),
    onOpenExisting: vi.fn(),
  };
  render(
    <QueryClientProvider client={new QueryClient()}>
      <AddContactDialog {...props} />
    </QueryClientProvider>,
  );
  return props;
}

describe("AddContactDialog", () => {
  beforeEach(() => {
    create.mockReset();
    respond.current = () => Promise.resolve();
  });

  it("asks for a name or a channel before saving", () => {
    renderDialog();
    fireEvent.click(screen.getByRole("button", { name: "submit" }));
    expect(screen.getByRole("alert")).toHaveTextContent("nameOrChannel");
    expect(create).not.toHaveBeenCalled();
  });

  it("creates a prospect with its channel and opens it", async () => {
    respond.current = () => Promise.resolve({ contact: { id: "c-1" } });
    const props = renderDialog();
    fireEvent.change(screen.getByLabelText("name"), {
      target: { value: "Sana Iqbal" },
    });
    fireEvent.change(screen.getByLabelText("channelValue"), {
      target: { value: "sana@mistral.ai" },
    });
    fireEvent.click(screen.getByLabelText("prospect"));
    fireEvent.change(screen.getByLabelText("whyInteresting"), {
      target: { value: "Launch partner" },
    });
    fireEvent.click(screen.getByRole("button", { name: "submit" }));
    await waitFor(() => expect(props.onCreated).toHaveBeenCalledWith("c-1"));
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Sana Iqbal",
        stage: "PROSPECT",
        whyInteresting: "Launch partner",
        channels: [
          expect.objectContaining({ type: "EMAIL", value: "sana@mistral.ai" }),
        ],
      }),
    );
  });

  it("offers the contact that already owns a taken channel", async () => {
    respond.current = () =>
      Promise.reject({
        error: "Conflict",
        kind: "contact_channel_taken",
        existingContactId: "c-9",
        message: "taken",
      });
    const props = renderDialog();
    fireEvent.change(screen.getByLabelText("channelValue"), {
      target: { value: "lena@northwind.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "submit" }));
    const open = await screen.findByRole("button", { name: "openExisting" });
    fireEvent.click(open);
    expect(props.onOpenExisting).toHaveBeenCalledWith("c-9");
    expect(screen.getByRole("alert")).toHaveTextContent("channelTaken");
  });
});
