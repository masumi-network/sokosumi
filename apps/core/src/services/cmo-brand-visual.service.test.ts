import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetCmoServiceMocks } from "@/test-fixtures/cmo-service";

vi.mock(
  "@/lib/db/prisma",
  async () =>
    (await import("@/test-fixtures/cmo-service")).cmoServiceMocks.prisma,
);
vi.mock(
  "@/services/social-posts.service",
  async () =>
    (await import("@/test-fixtures/cmo-service")).cmoServiceMocks.socialPosts,
);
vi.mock(
  "@/services/soko-bot-shared-create.service",
  async () =>
    (await import("@/test-fixtures/cmo-service")).cmoServiceMocks.sharedCreate,
);
vi.mock(
  "@/services/soko-bot-control-plane.service",
  async () =>
    (await import("@/test-fixtures/cmo-service")).cmoServiceMocks.controlPlane,
);
vi.mock(
  "@/helpers/organization-workspace",
  async () =>
    (await import("@/test-fixtures/cmo-service")).cmoServiceMocks
      .organizationWorkspace,
);
vi.mock(
  "@/helpers/user-workspaces",
  async () =>
    (await import("@/test-fixtures/cmo-service")).cmoServiceMocks
      .userWorkspaces,
);
vi.mock(
  "@/helpers/subscription",
  async () =>
    (await import("@/test-fixtures/cmo-service")).cmoServiceMocks.subscription,
);
vi.mock(
  "@/services/soko-bot-billing.service",
  async () =>
    (await import("@/test-fixtures/cmo-service")).cmoServiceMocks.billing,
);
vi.mock(
  "@vercel/functions",
  async () =>
    (await import("@/test-fixtures/cmo-service")).cmoServiceMocks
      .vercelFunctions,
);
vi.mock(
  "@/services/soko-bot-integration-connection.service",
  async () =>
    (await import("@/test-fixtures/cmo-service")).cmoServiceMocks
      .integrationConnection,
);
vi.mock("@/config/env", async (importOriginal) =>
  (await import("@/test-fixtures/cmo-service")).cmoServiceMocks.env(
    await importOriginal<typeof import("@/config/env")>(),
  ),
);

import { mergeBrandVisual } from "./cmo-brand-visual.service";

beforeEach(resetCmoServiceMocks);

describe("brand visual", () => {
  it("lets the DESIGN.md colours lead and keeps the site's logo", () => {
    const visual = mergeBrandVisual(
      {
        logoUrl: "https://acme.io/logo.svg",
        colors: ["#ff6a00"],
        fonts: ["Inter"],
        siteName: "Acme",
        images: ["https://acme.io/hero.jpg"],
      },
      "https://blob/icon.png",
      {
        url: "https://blob/design.md",
        content: "Primary: `#6400FF` Accent: `#6a05ff`",
      },
    );
    expect(visual).toEqual({
      logoUrl: "https://acme.io/logo.svg",
      colors: ["#6400ff", "#ff6a00"],
      fonts: ["Inter"],
      siteName: "Acme",
      designMdUrl: "https://blob/design.md",
      images: ["https://acme.io/hero.jpg"],
    });
  });
});
