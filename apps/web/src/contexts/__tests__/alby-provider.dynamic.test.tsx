import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockAblyProvider = vi.fn(
  ({ children }: { children: React.ReactNode }) => (
    <div data-testid="ably-provider">{children}</div>
  ),
);

vi.mock("@/contexts/ably-provider", () => ({
  __esModule: true,
  default: (props: { children: React.ReactNode }) => mockAblyProvider(props),
}));

describe("DynamicAblyProvider", () => {
  beforeEach(() => {
    mockAblyProvider.mockClear();
    vi.resetModules();
  });

  it("does not mount children until AblyProvider is loaded", async () => {
    const { default: DynamicAblyProvider } = await import(
      "@/contexts/alby-provider.dynamic"
    );

    render(
      <DynamicAblyProvider>
        <span>realtime-child</span>
      </DynamicAblyProvider>,
    );

    expect(screen.queryByText("realtime-child")).not.toBeInTheDocument();
    expect(screen.queryByTestId("ably-provider")).not.toBeInTheDocument();

    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.getByTestId("ably-provider")).toBeInTheDocument();
    expect(screen.getByText("realtime-child")).toBeInTheDocument();
  });
});
