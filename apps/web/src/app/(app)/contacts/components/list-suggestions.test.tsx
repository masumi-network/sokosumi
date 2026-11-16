import type { ContactList, ContactSuggestion } from "@sokosumi/core-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import en from "@/messages/en.json";

import { ListSuggestions } from "./list-suggestions";

const service = vi.hoisted(() => ({
  suggestions: vi.fn(),
  findPeople: vi.fn(),
  addSuggestions: vi.fn(),
  dismissSuggestions: vi.fn(),
}));

vi.mock("@/lib/services/contacts.client", () => ({
  contactsService: service,
}));
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}));

const list = {
  id: "list-1",
  name: "Investors",
  description: "Seed investors in AI agents",
  kind: "manual",
} as ContactList;

const mara: ContactSuggestion = {
  id: "s-1",
  listId: "list-1",
  profileUrl: "https://linkedin.com/in/maralind",
  name: "Mara Lind",
  role: "Partner",
  organization: "Northwind Ventures",
  location: "Berlin",
  reason: "Leads pre-seed rounds in AI infrastructure.",
  status: "SUGGESTED",
  contactId: null,
  createdAt: new Date("2026-11-01T10:00:00Z"),
};

function renderSuggestions() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <NextIntlClientProvider locale="en" messages={en}>
        <ListSuggestions list={list} />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

describe("ListSuggestions", () => {
  beforeEach(() => vi.clearAllMocks());

  it("shows who was found and why, and adds one to the list", async () => {
    service.suggestions.mockResolvedValue([mara]);
    service.addSuggestions.mockResolvedValue({ count: 1 });
    const user = userEvent.setup();
    renderSuggestions();

    expect(await screen.findByText("Mara Lind")).toBeTruthy();
    expect(
      screen.getByText("Partner · Northwind Ventures · Berlin"),
    ).toBeTruthy();
    expect(
      screen.getByText("Leads pre-seed rounds in AI infrastructure."),
    ).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Add Mara Lind" }));
    expect(service.addSuggestions).toHaveBeenCalledWith("list-1", ["s-1"]);
    expect(screen.queryByText("Mara Lind")).toBeNull();
  });

  it("takes a suggestion away before Core answers", async () => {
    service.suggestions.mockResolvedValue([mara]);
    service.dismissSuggestions.mockReturnValueOnce(new Promise(() => {}));
    const user = userEvent.setup();
    renderSuggestions();
    await screen.findByText("Mara Lind");
    await user.click(screen.getByRole("button", { name: "Dismiss Mara Lind" }));
    expect(service.dismissSuggestions).toHaveBeenCalledWith("list-1", ["s-1"]);
    expect(screen.queryByText("Mara Lind")).toBeNull();
  });

  it("brings a suggestion back when the save fails", async () => {
    service.suggestions.mockResolvedValue([mara]);
    let fail = (_: unknown) => {};
    service.addSuggestions.mockReturnValueOnce(
      new Promise((_, reject) => void (fail = reject)),
    );
    const user = userEvent.setup();
    renderSuggestions();
    await screen.findByText("Mara Lind");
    await user.click(screen.getByRole("button", { name: "Add Mara Lind" }));
    expect(screen.queryByText("Mara Lind")).toBeNull();
    fail({ message: "No access" });
    expect(await screen.findByText("Mara Lind")).toBeTruthy();
    expect(service.suggestions).toHaveBeenCalledTimes(2);
  });

  it("keeps a handled suggestion away when a reload brought it back", async () => {
    const ben = { ...mara, id: "s-2", name: "Ben Ode" };
    service.suggestions.mockResolvedValue([mara, ben]);
    let fail = (_: unknown) => {};
    let finish = () => {};
    service.addSuggestions.mockReturnValueOnce(
      new Promise((_, reject) => void (fail = reject)),
    );
    service.dismissSuggestions.mockReturnValueOnce(
      new Promise<void>((resolve) => void (finish = resolve)),
    );
    const user = userEvent.setup();
    renderSuggestions();
    await screen.findByText("Mara Lind");
    await user.click(screen.getByRole("button", { name: "Add Mara Lind" }));
    await user.click(screen.getByRole("button", { name: "Dismiss Ben Ode" }));
    // Mara's failed add reloads the list while Core still suggests Ben.
    fail({ message: "No access" });
    expect(await screen.findByText("Ben Ode")).toBeTruthy();
    finish();
    await waitFor(() => expect(screen.queryByText("Ben Ode")).toBeNull());
    expect(screen.getByText("Mara Lind")).toBeTruthy();
  });

  it("finds people with the list's description and the chosen size", async () => {
    service.suggestions.mockResolvedValue([]);
    service.findPeople.mockResolvedValue({
      found: 1,
      credits: 0.5,
      suggestions: [mara],
    });
    const user = userEvent.setup();
    renderSuggestions();

    await user.click(
      await screen.findByRole("button", { name: "Find people" }),
    );
    expect(screen.getByLabelText("Who belongs in this list?")).toHaveValue(
      "Seed investors in AI agents",
    );
    await user.click(screen.getByRole("radio", { name: "25 people" }));
    await user.click(
      screen.getByRole("button", {
        name: "Find 25 people · up to 12.5 credits",
      }),
    );

    expect(service.findPeople).toHaveBeenCalledWith("list-1", {
      brief: "Seed investors in AI agents",
      size: 25,
    });
    expect(await screen.findByText("Mara Lind")).toBeTruthy();
  });

  it("looks for one particular person without touching the list's description", async () => {
    service.suggestions.mockResolvedValue([]);
    service.findPeople.mockResolvedValue({
      found: 1,
      credits: 0.5,
      suggestions: [mara],
    });
    const user = userEvent.setup();
    renderSuggestions();

    await user.click(
      await screen.findByRole("button", { name: "Find people" }),
    );
    await user.click(screen.getByRole("radio", { name: "1 person" }));
    await user.type(
      screen.getByLabelText("Who are you looking for?"),
      "Mara Lind, Northwind",
    );
    await user.click(
      screen.getByRole("button", { name: "Find 1 person · up to 0.5 credits" }),
    );

    expect(service.findPeople).toHaveBeenCalledWith("list-1", {
      brief: "Mara Lind, Northwind",
      size: 1,
    });
  });
});
