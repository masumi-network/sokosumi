import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AddContactDialog } from "./add-contact-dialog";

// The service is a plain delegate, not the spy itself: Vitest fails a test
// whose spy returned a rejected promise, even when the component catches it.
const { create, changeMembers, respond, member } = vi.hoisted(() => ({
  create: vi.fn(),
  changeMembers: vi.fn(),
  respond: { current: (): Promise<unknown> => Promise.resolve() },
  member: { current: (): Promise<unknown> => Promise.resolve() },
}));
vi.mock("@/lib/services/contacts.client", () => ({
  contactsService: {
    create: (body: unknown) => {
      create(body);
      return respond.current();
    },
    changeMembers: (listId: string, change: unknown) => {
      changeMembers(listId, change);
      return member.current();
    },
  },
}));
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

function renderDialog(listId?: string) {
  const props = {
    listId,
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
    changeMembers.mockReset();
    respond.current = () => Promise.resolve();
    member.current = () => Promise.resolve();
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
    expect(changeMembers).not.toHaveBeenCalled();
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

  it("adds the new person to the list that is open", async () => {
    respond.current = () => Promise.resolve({ contact: { id: "c-2" } });
    const props = renderDialog("list-1");
    fireEvent.change(screen.getByLabelText("name"), {
      target: { value: "Marco Rossi" },
    });
    fireEvent.click(screen.getByRole("button", { name: "submit" }));
    await waitFor(() => expect(props.onCreated).toHaveBeenCalledWith("c-2"));
    expect(changeMembers).toHaveBeenCalledWith("list-1", { add: ["c-2"] });
  });

  it("keeps a saved contact when the list fails and retries only the list", async () => {
    respond.current = () => Promise.resolve({ contact: { id: "c-3" } });
    member.current = () => Promise.reject({ error: "Gone", message: "gone" });
    const props = renderDialog("list-1");
    fireEvent.change(screen.getByLabelText("name"), {
      target: { value: "Marco Rossi" },
    });
    fireEvent.click(screen.getByRole("button", { name: "submit" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("listFailed");
    expect(
      screen.getByRole("button", { name: "openExisting" }),
    ).toBeInTheDocument();
    expect(props.onCreated).not.toHaveBeenCalled();

    member.current = () => Promise.resolve();
    fireEvent.click(screen.getByRole("button", { name: "submit" }));
    await waitFor(() => expect(props.onCreated).toHaveBeenCalledWith("c-3"));
    expect(create).toHaveBeenCalledTimes(1);
    expect(changeMembers).toHaveBeenCalledTimes(2);
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
