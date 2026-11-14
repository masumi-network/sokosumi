import type { SokoBotInstalledSkill } from "@sokosumi/core-client";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { removeMock, toastErrorMock } = vi.hoisted(() => ({
  removeMock: vi.fn(),
  toastErrorMock: vi.fn(),
}));

vi.mock("@/lib/actions/soko-bot/action", () => ({
  // The popular list never answers: these tests are about installed skills.
  browseSokoBotSkillsAction: () => new Promise(() => {}),
  installSokoBotSkillAction: vi.fn(),
  removeSokoBotSkillAction: removeMock,
  searchSokoBotSkillsAction: vi.fn(),
}));
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: toastErrorMock },
}));

import { SkillsSection } from "./skills-section.client";

function skill(name: string): SokoBotInstalledSkill {
  return {
    id: `id-${name}`,
    slug: `owner/${name}`,
    name,
    description: "",
    sourceUrl: `https://example.com/${name}`,
    sourceRef: null,
    createdAt: new Date(0),
  };
}

const shownSkills = () =>
  screen.getAllByRole("listitem").map((item) => item.textContent);

describe("SkillsSection remove", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each([
    [
      "Core refuses",
      (reject: (e: Error) => void, answer: (v: unknown) => void) =>
        answer({ ok: false, error: { message: "Core is down" } }),
      "Core is down",
    ],
    [
      "the call fails",
      (reject: (e: Error) => void) => reject(new Error("network down")),
      "removeError",
    ],
  ])(
    "takes a skill off the list before Core answers and puts it back in place when %s",
    async (_case, settle, message) => {
      let answer: (value: unknown) => void = () => {};
      let reject: (reason: Error) => void = () => {};
      removeMock.mockReturnValueOnce(
        new Promise((resolve, fail) => {
          answer = resolve;
          reject = fail;
        }),
      );
      render(
        <SkillsSection
          version={null}
          initialInstalled={[skill("first"), skill("second"), skill("third")]}
        />,
      );

      fireEvent.click(screen.getAllByRole("button", { name: "remove" })[1]);
      expect(shownSkills()).toEqual(["firstowner/first", "thirdowner/third"]);

      await act(async () => settle(reject, answer));
      expect(shownSkills()).toEqual([
        "firstowner/first",
        "secondowner/second",
        "thirdowner/third",
      ]);
      expect(toastErrorMock).toHaveBeenCalledWith(message);
    },
  );

  it("keeps the skill off the list when Core removes it", async () => {
    removeMock.mockResolvedValueOnce({ ok: true, value: null });
    render(
      <SkillsSection version={null} initialInstalled={[skill("first")]} />,
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "remove" }));
    });

    expect(screen.queryByRole("listitem")).toBeNull();
    expect(toastErrorMock).not.toHaveBeenCalled();
  });
});
