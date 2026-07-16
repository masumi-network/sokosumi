import { Channel } from "@sokosumi/utils";
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

  it("does not use mailto link when email value is empty or whitespace-only", () => {
    for (const value of ["", "   ", "\t"]) {
      const { unmount } = render(
        <CoworkerGalleryCard
          slug="soko"
          name="Soko"
          channels={[{ channel: Channel.EMAIL, value }]}
          action={<button type="button">Select</button>}
        />,
      );

      expect(
        screen.queryByRole("link", { name: "channelApp.email" }),
      ).not.toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "channelApp.email" }),
      ).toHaveAttribute("aria-pressed", "false");
      unmount();
    }
  });

  it("reveals raw value when expanded for whitespace-only email (no mailto)", async () => {
    const user = userEvent.setup();
    const { container } = render(
      <CoworkerGalleryCard
        slug="soko"
        name="Soko"
        channels={[{ channel: Channel.EMAIL, value: "   " }]}
        action={<button type="button">Select</button>}
      />,
    );

    expect(
      screen.queryByRole("link", { name: "channelApp.email" }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "channelApp.email" }));
    const expanded = container.querySelector("p.break-all");
    expect(expanded?.textContent).toBe("   ");
  });

  it("renders direct links for email and WhatsApp channels", () => {
    render(
      <CoworkerGalleryCard
        slug="soko"
        name="Soko"
        channels={[
          { channel: Channel.EMAIL, value: "  soko@example.com  " },
          { channel: Channel.WHATSAPP, value: "+49 151-123 45" },
        ]}
        action={<button type="button">Select</button>}
      />,
    );

    const emailChannel = screen.getByRole("link", { name: "channelApp.email" });
    expect(emailChannel).toHaveAttribute("href", "mailto:soko@example.com");

    const whatsAppChannel = screen.getByRole("link", {
      name: "channelApp.whatsapp",
    });
    expect(whatsAppChannel).toHaveAttribute("href", "https://wa.me/4915112345");
  });

  it("uses buttons for email and WhatsApp when the card is link-wrapped (no action)", () => {
    render(
      <CoworkerGalleryCard
        slug="soko"
        name="Soko"
        channels={[
          { channel: Channel.EMAIL, value: "soko@example.com" },
          { channel: Channel.WHATSAPP, value: "+49151" },
        ]}
      />,
    );

    expect(
      screen.queryByRole("link", { name: "channelApp.email" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "channelApp.whatsapp" }),
    ).not.toBeInTheDocument();

    expect(
      screen.getByRole("button", { name: "channelApp.email" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "channelApp.whatsapp" }),
    ).toBeInTheDocument();
  });

  it("reveals contact value when non-link channel icon is clicked", async () => {
    const user = userEvent.setup();
    render(
      <CoworkerGalleryCard
        slug="soko"
        name="Soko"
        channels={[
          { channel: Channel.TELEGRAM, value: "@soko-agent" },
          { channel: Channel.DISCORD, value: "soko#1337" },
        ]}
        action={<button type="button">Select</button>}
      />,
    );

    await user.click(
      screen.getByRole("button", { name: "channelApp.telegram" }),
    );
    expect(screen.getByText("@soko-agent")).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: "channelApp.discord" }),
    );
    expect(screen.queryByText("@soko-agent")).not.toBeInTheDocument();
    expect(screen.getByText("soko#1337")).toBeInTheDocument();
  });
});
