import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ProjectBrandCard,
  ProjectBrandProvider,
} from "@/app/projects/components/project-brand-card";
import { ProjectBrandSetup } from "@/app/projects/components/project-brand-setup";
import {
  finalizeDesignMdGeneration,
  pollDesignMdGeneration,
  startDesignMdGeneration,
} from "@/lib/actions/design-md/action";
import { resolveProjectSiteIcon } from "@/lib/actions/project/action";

// The real generation hook and storage between the wizard and the project
// page; only the server actions are mocked.

vi.mock("@/lib/actions/design-md/action", () => ({
  finalizeDesignMdGeneration: vi.fn(),
  pollDesignMdGeneration: vi.fn(),
  saveDesignMdUpload: vi.fn(),
  startDesignMdGeneration: vi.fn(),
}));

vi.mock("@/lib/actions/project/action", () => ({
  removeProjectDesignMd: vi.fn(),
  resolveProjectSiteIcon: vi.fn().mockResolvedValue({
    ok: true,
    value: { url: null },
  }),
  updateProject: vi.fn(),
}));

const { session } = vi.hoisted(() => ({
  // The client session; `data` is null while it loads.
  session: {
    current: { data: { user: { id: "viewer-1" } } } as {
      data: { user: { id: string } } | null;
    },
  },
}));

vi.mock("@/lib/auth/auth.client", () => ({
  useSession: () => session.current,
}));

vi.mock("next-intl", () => ({
  useFormatter: () => ({ dateTime: () => "Nov 20, 2026, 11:56 PM" }),
  useTranslations: () => (key: string) => key,
}));

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

const PROJECT_ID = "project-1";
const WEBSITE = "https://bad.invalid/";
const FAILURE_KEY = `sokosumi:project-brand-failure:viewer-1:${PROJECT_ID}`;
const PENDING_KEY = `sokosumi:project-brand-job:${PROJECT_ID}`;

type PollResult = Awaited<ReturnType<typeof pollDesignMdGeneration>>;
type StartResult = Awaited<ReturnType<typeof startDesignMdGeneration>>;

const failedPoll = {
  ok: true,
  value: { status: "failed", error: "Could not resolve bad.invalid." },
} as PollResult;

function wizard() {
  return (
    <ProjectBrandSetup
      projectId={PROJECT_ID}
      projectName="Launch"
      websiteUrl={WEBSITE}
    />
  );
}

