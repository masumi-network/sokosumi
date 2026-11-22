import type { TaskFile } from "@sokosumi/core-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, expect, it, vi } from "vitest";
import { createFormats } from "@/i18n/time-format";
import messages from "../../../../../messages/en.json";
import { SeoPlanPdfLink } from "./seo-plan-pdf-link";
import { seoTestWorkspace } from "./seo-test-fixture";
import type { SeoWorkspaceModel } from "./use-seo-workspace";

const { getTaskById } = vi.hoisted(() => ({ getTaskById: vi.fn() }));
vi.mock("@/lib/clients/core.browser.client", () => ({
  coreClient: { getTaskById },
}));
vi.mock("@/lib/auth/auth.client", () => ({
  useSession: () => ({
    data: { user: { id: "owner" }, session: { activeOrganizationId: "org" } },
    isPending: false,
  }),
}));
afterEach(() => vi.resetAllMocks());

const TASK = "audit-task";
function file(ext: string, mimeType: string): TaskFile {
  const coworker = { id: "seo", name: "SEO", slug: "seo" };
  const name = `seo-report-${TASK}.${ext}`;
  return {
    id: `${TASK}-${ext}`,
    taskId: TASK,
    name,
    mimeType,
    fileUrl: `https://store.public.blob.vercel-storage.com/tasks/${TASK}/${name}`,
    size: 100,
    status: "READY",
    origin: "USER_UPLOAD",
    sourceUrl: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    uploader: { type: "coworker", id: coworker.id, coworker },
  };
}
function renderLink(files: TaskFile[]) {
  getTaskById.mockResolvedValue({
    data: { id: TASK, assigneeId: "seo", files },
  });
  render(
    <QueryClientProvider client={new QueryClient()}>
      <NextIntlClientProvider
        locale="en"
        timeZone="UTC"
        formats={createFormats()}
        messages={messages}
      >
        <SeoPlanPdfLink
          model={
            {
              data: seoTestWorkspace(),
              pending: false,
              execute: vi.fn(),
            } as unknown as SeoWorkspaceModel
          }
          taskId={TASK}
          observedAt={new Date("2026-11-01T16:35Z")}
        />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

it("links the audit's PDF from the files of its Task", async () => {
  renderLink([
    file("json", "application/json"),
    file("pdf", "application/pdf"),
  ]);
  expect(
    await screen.findByRole("link", { name: "Open full audit PDF" }),
  ).toHaveAttribute(
    "href",
    `https://store.public.blob.vercel-storage.com/tasks/${TASK}/seo-report-${TASK}.pdf`,
  );
});

it("shows no PDF button for a Task without a PDF", async () => {
  renderLink([file("json", "application/json")]);
  await waitFor(() => expect(getTaskById).toHaveBeenCalledWith(TASK));
  await waitFor(() => expect(screen.queryByRole("link")).toBeNull());
});
