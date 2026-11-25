import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";

import messages from "../../../../messages/en.json";

const mocks = vi.hoisted(() => ({
  createRun: vi.fn(),
  push: vi.fn(),
}));
vi.mock("@/lib/actions/admin-evals/action", () => ({
  createAdminEvalRunAction: mocks.createRun,
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push }),
}));

import { RunEvalsDialog } from "./run-evals-dialog.client";

function renderDialog() {
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <RunEvalsDialog
        sokoBotVersions={{ defaultId: "v36", ids: ["v35", "v36"] }}
        cusoVersions={{ defaultId: "cmo-v20", ids: ["cmo-v20", "cmo-v22"] }}
      />
    </NextIntlClientProvider>,
  );
}

async function openDialog(user: ReturnType<typeof userEvent.setup>) {
  renderDialog();
  await user.click(screen.getByRole("button", { name: "Run evals" }));
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.createRun.mockResolvedValue({ ok: true, value: { id: "run-1" } });
});

describe("RunEvalsDialog", () => {
  it("starts on both default versions and sends none", async () => {
    const user = userEvent.setup();
    await openDialog(user);

    expect(
      screen.getByRole("combobox", { name: "Soko Bot version" }),
    ).toHaveTextContent("Default (v36)");
    expect(
      screen.getByRole("combobox", { name: "Cuso version" }),
    ).toHaveTextContent("Default (cmo-v20)");

    await user.click(screen.getByRole("button", { name: "Start run" }));

    expect(mocks.createRun).toHaveBeenCalledWith({
      suites: ["soko-bot", "cmo"],
      repeats: 1,
      caseIds: [],
      sokoBotVersionId: undefined,
      cusoVersionId: undefined,
    });
    expect(mocks.push).toHaveBeenCalledWith("/admin/evals/runs/run-1");
  });

  it("shows only the version of the chosen suite and sends it", async () => {
    const user = userEvent.setup();
    await openDialog(user);

    await user.click(screen.getByRole("radio", { name: "CMO" }));
    expect(
      screen.queryByRole("combobox", { name: "Soko Bot version" }),
    ).toBeNull();

    await user.click(screen.getByRole("combobox", { name: "Cuso version" }));
    await user.click(screen.getByRole("option", { name: "cmo-v22" }));
    await user.type(
      screen.getByRole("textbox", { name: "Only these cases" }),
      "cmo-strategy-cal-com",
    );
    await user.click(screen.getByRole("button", { name: "Start run" }));

    expect(mocks.createRun).toHaveBeenCalledWith({
      suites: ["cmo"],
      repeats: 1,
      caseIds: ["cmo-strategy-cal-com"],
      sokoBotVersionId: undefined,
      cusoVersionId: "cmo-v22",
    });
  });

  it("drops a picked Cuso version once the CMO suite is left out", async () => {
    const user = userEvent.setup();
    await openDialog(user);

    await user.click(screen.getByRole("combobox", { name: "Cuso version" }));
    await user.click(screen.getByRole("option", { name: "cmo-v22" }));
    await user.click(screen.getByRole("radio", { name: "Soko Bot" }));
    expect(screen.queryByRole("combobox", { name: "Cuso version" })).toBeNull();

    await user.click(
      screen.getByRole("combobox", { name: "Soko Bot version" }),
    );
    await user.click(screen.getByRole("option", { name: "v35" }));
    await user.click(screen.getByRole("button", { name: "Start run" }));

    expect(mocks.createRun).toHaveBeenCalledWith(
      expect.objectContaining({
        suites: ["soko-bot"],
        sokoBotVersionId: "v35",
        cusoVersionId: undefined,
      }),
    );
  });
});
