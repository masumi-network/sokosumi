import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { APP_SHELL_MESSAGE_PATHS } from "@/i18n/message-namespaces";
import { pickMessages } from "@/i18n/pick-messages";
import en from "@/messages/en.json";
import { ProjectScopeActivity } from "./project-scope-activity";

const workspace = vi.hoisted(() => ({ id: "org-a" }));
vi.mock("@/lib/auth/auth.client", () => ({
  useSession: () => ({
    data: {
      user: { id: "user-1" },
      session: { activeOrganizationId: workspace.id },
    },
  }),
}));

afterEach(() => {
  vi.unstubAllGlobals();
});

it("shows linked activity on shell routes and drops late data from the previous workspace", async () => {
  const response = {
    scope: { userId: "user-1", organizationId: "org-a" },
    data: [
      {
        id: "event-1",
        kind: "task",
        taskId: "task-1",
        title: "Prepare the launch",
        status: "INPUT_REQUIRED",
        createdAt: new Date().toISOString(),
        project: { name: "Launch", logo: null },
      },
    ],
  };
  const next = Promise.withResolvers<Response>();
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValueOnce(Response.json(response))
      .mockReturnValueOnce(next.promise),
  );
  const client = new QueryClient();
  function wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        <NextIntlClientProvider
          locale="en"
          timeZone="UTC"
          messages={pickMessages(en, APP_SHELL_MESSAGE_PATHS)}
        >
          {children}
        </NextIntlClientProvider>
      </QueryClientProvider>
    );
  }

  const { rerender } = render(<ProjectScopeActivity onNavigate={vi.fn()} />, {
    wrapper,
  });
  const link = await screen.findByRole("link", { name: /Prepare the launch/ });
  expect(link).toHaveAttribute("href", "/tasks/task-1");
  expect(link).toHaveTextContent("Launch · Task needs input");

  workspace.id = "org-b";
  rerender(<ProjectScopeActivity onNavigate={vi.fn()} />);
  expect(screen.queryByRole("link")).toBeNull();

  next.resolve(Response.json(response));
  expect(await screen.findByRole("status")).toHaveTextContent(
    "Failed to load recent activity.",
  );
  expect(screen.queryByRole("link")).toBeNull();
});
