import { TaskEventOrigin } from "@sokosumi/database";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { CoworkerGalleryCard } from "../coworker-gallery-card";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("next/image", () => ({
  default: function MockImage({ alt }: { alt: string }) {
    return <div data-testid="gallery-image" aria-label={alt} />;
  },
}));

describe("CoworkerGalleryCard", () => {
  it("reveals contact value when channel icon is clicked", async () => {
    const user = userEvent.setup();
    render(
      <CoworkerGalleryCard
        slug="soko"
        name="Soko"
        channels={[
          { origin: TaskEventOrigin.EMAIL, value: "soko@example.com" },
          { origin: TaskEventOrigin.WHATSAPP, value: "+49151" },
        ]}
        action={<button type="button">Select</button>}
      />,
    );

    await user.click(screen.getByRole("button", { name: "originApp.email" }));
    expect(screen.getByText("soko@example.com")).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: "originApp.whatsapp" }),
    );
    expect(screen.queryByText("soko@example.com")).not.toBeInTheDocument();
    expect(screen.getByText("+49151")).toBeInTheDocument();
  });
});