function overview() {
  return (
    <ProjectBrandProvider
      projectId={PROJECT_ID}
      initialDesignMd={null}
      websiteUrl={WEBSITE}
    >
      <ProjectBrandCard projectId={PROJECT_ID} websiteUrl={WEBSITE} />
    </ProjectBrandProvider>
  );
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("project brand generation across surfaces", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.sessionStorage.clear();
    session.current = { data: { user: { id: "viewer-1" } } };
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("shows a wizard failure on the project page without retrying", async () => {
    vi.mocked(startDesignMdGeneration).mockResolvedValue({
      ok: false,
      error: { code: "BAD_INPUT", message: "Could not resolve bad.invalid." },
    } as StartResult);

    const wizard = render(
      <ProjectBrandSetup
        projectId={PROJECT_ID}
        projectName="Launch"
        websiteUrl={WEBSITE}
      />,
    );
    await waitFor(() => expect(screen.getByText("failed")).toBeTruthy());
    wizard.unmount();

    render(overview());

    expect(await screen.findByText("brandCard.failed")).toBeInTheDocument();
    expect(
      screen.getByRole("textbox", { name: "brandCard.websiteLabel" }),
    ).toHaveAttribute("aria-invalid", "true");
    // Restored, not new: shown, not announced again.
    expect(screen.queryByRole("alert")).toBeNull();
    expect(startDesignMdGeneration).toHaveBeenCalledOnce();
  });

  it("ignores a late poll from a provider that has left, even a finished job", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    window.sessionStorage.setItem(
      PENDING_KEY,
      JSON.stringify({ jobId: "job-1", jobToken: "token-1", url: WEBSITE }),
    );
    const departedPoll = deferred<PollResult>();
    vi.mocked(pollDesignMdGeneration)
      .mockReturnValueOnce(departedPoll.promise)
      .mockResolvedValueOnce(failedPoll)
      .mockReturnValue(new Promise(() => {}));
    vi.mocked(startDesignMdGeneration).mockResolvedValue({
      ok: true,
      value: { kind: "queued", jobId: "job-2", jobToken: "token-2" },
    } as StartResult);

    // The overview resumes the job and leaves while its poll is out.
    const departed = render(overview());
    await act(async () => vi.advanceTimersByTimeAsync(3000));
    expect(pollDesignMdGeneration).toHaveBeenCalledOnce();
    departed.unmount();

    // The DESIGN.md page resumes the same job, sees it fail, and retries.
    render(overview());
    await act(async () => vi.advanceTimersByTimeAsync(3000));
    expect(await screen.findByText("brandCard.failed")).toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: "brandCard.generate" }),
    );
    await waitFor(() =>
      expect(window.sessionStorage.getItem(PENDING_KEY)).toContain("job-2"),
    );
    expect(window.sessionStorage.getItem(FAILURE_KEY)).toBeNull();

    // The departed overview's poll answers late that its job finished: it
    // must not save that older DESIGN.md over the retry.
    await act(async () =>
      departedPoll.resolve({
        ok: true,
        value: { status: "done" },
      } as PollResult),
    );

    expect(finalizeDesignMdGeneration).not.toHaveBeenCalled();
    expect(window.sessionStorage.getItem(FAILURE_KEY)).toBeNull();
    expect(window.sessionStorage.getItem(PENDING_KEY)).toContain("job-2");
    expect(screen.getByText("brandCard.generating")).toBeInTheDocument();
  });

  it("hands the project page a job the wizard's start returns after it closed", async () => {
    const start = deferred<StartResult>();
    vi.mocked(startDesignMdGeneration).mockReturnValue(start.promise);
    vi.mocked(pollDesignMdGeneration).mockReturnValue(new Promise(() => {}));

    const closed = render(wizard());
    await waitFor(() => expect(startDesignMdGeneration).toHaveBeenCalledOnce());
    closed.unmount();

    // The project page opens while the wizard's start is still out: it waits
    // for that job instead of starting its own.
    render(overview());
    expect(await screen.findByText("brandCard.notSet")).toBeInTheDocument();

    await act(async () =>
      start.resolve({
        ok: true,
        value: { kind: "queued", jobId: "job-1", jobToken: "token-1" },
      } as StartResult),
    );

    expect(await screen.findByText("brandCard.generating")).toBeInTheDocument();
    expect(window.sessionStorage.getItem(PENDING_KEY)).toContain("job-1");
    expect(startDesignMdGeneration).toHaveBeenCalledOnce();
  });

  it.each([
    ["no storage", () => true],
    ["no room for the failure", (key: string) => key === FAILURE_KEY],
  ])("keeps showing a failure it could not store (%s)", async (_, blocked) => {
    const storage = window.sessionStorage;
    vi.spyOn(window, "sessionStorage", "get").mockReturnValue({
      getItem: (key: string) => storage.getItem(key),
      removeItem: (key: string) => storage.removeItem(key),
      setItem: (key: string, value: string) => {
        if (blocked(key)) throw new Error("storage disabled");
        storage.setItem(key, value);
      },
    } as Storage);
    vi.mocked(startDesignMdGeneration).mockResolvedValue({
      ok: false,
      error: { code: "BAD_INPUT", message: "Could not resolve bad.invalid." },
    } as StartResult);

    render(overview());

    expect(await screen.findByText("brandCard.failed")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(
      screen.getByRole("textbox", { name: "brandCard.websiteLabel" }),
    ).toHaveAttribute("aria-invalid", "true");
    expect(startDesignMdGeneration).toHaveBeenCalledOnce();
    expect(storage.getItem(FAILURE_KEY)).toBeNull();
  });

  it("resolves the site icon at once, while DESIGN.md waits for the viewer", async () => {
    session.current = { data: null };
    vi.mocked(startDesignMdGeneration).mockReturnValue(new Promise(() => {}));

    // The owner may open the project before the session loads: the icon
    // must already be on its way.
    const setup = render(wizard());
    await act(async () => {});
    expect(resolveProjectSiteIcon).toHaveBeenCalledOnce();
    expect(startDesignMdGeneration).not.toHaveBeenCalled();

    session.current = { data: { user: { id: "viewer-1" } } };
    setup.rerender(wizard());
    await waitFor(() => expect(startDesignMdGeneration).toHaveBeenCalledOnce());
    expect(resolveProjectSiteIcon).toHaveBeenCalledOnce();
  });

  it("starts and resumes only once the viewer is known, so a failure is kept", async () => {
    session.current = { data: null };
    vi.mocked(startDesignMdGeneration).mockResolvedValue({
      ok: false,
      error: { code: "BAD_INPUT", message: "Could not resolve bad.invalid." },
    } as StartResult);

    const setup = render(wizard());
    await act(async () => {});
    expect(startDesignMdGeneration).not.toHaveBeenCalled();

    session.current = { data: { user: { id: "viewer-1" } } };
    setup.rerender(wizard());
    await waitFor(() =>
      expect(window.sessionStorage.getItem(FAILURE_KEY)).toContain(
        "bad.invalid",
      ),
    );
    setup.unmount();

    // The project page resumes a pending job only with a viewer too.
    window.sessionStorage.setItem(
      PENDING_KEY,
      JSON.stringify({ jobId: "job-2", jobToken: "token-2", url: WEBSITE }),
    );
    vi.mocked(pollDesignMdGeneration).mockReturnValue(new Promise(() => {}));
    session.current = { data: null };
    const page = render(overview());
    await act(async () => {});
    expect(screen.queryByText("brandCard.generating")).toBeNull();

    session.current = { data: { user: { id: "viewer-1" } } };
    page.rerender(overview());
    expect(await screen.findByText("brandCard.generating")).toBeInTheDocument();
  });

  it("starts icon lookup and DESIGN.md generation only once under StrictMode", async () => {
    vi.mocked(startDesignMdGeneration).mockReturnValue(new Promise(() => {}));

    render(<StrictMode>{wizard()}</StrictMode>);

    await waitFor(() => {
      expect(resolveProjectSiteIcon).toHaveBeenCalledOnce();
      expect(startDesignMdGeneration).toHaveBeenCalledOnce();
    });
  });

  it("renders the fallback avatar while DESIGN.md start is still pending in a serial action queue", async () => {
    const order: string[] = [];
    let tail: Promise<unknown> = Promise.resolve();
    function enqueue<T>(run: () => Promise<T>): Promise<T> {
      const next = tail.then(run, run);
      tail = next.catch(() => {});
      return next;
    }

    const designStart = deferred<StartResult>();
    vi.mocked(resolveProjectSiteIcon).mockImplementation(() => {
      order.push("resolveProjectSiteIcon");
      return enqueue(() => Promise.resolve({ ok: true, value: { url: null } }));
    });
    vi.mocked(startDesignMdGeneration).mockImplementation(() => {
      order.push("startDesignMdGeneration");
      return enqueue(() => designStart.promise);
    });

    render(wizard());

    // Icon lookup ran first in the serial queue, so the fallback avatar ("L")
    // appears even though DESIGN.md start is still pending.
    expect(await screen.findByText("L")).toBeInTheDocument();
    expect(screen.getByText("fetching")).toBeInTheDocument();
    expect(order).toEqual([
      "resolveProjectSiteIcon",
      "startDesignMdGeneration",
    ]);
  });
});
