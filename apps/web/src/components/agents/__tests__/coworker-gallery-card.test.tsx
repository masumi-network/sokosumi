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
  it("uses native img for unsupported remote hosts so next/image is not invoked", () => {
    const unsupportedSrc =
      "https://external-content.duckduckgo.com/iu/test.jpg";
    render(
      <CoworkerGalleryCard
        slug="test-coworker"
        name="Test"
        image={unsupportedSrc}
        action={<button type="button">Select</button>}
      />,
    );

    expect(screen.queryByTestId("gallery-image")).not.toBeInTheDocument();
    const img = screen.getByRole("img", { name: "Test" });
    expect(img).toHaveAttribute("src", unsupportedSrc);
  });

  it("renders direct links for email and WhatsApp channels", () => {
    render(
      <CoworkerGalleryCard
        slug="soko"
        name="Soko"
        channels={[
          { origin: TaskEventOrigin.EMAIL, value: "soko@example.com" },
          { origin: TaskEventOrigin.WHATSAPP, value: "+49 151-123 45" },
        ]}
        action={<button type="button">Select</button>}
      />,
    );

    const emailChannel = screen.getByRole("link", { name: "originApp.email" });
    expect(emailChannel).toHaveAttribute("href", "mailto:soko@example.com");

    const whatsAppChannel = screen.getByRole("link", {
      name: "originApp.whatsapp",
    });
    expect(whatsAppChannel).toHaveAttribute("href", "https://wa.me/4915112345");
  });

  it("reveals contact value when non-link channel icon is clicked", async () => {
    const user = userEvent.setup();
    render(
      <CoworkerGalleryCard
        slug="soko"
        name="Soko"
        channels={[
          { origin: TaskEventOrigin.TELEGRAM, value: "@soko-agent" },
          { origin: TaskEventOrigin.DISCORD, value: "soko#1337" },
        ]}
        action={<button type="button">Select</button>}
      />,
    );

    await user.click(
      screen.getByRole("button", { name: "originApp.telegram" }),
    );
    expect(screen.getByText("@soko-agent")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "originApp.discord" }));
    expect(screen.queryByText("@soko-agent")).not.toBeInTheDocument();
    expect(screen.getByText("soko#1337")).toBeInTheDocument();
  });
});
