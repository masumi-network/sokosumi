import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useTalkingVideoHistoryCancel } from "./use-talking-video-history-cancel";

describe("useTalkingVideoHistoryCancel", () => {
  it("cancels exact historyKey queries when not searching and stays silent while searching", () => {
    const cancelQueries = vi.fn(async () => {});
    const queryClient = { cancelQueries };
    const keyA = ["talking-video-history", "proj-1", "v-1"] as const;
    const keyB = ["talking-video-history", "proj-1", "v-2"] as const;

    function Probe({
      searching,
      historyKey,
    }: {
      searching: boolean;
      historyKey: readonly unknown[];
    }) {
      useTalkingVideoHistoryCancel({ searching, queryClient, historyKey });
      return null;
    }

    const { rerender, unmount } = render(
      <Probe searching={true} historyKey={keyA} />,
    );
    expect(cancelQueries).not.toHaveBeenCalled();

    rerender(<Probe searching={false} historyKey={keyA} />);
    expect(cancelQueries).toHaveBeenCalledTimes(1);
    expect(cancelQueries).toHaveBeenCalledWith({
      queryKey: keyA,
      exact: true,
    });

    rerender(<Probe searching={false} historyKey={keyB} />);
    expect(cancelQueries).toHaveBeenCalledTimes(2);
    expect(cancelQueries).toHaveBeenLastCalledWith({
      queryKey: keyB,
      exact: true,
    });

    unmount();
  });
});
