import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { Coworker } from "@/app/chat/utils/types";

import CoworkerSelector from "../coworker-selector";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

const elena: Coworker = {
  id: "elena",
  slug: "elena",
  name: "Elena",
  caption: "Strategy",
  description: "",
  useCase: "",
  capabilities: ["chat"],
  archivedAt: null,
  isWhitelisted: true,
  canChat: true,
};

describe("CoworkerSelector", () => {
  it("lists coworkers only and has no Models section", async () => {
    const user = userEvent.setup();
    render(
      <CoworkerSelector
        selectedCoworker={elena}
        coworkers={[elena]}
        onSelectCoworker={() => {}}
      />,
    );

    await user.click(screen.getByRole("button"));

    await waitFor(() => {
      expect(screen.getByText("agenticCoworkers")).toBeInTheDocument();
    });
    expect(screen.getByText("Strategy")).toBeInTheDocument();
    expect(screen.queryByText("models")).toBeNull();
    expect(screen.queryByText("GPT-5.4")).toBeNull();
  });
});
