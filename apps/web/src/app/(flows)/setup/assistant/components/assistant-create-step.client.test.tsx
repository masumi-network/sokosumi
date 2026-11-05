import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it, vi } from "vitest";
import en from "@/messages/en.json";

import { AssistantCreateStep } from "./assistant-create-step.client";

const replaceMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: replaceMock }),
}));

vi.mock("@/app/personal-assistant/components/create-state.client", () => ({
  CreateState: ({
    secondaryAction,
    onCreated,
  }: {
    secondaryAction?: React.ReactNode;
    onCreated: () => void;
  }) => (
    <div>
      <button type="button" onClick={() => onCreated()}>
        create
      </button>
      {secondaryAction}
    </div>
  ),
}));

function renderStep() {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <AssistantCreateStep
        paidByOrganization={false}
        laterUrl="/tasks"
        connectUrl="/setup/assistant/connect?next=%2Ftasks"
      />
    </NextIntlClientProvider>,
  );
}

describe("AssistantCreateStep", () => {
  it("lets the user skip to where setup was going", () => {
    renderStep();

    expect(screen.getByRole("link", { name: "Later" })).toHaveAttribute(
      "href",
      "/tasks",
    );
  });

  it("moves on to the connect step once the bot exists", async () => {
    const user = userEvent.setup();
    renderStep();

    await user.click(screen.getByRole("button", { name: "create" }));

    expect(replaceMock).toHaveBeenCalledWith(
      "/setup/assistant/connect?next=%2Ftasks",
    );
  });
});
