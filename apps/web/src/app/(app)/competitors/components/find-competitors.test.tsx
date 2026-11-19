import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  addSuggestedCompetitors,
  findCompetitors,
} from "@/lib/actions/competitors/action";
import messages from "@/messages/en.json";

import { FindCompetitors } from "./find-competitors";

vi.mock("@/lib/actions/competitors/action", () => ({
  addSuggestedCompetitors: vi.fn(),
  findCompetitors: vi.fn(),
}));

const SUGGESTIONS = [
  {
    name: "Calendly",
    websiteUrl: "https://www.calendly.com/",
    why: "Scheduling links for teams.",
  },
  {
    name: "Doodle",
    websiteUrl: "https://doodle.com/",
    why: "Group polls and booking pages.",
  },
  {
    name: "Zcal",
    websiteUrl: "https://zcal.co/",
    why: "Free scheduling pages.",
  },
];

function show(room = 2) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
      <FindCompetitors
        projectId="project-1"
        projectName="Cal.com"
        room={room}
      />
    </NextIntlClientProvider>,
  );
}

async function open() {
  await userEvent.click(
    screen.getByRole("button", { name: "Find competitors" }),
  );
  return within(await screen.findByRole("dialog"));
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(findCompetitors).mockResolvedValue({
    ok: true,
    value: SUGGESTIONS,
  });
  vi.mocked(addSuggestedCompetitors).mockResolvedValue({
    ok: true,
    value: undefined,
  });
});

describe("FindCompetitors", () => {
  it("searches on the click and adds nothing until the member picks", async () => {
    show();
    const dialog = await open();
    expect(findCompetitors).toHaveBeenCalledWith({ projectId: "project-1" });
    expect(await dialog.findByText("Calendly")).toBeVisible();
    expect(dialog.getByText("calendly.com")).toBeVisible();
    expect(dialog.getByText("Scheduling links for teams.")).toBeVisible();
    expect(dialog.getByRole("button", { name: "Add" })).toBeDisabled();
    expect(addSuggestedCompetitors).not.toHaveBeenCalled();
  });

  it("adds the picked ones, in the order shown, and closes", async () => {
    show();
    const dialog = await open();
    await userEvent.click(await dialog.findByLabelText(/Doodle/));
    await userEvent.click(dialog.getByLabelText(/Calendly/));
    await userEvent.click(
      dialog.getByRole("button", { name: "Add 2 competitors" }),
    );
    expect(addSuggestedCompetitors).toHaveBeenCalledWith({
      projectId: "project-1",
      competitors: [
        { name: "Calendly", websiteUrl: "https://www.calendly.com/" },
        { name: "Doodle", websiteUrl: "https://doodle.com/" },
      ],
    });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("lets the member pick only as many as the list has room for", async () => {
    show(1);
    const dialog = await open();
    await userEvent.click(await dialog.findByLabelText(/Calendly/));
    expect(dialog.getByLabelText(/Doodle/)).toBeDisabled();
    expect(dialog.getByText("You can add 0 more.")).toBeVisible();
    await userEvent.click(dialog.getByLabelText(/Calendly/));
    expect(dialog.getByLabelText(/Doodle/)).toBeEnabled();
  });

  it("shows Core's refusal and offers to search again", async () => {
    vi.mocked(findCompetitors).mockResolvedValueOnce({
      ok: false,
      error: {
        code: "BAD_INPUT",
        message: "Add the project's website first.",
      },
    });
    show();
    const dialog = await open();
    expect(await dialog.findByRole("alert")).toHaveTextContent(
      "Add the project's website first.",
    );
    await userEvent.click(dialog.getByRole("button", { name: "Search again" }));
    expect(await dialog.findByText("Doodle")).toBeVisible();
  });

  it("says so when nothing was found", async () => {
    vi.mocked(findCompetitors).mockResolvedValueOnce({ ok: true, value: [] });
    show();
    const dialog = await open();
    expect(
      await dialog.findByText(
        "No competitors found from the website. Add them by hand.",
      ),
    ).toBeVisible();
  });
});
