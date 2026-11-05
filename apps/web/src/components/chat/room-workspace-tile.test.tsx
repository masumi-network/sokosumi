import { fireEvent, render } from "@testing-library/react";
import type { ImgHTMLAttributes } from "react";
import { describe, expect, it, vi } from "vitest";
import { stubPendingImageLoad } from "@/test/stub-pending-image-load";
import { makeRoom } from "./__tests__/chat-room-fixtures";
import { RoomWorkspaceTile } from "./room-workspace-tile";

vi.mock("next/image", () => ({
  __esModule: true,
  default: (props: ImgHTMLAttributes<HTMLImageElement>) => <img {...props} />,
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("@/lib/auth/auth.client", () => ({
  useSession: () => ({
    data: {
      user: {
        id: "me",
        name: "Me",
        email: "me@example.com",
        image: "https://cdn.example/me.png",
      },
    },
  }),
}));

function renderTile(
  overrides: Parameters<typeof makeRoom>[0],
  workspaceName = "Other Org",
) {
  const { container } = render(
    <RoomWorkspaceTile
      room={makeRoom({ organizationId: "org-2", ...overrides })}
      workspaceName={workspaceName}
      takesMenuColumn
      recolorsOnHover={false}
    />,
  );
  return container.querySelector('[data-slot="workspace-tile"]') as HTMLElement;
}

describe("RoomWorkspaceTile", () => {
  stubPendingImageLoad();

  it("draws the workspace's logo", () => {
    const tile = renderTile({
      organizationLogo: "https://cdn.example/other.png",
    });

    expect(tile.querySelector("img")?.getAttribute("src")).toBe(
      "https://cdn.example/other.png",
    );
    expect(tile.textContent).toBe("");
  });

  it("draws the initial of the name when there is no logo or website", () => {
    const tile = renderTile({}, "  other org");

    expect(tile.querySelector("svg")).toBeNull();
    expect(tile.textContent).toBe("O");
  });

  it("draws the initial when the favicon fails to load", () => {
    const tile = renderTile({
      organizationWebsiteUrl: "https://other.example",
    });

    for (
      let image = tile.querySelector("img");
      image;
      image = tile.querySelector("img")
    ) {
      fireEvent.error(image);
    }

    expect(tile.querySelector("svg")).toBeNull();
    expect(tile.textContent).toBe("O");
  });

  it("draws the reader's own avatar for the personal workspace", () => {
    const tile = renderTile({ organizationId: null }, "Personal");

    expect(tile.textContent).toBe("");
    expect(tile.querySelector('[data-slot="avatar"]')).not.toBeNull();
  });
});
