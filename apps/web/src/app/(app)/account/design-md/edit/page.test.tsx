import { beforeEach, describe, expect, it, vi } from "vitest";

const getSessionMock = vi.fn();
const fetchDesignMdMarkdownMock = vi.fn();

vi.mock("next-intl/server", () => ({
  getTranslations: async () => (key: string) => key,
}));

vi.mock("@/lib/auth/auth.server", () => ({
  getSession: (...args: unknown[]) => getSessionMock(...args),
}));

vi.mock("@/components/design-md/design-md-edit-page-shared", () => ({
  DesignMdLoadError: (props: { title: string }) => props,
  fetchDesignMdMarkdown: (...args: unknown[]) =>
    fetchDesignMdMarkdownMock(...args),
}));

vi.mock("@/components/design-md-editor/design-md-editor", () => ({
  DesignMdEditor: (props: { initialMarkdown: string }) => props,
}));

import AccountDesignMdEditPage from "./page";

const DESIGN_MD_URL =
  "https://example.public.blob.vercel-storage.com/design-md/users/u/a.md";

function sessionWith(metadata: Record<string, string>) {
  return { user: { metadata: JSON.stringify(metadata) } };
}

describe("AccountDesignMdEditPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchDesignMdMarkdownMock.mockResolvedValue({ markdown: "# Brand" });
  });

  it("opens a DESIGN.md uploaded moments ago, which only a fresh session read sees", async () => {
    // The cached session predates the upload; the fresh read carries its URL.
    getSessionMock.mockImplementation(
      async (options?: { refresh?: boolean }) =>
        options?.refresh
          ? sessionWith({ designMdUrl: DESIGN_MD_URL })
          : sessionWith({}),
    );

    const page = await AccountDesignMdEditPage();

    expect(fetchDesignMdMarkdownMock).toHaveBeenCalledWith(DESIGN_MD_URL);
    expect(page.props).toMatchObject({ initialMarkdown: "# Brand" });
  });
});
