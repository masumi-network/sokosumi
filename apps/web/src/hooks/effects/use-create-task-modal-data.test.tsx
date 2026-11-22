import { act, render, waitFor } from "@testing-library/react";
import { Activity, StrictMode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { loadCreateTaskModalDataMock, toastErrorMock } = vi.hoisted(() => ({
  loadCreateTaskModalDataMock: vi.fn(),
  toastErrorMock: vi.fn(),
}));

vi.mock("@/app/tasks/actions", () => ({
  loadCreateTaskModalData: loadCreateTaskModalDataMock,
}));

vi.mock("sonner", () => ({
  toast: { error: toastErrorMock },
}));

import { useCreateTaskModalData } from "./use-create-task-modal-data";

const SAMPLE_DATA = {
  agentNameById: { "agent-1": "Agent One" },
  designMdAttachment: null,
  projectOptions: [{ id: "project-1", name: "Sokosumi" }],
};

describe("useCreateTaskModalData", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("loads once when opened without owned data and skips when owned, loading options, or closed", async () => {
    loadCreateTaskModalDataMock.mockResolvedValue(SAMPLE_DATA);
    const tErrors = vi.fn(() => "Failed to load");
    const captured: {
      latest: ReturnType<typeof useCreateTaskModalData>;
    } = { latest: null };

    function Probe({
      ownsCreateData,
      isLoadingOptions,
      open,
      initialCreateTaskOpen,
      tTasksErrors,
    }: {
      ownsCreateData: boolean;
      isLoadingOptions: boolean;
      open: boolean;
      initialCreateTaskOpen: boolean;
      tTasksErrors: (key: "loadCreateTask") => string;
    }) {
      captured.latest = useCreateTaskModalData({
        ownsCreateData,
        isLoadingOptions,
        open,
        initialCreateTaskOpen,
        tTasksErrors,
      });
      return null;
    }

    const { rerender, unmount } = render(
      <Probe
        ownsCreateData={true}
        isLoadingOptions={false}
        open={true}
        initialCreateTaskOpen={false}
        tTasksErrors={tErrors}
      />,
    );
    expect(loadCreateTaskModalDataMock).not.toHaveBeenCalled();

    rerender(
      <Probe
        ownsCreateData={false}
        isLoadingOptions={true}
        open={true}
        initialCreateTaskOpen={false}
        tTasksErrors={tErrors}
      />,
    );
    expect(loadCreateTaskModalDataMock).not.toHaveBeenCalled();

    rerender(
      <Probe
        ownsCreateData={false}
        isLoadingOptions={false}
        open={false}
        initialCreateTaskOpen={false}
        tTasksErrors={tErrors}
      />,
    );
    expect(loadCreateTaskModalDataMock).not.toHaveBeenCalled();

    rerender(
      <Probe
        ownsCreateData={false}
        isLoadingOptions={false}
        open={true}
        initialCreateTaskOpen={false}
        tTasksErrors={tErrors}
      />,
    );
    await waitFor(() =>
      expect(captured.latest?.agentNameById.get("agent-1")).toBe("Agent One"),
    );
    expect(captured.latest?.projectOptions).toEqual(SAMPLE_DATA.projectOptions);
    expect(loadCreateTaskModalDataMock).toHaveBeenCalledTimes(1);

    // Once loaded, closing and reopening does not refetch.
    rerender(
      <Probe
        ownsCreateData={false}
        isLoadingOptions={false}
        open={false}
        initialCreateTaskOpen={false}
        tTasksErrors={tErrors}
      />,
    );
    rerender(
      <Probe
        ownsCreateData={false}
        isLoadingOptions={false}
        open={true}
        initialCreateTaskOpen={false}
        tTasksErrors={tErrors}
      />,
    );
    expect(loadCreateTaskModalDataMock).toHaveBeenCalledTimes(1);

    unmount();
  });

  it("re-runs and cancels the prior in-flight load when translator identity changes even if both return the same text", async () => {
    const first = Promise.withResolvers<typeof SAMPLE_DATA>();
    const second = Promise.withResolvers<typeof SAMPLE_DATA>();
    loadCreateTaskModalDataMock
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);

    // Two distinct translator function identities returning the exact same string.
    const tFirst = vi.fn((_key: "loadCreateTask") => "Same error text");
    const tSecond = vi.fn((_key: "loadCreateTask") => "Same error text");

    function Probe({
      tTasksErrors,
    }: {
      tTasksErrors: (key: "loadCreateTask") => string;
    }) {
      useCreateTaskModalData({
        ownsCreateData: false,
        isLoadingOptions: false,
        open: true,
        initialCreateTaskOpen: false,
        tTasksErrors,
      });
      return null;
    }

    const { rerender, unmount } = render(<Probe tTasksErrors={tFirst} />);
    expect(loadCreateTaskModalDataMock).toHaveBeenCalledTimes(1);

    rerender(<Probe tTasksErrors={tSecond} />);
    expect(loadCreateTaskModalDataMock).toHaveBeenCalledTimes(2);

    // First request was cancelled when tTasksErrors identity changed, so its rejection must not toast.
    await act(async () => {
      first.reject(new Error("stale failure"));
      await first.promise.catch(() => {});
    });
    expect(toastErrorMock).not.toHaveBeenCalled();

    // Second request uses the new translator identity.
    await act(async () => {
      second.reject(new Error("active failure"));
      await second.promise.catch(() => {});
    });
    expect(tFirst).not.toHaveBeenCalled();
    expect(tSecond).toHaveBeenCalledExactlyOnceWith("loadCreateTask");
    expect(toastErrorMock).toHaveBeenCalledExactlyOnceWith("Same error text");

    unmount();
  });

  it("cancels stale requests on StrictMode replay, Activity hide, and unmount", async () => {
    const r1 = Promise.withResolvers<typeof SAMPLE_DATA>();
    const r2 = Promise.withResolvers<typeof SAMPLE_DATA>();
    const r3 = Promise.withResolvers<typeof SAMPLE_DATA>();
    const r4 = Promise.withResolvers<typeof SAMPLE_DATA>();
    loadCreateTaskModalDataMock
      .mockReturnValueOnce(r1.promise)
      .mockReturnValueOnce(r2.promise)
      .mockReturnValueOnce(r3.promise)
      .mockReturnValueOnce(r4.promise);

    const tErrors = vi.fn(() => "Load failed");
    const captured: {
      latest: ReturnType<typeof useCreateTaskModalData>;
    } = { latest: null };

    function Probe() {
      captured.latest = useCreateTaskModalData({
        ownsCreateData: false,
        isLoadingOptions: false,
        open: true,
        initialCreateTaskOpen: false,
        tTasksErrors: tErrors,
      });
      return null;
    }

    const { rerender, unmount } = render(
      <StrictMode>
        <Activity mode="visible">
          <Probe />
        </Activity>
      </StrictMode>,
    );
    expect(loadCreateTaskModalDataMock).toHaveBeenCalledTimes(2);

    // StrictMode replay cancelled r1; rejecting it must not toast.
    await act(async () => {
      r1.reject(new Error("strict-1"));
      await r1.promise.catch(() => {});
    });
    expect(toastErrorMock).not.toHaveBeenCalled();

    // Activity hide cancels r2; resolving it while hidden must not commit.
    rerender(
      <StrictMode>
        <Activity mode="hidden">
          <Probe />
        </Activity>
      </StrictMode>,
    );
    await act(async () => {
      r2.resolve(SAMPLE_DATA);
      await r2.promise;
    });
    expect(captured.latest).toBeNull();

    // Reveal starts fresh StrictMode pair r3 & r4; unmount before either settles.
    rerender(
      <StrictMode>
        <Activity mode="visible">
          <Probe />
        </Activity>
      </StrictMode>,
    );
    expect(loadCreateTaskModalDataMock).toHaveBeenCalledTimes(4);

    unmount();
    await act(async () => {
      r3.reject(new Error("unmounted-3"));
      r4.reject(new Error("unmounted-4"));
      await Promise.allSettled([r3.promise, r4.promise]);
    });
    expect(toastErrorMock).not.toHaveBeenCalled();
    expect(captured.latest).toBeNull();
  });
});
