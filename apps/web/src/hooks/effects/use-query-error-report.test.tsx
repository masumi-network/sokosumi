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
        queryKeyHash='["acme","invite-links"]'
        error={null}
        errorUpdateCount={0}
        onError={onError}
      />,
    );

    expect(onError).not.toHaveBeenCalled();

    view.rerender(
      <Harness
        queryKeyHash='["acme","invite-links"]'
        error={firstError}
        errorUpdateCount={1}
        onError={onError}
      />,
    );
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenLastCalledWith(firstError);

    view.rerender(
      <Harness
        queryKeyHash='["acme","invite-links"]'
        error={firstError}
        errorUpdateCount={1}
        onError={onError}
      />,
    );
    expect(onError).toHaveBeenCalledTimes(1);

    view.rerender(
      <Harness
        queryKeyHash='["acme","invite-links"]'
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
        queryKeyHash='["acme","invite-links"]'
        error={staleError}
        errorUpdateCount={1}
        onError={onError}
      />,
    );

    expect(onError).not.toHaveBeenCalled();

    view.rerender(
      <Harness
        queryKeyHash='["beta","invite-links"]'
        error={staleError}
        errorUpdateCount={3}
        onError={onError}
      />,
    );

    expect(onError).not.toHaveBeenCalled();
  });
});
