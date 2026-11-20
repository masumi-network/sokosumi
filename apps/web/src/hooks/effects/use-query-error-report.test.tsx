import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useQueryErrorReport } from "./use-query-error-report";

interface HarnessProps {
  queryKeyHash: string;
  error: Error | null;
  errorUpdateCount: number;
  onError?: (error: Error) => void;
}

function Harness({
  queryKeyHash,
  error,
  errorUpdateCount,
  onError,
}: HarnessProps) {
  useQueryErrorReport(queryKeyHash, error, errorUpdateCount, onError);
  return null;
}

describe("useQueryErrorReport", () => {
  it("reports each new failure once for the active key and ignores unrelated rerenders", () => {
    const onError = vi.fn();
    const firstError = new Error("first");
    const secondError = new Error("second");

    const view = render(
      <Harness
        queryKeyHash='["org-a","user-a","items"]'
        error={null}
        errorUpdateCount={0}
        onError={onError}
      />,
    );

    expect(onError).not.toHaveBeenCalled();

    view.rerender(
      <Harness
        queryKeyHash='["org-a","user-a","items"]'
        error={firstError}
        errorUpdateCount={1}
        onError={onError}
      />,
    );
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenLastCalledWith(firstError);

    // Same failure on a subsequent render must not toast again.
    view.rerender(
      <Harness
        queryKeyHash='["org-a","user-a","items"]'
        error={firstError}
        errorUpdateCount={1}
        onError={onError}
      />,
    );
    expect(onError).toHaveBeenCalledTimes(1);

    // A fresh retry failure reports again.
    view.rerender(
      <Harness
        queryKeyHash='["org-a","user-a","items"]'
        error={secondError}
        errorUpdateCount={2}
        onError={onError}
      />,
    );
    expect(onError).toHaveBeenCalledTimes(2);
    expect(onError).toHaveBeenLastCalledWith(secondError);
  });

  it("does not replay an already-cached error when mounting or switching keys", () => {
    const onError = vi.fn();
    const staleError = new Error("already-failed");

    const view = render(
      <Harness
        queryKeyHash='["org-a","user-a","items"]'
        error={staleError}
        errorUpdateCount={1}
        onError={onError}
      />,
    );

    expect(onError).not.toHaveBeenCalled();

    view.rerender(
      <Harness
        queryKeyHash='["org-b","user-a","items"]'
        error={staleError}
        errorUpdateCount={3}
        onError={onError}
      />,
    );

    expect(onError).not.toHaveBeenCalled();
  });
});
