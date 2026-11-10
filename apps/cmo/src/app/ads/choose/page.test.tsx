import { beforeEach, expect, it, vi } from "vitest";

const loadAdChoices = vi.fn();
const chooseAdAccount = vi.fn();

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`redirect ${url}`);
  },
}));

vi.mock("../../cmo-actions", () => ({ loadAdChoices, chooseAdAccount }));

const { default: ChooseAdAccountPage } = await import("./page");

const render = (query: {
  connection?: string;
  from?: string;
  project?: string;
}) => ChooseAdAccountPage({ searchParams: Promise.resolve(query) });

beforeEach(() => {
  loadAdChoices.mockReset();
  chooseAdAccount.mockReset();
});

it("ends Launch's popup on the done page when there is nothing to pick", async () => {
  loadAdChoices.mockResolvedValue([]);

  await expect(
    render({ connection: "conn-1", from: "popup", project: "project-2" }),
  ).rejects.toThrow("redirect /connect/done?result=failed&project=project-2");
  await expect(render({ from: "popup" })).rejects.toThrow(
    "redirect /connect/done?result=failed",
  );
});

it("still goes back to Launch outside a popup", async () => {
  loadAdChoices.mockResolvedValue([]);

  await expect(
    render({ connection: "conn-1", from: "onboarding", project: "project-2" }),
  ).rejects.toThrow(
    "redirect /?step=connect&from=onboarding&project=project-2",
  );
});
