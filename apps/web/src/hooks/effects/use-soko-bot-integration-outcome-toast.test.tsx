import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { toastSuccessMock, toastErrorMock } = vi.hoisted(() => ({
  toastSuccessMock: vi.fn(),
  toastErrorMock: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: {
    success: toastSuccessMock,
    error: toastErrorMock,
  },
}));

import { useSokoBotIntegrationOutcomeToast } from "./use-soko-bot-integration-outcome-toast";

describe("useSokoBotIntegrationOutcomeToast", () => {
  beforeEach(() => {
    toastSuccessMock.mockReset();
    toastErrorMock.mockReset();
  });

  it("toasts success or error according to outcome, replaces the route, and reacts to translator identity", () => {
    const replace = vi.fn();
    const router = { replace };
    const tA = vi.fn((key: string) => key);
    const tB = vi.fn((key: string) => key);

    function Probe({
      outcome,
      t,
    }: {
      outcome: string | null;
      t: (
        key: "Integrations.connected" | "Integrations.connectFailed",
      ) => string;
    }) {
      useSokoBotIntegrationOutcomeToast({
        integrationOutcome: outcome,
        router,
        t,
        consoleRoute: "/personal-assistant/console",
      });
      return null;
    }

    const { rerender, unmount } = render(<Probe outcome={null} t={tA} />);
    expect(toastSuccessMock).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();

    rerender(<Probe outcome="active" t={tA} />);
    expect(toastSuccessMock).toHaveBeenCalledWith("Integrations.connected");
    expect(replace).toHaveBeenCalledWith("/personal-assistant/console");

    rerender(<Probe outcome="failed" t={tA} />);
    expect(toastErrorMock).toHaveBeenCalledWith("Integrations.connectFailed");
    expect(replace).toHaveBeenCalledTimes(2);

    rerender(<Probe outcome="failed" t={tB} />);
    expect(tB).toHaveBeenCalledWith("Integrations.connectFailed");
    expect(replace).toHaveBeenCalledTimes(3);

    unmount();
  });
});
