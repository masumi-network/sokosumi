import type { ContactList, ContactSuggestion } from "@sokosumi/core-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
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

  it("finds people with the list's description and the chosen size", async () => {
    service.suggestions.mockResolvedValue([]);
    service.findPeople.mockResolvedValue({
      found: 1,
      credits: 10,
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
      screen.getByRole("button", { name: "Find 25 people · 10 credits" }),
    );

    expect(service.findPeople).toHaveBeenCalledWith("list-1", {
      brief: "Seed investors in AI agents",
      size: 25,
    });
    expect(await screen.findByText("Mara Lind")).toBeTruthy();
  });
});
