import { expectConsole } from "@sokosumi/utils/test-console";
import { act, render, screen } from "@testing-library/react";
import { Activity, Component, type ReactNode } from "react";
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

interface TestErrorBoundaryProps {
  children: ReactNode;
}

interface TestErrorBoundaryState {
  error: Error | null;
}

class TestErrorBoundary extends Component<
  TestErrorBoundaryProps,
  TestErrorBoundaryState
> {
  state: TestErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): TestErrorBoundaryState {
    return { error };
  }

  render(): ReactNode {
    if (this.state.error) {
      return <div role="alert">{this.state.error.message}</div>;
    }
    return this.props.children;
  }
}

describe("LazyAblyProvider", () => {
  beforeEach(() => {
    mockAblyProvider.mockClear();
    vi.resetModules();
  });

  it("does not mount children until AblyProvider is loaded", async () => {
    const { default: LazyAblyProvider } = await import(
      "@/contexts/lazy-ably-provider"
    );

    render(
      <LazyAblyProvider>
        <span>realtime-child</span>
      </LazyAblyProvider>,
    );

    expect(screen.queryByText("realtime-child")).not.toBeInTheDocument();
    expect(screen.queryByTestId("ably-provider")).not.toBeInTheDocument();

    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.getByTestId("ably-provider")).toBeInTheDocument();
    expect(screen.getByText("realtime-child")).toBeInTheDocument();
  });

  it("propagates a rejected AblyProvider import to the nearest error boundary", async () => {
    vi.doMock("@/contexts/ably-provider", () => {
      throw new Error("chunk load failed");
    });

    const { default: LazyAblyProvider } = await import(
      "@/contexts/lazy-ably-provider"
    );

    const reactErrors = expectConsole("error", "");

    render(
      <TestErrorBoundary>
        <LazyAblyProvider>
          <span>realtime-child</span>
        </LazyAblyProvider>
      </TestErrorBoundary>,
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Failed to load Ably provider",
    );
    expect(reactErrors[0]?.[1]).toBeInstanceOf(Error);
    expect(reactErrors[0]?.[1]).toHaveProperty(
      "message",
      "Failed to load Ably provider",
    );
    expect(screen.queryByText("realtime-child")).not.toBeInTheDocument();
  });

  it("ignores a settled AblyProvider import after unmount", async () => {
    let releaseImport!: () => void;
    const importGate = new Promise<void>((resolve) => {
      releaseImport = resolve;
    });

    vi.doMock("@/contexts/ably-provider", async () => {
      await importGate;
      return {
        __esModule: true,
        default: mockAblyProvider,
      };
    });

    const { default: LazyAblyProvider } = await import(
      "@/contexts/lazy-ably-provider"
    );

    const { unmount } = render(
      <LazyAblyProvider>
        <span>realtime-child</span>
      </LazyAblyProvider>,
    );

    expect(screen.queryByText("realtime-child")).not.toBeInTheDocument();
    expect(screen.queryByTestId("ably-provider")).not.toBeInTheDocument();

    unmount();

    await act(async () => {
      releaseImport();
      await Promise.resolve();
    });

    expect(mockAblyProvider).not.toHaveBeenCalled();
    expect(screen.queryByText("realtime-child")).not.toBeInTheDocument();
    expect(screen.queryByTestId("ably-provider")).not.toBeInTheDocument();
  });

  it("reads the loaded provider immediately when revealed from React Activity", async () => {
    let releaseImport!: () => void;
    const importGate = new Promise<void>((resolve) => {
      releaseImport = resolve;
    });

    vi.doMock("@/contexts/ably-provider", async () => {
      await importGate;
      return {
        __esModule: true,
        default: mockAblyProvider,
      };
    });

    const { default: LazyAblyProvider } = await import(
      "@/contexts/lazy-ably-provider"
    );

    const { rerender } = render(
      <Activity mode="visible">
        <LazyAblyProvider>
          <span>realtime-child</span>
        </LazyAblyProvider>
      </Activity>,
    );

    rerender(
      <Activity mode="hidden">
        <LazyAblyProvider>
          <span>realtime-child</span>
        </LazyAblyProvider>
      </Activity>,
    );

    await act(async () => {
      releaseImport();
      await Promise.resolve();
    });

    rerender(
      <Activity mode="visible">
        <LazyAblyProvider>
          <span>realtime-child</span>
        </LazyAblyProvider>
      </Activity>,
    );

    expect(screen.getByTestId("ably-provider")).toBeInTheDocument();
    expect(screen.getByText("realtime-child")).toBeInTheDocument();
  });

  it("retries loading on a later mount if a chunk fails after the last island unmounted", async () => {
    let rejectFirstImport!: (reason?: unknown) => void;
    const firstImportGate = new Promise<void>((_, reject) => {
      rejectFirstImport = reject;
    });
    let attempts = 0;

    vi.doMock("@/contexts/ably-provider", async () => {
      attempts += 1;
      if (attempts === 1) {
        await firstImportGate;
      }
      return {
        __esModule: true,
        default: mockAblyProvider,
      };
    });

    const { default: LazyAblyProvider } = await import(
      "@/contexts/lazy-ably-provider"
    );

    const { unmount } = render(
      <TestErrorBoundary>
        <LazyAblyProvider>
          <span>realtime-child</span>
        </LazyAblyProvider>
      </TestErrorBoundary>,
    );

    unmount();

    await act(async () => {
      rejectFirstImport(new Error("transient chunk failure"));
      await Promise.resolve();
    });

    render(
      <TestErrorBoundary>
        <LazyAblyProvider>
          <span>realtime-child</span>
        </LazyAblyProvider>
      </TestErrorBoundary>,
    );

    expect(await screen.findByTestId("ably-provider")).toBeInTheDocument();
    expect(screen.getByText("realtime-child")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(attempts).toBe(2);
  });

  it("retries without surfacing an error when revealed from React Activity after an in-flight load failed while hidden", async () => {
    let rejectFirstImport!: (reason?: unknown) => void;
    const firstImportGate = new Promise<void>((_, reject) => {
      rejectFirstImport = reject;
    });
    let attempts = 0;

    vi.doMock("@/contexts/ably-provider", async () => {
      attempts += 1;
      if (attempts === 1) {
        await firstImportGate;
      }
      return {
        __esModule: true,
        default: mockAblyProvider,
      };
    });

    const { default: LazyAblyProvider } = await import(
      "@/contexts/lazy-ably-provider"
    );

    const { rerender } = render(
      <TestErrorBoundary>
        <Activity mode="visible">
          <LazyAblyProvider>
            <span>realtime-child</span>
          </LazyAblyProvider>
        </Activity>
      </TestErrorBoundary>,
    );

    rerender(
      <TestErrorBoundary>
        <Activity mode="hidden">
          <LazyAblyProvider>
            <span>realtime-child</span>
          </LazyAblyProvider>
        </Activity>
      </TestErrorBoundary>,
    );

    await act(async () => {
      rejectFirstImport(new Error("transient chunk failure"));
      await Promise.resolve();
    });

    rerender(
      <TestErrorBoundary>
        <Activity mode="visible">
          <LazyAblyProvider>
            <span>realtime-child</span>
          </LazyAblyProvider>
        </Activity>
      </TestErrorBoundary>,
    );

    expect(await screen.findByTestId("ably-provider")).toBeInTheDocument();
    expect(screen.getByText("realtime-child")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(attempts).toBe(2);
  });
});
