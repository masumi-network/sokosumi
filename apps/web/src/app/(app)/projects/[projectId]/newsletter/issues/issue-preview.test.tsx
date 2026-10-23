import type { CreateNewsletterIssueRequest } from "@sokosumi/core-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import en from "@/messages/en.json";
import { NEWSLETTER_PROJECT_ID } from "@/test/newsletter";
import { NewsletterIssuePreview } from "./issue-preview";

const VALUES: CreateNewsletterIssueRequest = {
  subject: "News",
  template: "TEXT",
  content: [{ type: "text", text: "Hello" }],
};
afterEach(() => vi.unstubAllGlobals());

function previewView() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return (values = VALUES) => (
    <NextIntlClientProvider locale="en" messages={en}>
      <QueryClientProvider client={client}>
        <NewsletterIssuePreview
          projectId={NEWSLETTER_PROJECT_ID}
          values={values}
        />
      </QueryClientProvider>
    </NextIntlClientProvider>
  );
}

describe("newsletter issue preview", () => {
  it("renders Core HTML in the shared Social frame with an empty sandbox and device toggle", async () => {
    const user = userEvent.setup();
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ html: "<h1>News</h1><script>bad()</script>" }),
          { status: 200 },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);
    render(previewView()());
    const frame = await screen.findByTitle("Newsletter email preview");
    expect(frame).toHaveAttribute("sandbox", "");
    expect(frame).toHaveAttribute(
      "srcdoc",
      "<h1>News</h1><script>bad()</script>",
    );
    expect(frame.parentElement).toHaveAttribute(
      "class",
      expect.stringContaining("rounded-xl"),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/projects/${NEWSLETTER_PROJECT_ID}/newsletter/issues/preview`,
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify(VALUES),
        signal: expect.any(AbortSignal),
      }),
    );
    await user.click(screen.getByText("Mobile"));
    expect(frame.parentElement).toHaveClass("max-w-sm");
    await user.click(screen.getByText("Desktop"));
    expect(frame.parentElement).not.toHaveClass("max-w-sm");
  });

  it("debounces typing for 600ms and submits only the latest content", async () => {
    const fetchMock = vi.fn().mockImplementation(
      async (_url, options) =>
        new Response(
          JSON.stringify({
            html: `<h1>${JSON.parse(options.body).subject}</h1>`,
          }),
          { status: 200 },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const view = previewView();
    const { rerender } = render(view());
    await screen.findByTitle("Newsletter email preview");
    rerender(view({ ...VALUES, subject: "First edit" }));
    rerender(view({ ...VALUES, subject: "Latest edit" }));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2), {
      timeout: 2000,
    });
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).subject).toBe(
      "Latest edit",
    );
    await waitFor(() =>
      expect(screen.getByTitle("Newsletter email preview")).toHaveAttribute(
        "srcdoc",
        "<h1>Latest edit</h1>",
      ),
    );
  });

  it("pauses invalid content and offers retry after a preview failure", async () => {
    const user = userEvent.setup();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("Unavailable", { status: 503 }))
      .mockImplementation(
        async () =>
          new Response(JSON.stringify({ html: "<p>Recovered</p>" }), {
            status: 200,
          }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const view = previewView();
    const { rerender } = render(
      view({
        ...VALUES,
        content: [{ type: "image", url: "http://example.com/a.png", alt: "" }],
      }),
    );
    expect(
      screen.getByText(en.App.Projects.Newsletter.Issues.Preview.invalid),
    ).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
    rerender(view());
    expect(
      await screen.findByRole("alert", {}, { timeout: 2000 }),
    ).toHaveTextContent(en.App.Projects.Newsletter.Issues.Preview.error);
    await user.click(screen.getByRole("button", { name: "Retry preview" }));
    expect(
      await screen.findByTitle("Newsletter email preview"),
    ).toHaveAttribute("srcdoc", "<p>Recovered</p>");
  });

  it("cancels an obsolete request so a slow response cannot overwrite the latest preview", async () => {
    let oldSignal: AbortSignal | undefined;
    const fetchMock = vi.fn().mockImplementation(async (_url, options) => {
      if (JSON.parse(options.body).subject === "News") {
        oldSignal = options.signal;
        return new Promise<Response>(() => {});
      }
      return new Response(JSON.stringify({ html: "<p>Latest</p>" }), {
        status: 200,
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    const view = previewView();
    const { rerender } = render(view());
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await act(async () => rerender(view({ ...VALUES, subject: "Updated" })));
    expect(
      await screen.findByTitle(
        "Newsletter email preview",
        {},
        { timeout: 2000 },
      ),
    ).toHaveAttribute("srcdoc", "<p>Latest</p>");
    expect(oldSignal?.aborted).toBe(true);
  });
});
