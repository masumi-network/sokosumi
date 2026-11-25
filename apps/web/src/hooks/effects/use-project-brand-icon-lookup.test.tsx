import { expectConsole } from "@sokosumi/utils/test-console";
import { render, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  resolveProjectSiteIcon,
  updateProject,
} from "@/lib/actions/project/action";
import { useProjectBrandIconLookup } from "./use-project-brand-icon-lookup";

const { toastErrorMock } = vi.hoisted(() => ({ toastErrorMock: vi.fn() }));

vi.mock("@/lib/actions/project/action", () => ({
  resolveProjectSiteIcon: vi.fn(),
  updateProject: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: { error: toastErrorMock },
}));

describe("useProjectBrandIconLookup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(resolveProjectSiteIcon).mockResolvedValue({
      ok: true,
      value: { url: "https://blob.example/logo.png" },
    });
    vi.mocked(updateProject).mockResolvedValue({
      ok: true,
      value: { projectId: "project-1" },
    });
  });

  it("resolves the icon once under StrictMode, updates the project, and notifies callbacks", async () => {
    const onReadyLogo = vi.fn();
    const onBrandChange = vi.fn();
    let snapshot: { logoUrl: string | null; isResolvingLogo: boolean } = {
      logoUrl: null,
      isResolvingLogo: true,
    };

    function Probe({ tick: _tick }: { tick?: number }) {
      snapshot = useProjectBrandIconLookup({
        projectId: "project-1",
        projectName: "Launch",
        websiteUrl: "https://acme.com",
        logoFailedMessage: "logoFailed",
        onReadyLogo,
        onBrandChange,
      });
      return null;
    }

    const { rerender } = render(
      <StrictMode>
        <Probe tick={0} />
      </StrictMode>,
    );

    await waitFor(() => {
      expect(snapshot.isResolvingLogo).toBe(false);
    });

    expect(resolveProjectSiteIcon).toHaveBeenCalledOnce();
    expect(resolveProjectSiteIcon).toHaveBeenCalledWith({
      url: "https://acme.com",
      projectId: "project-1",
    });
    expect(updateProject).toHaveBeenCalledOnce();
    expect(updateProject).toHaveBeenCalledWith({
      projectId: "project-1",
      name: "Launch",
      logo: "https://blob.example/logo.png",
    });
    expect(snapshot.logoUrl).toBe("https://blob.example/logo.png");
    expect(onReadyLogo).toHaveBeenCalledWith("https://blob.example/logo.png");
    expect(onBrandChange).toHaveBeenCalledWith({
      logo: "https://blob.example/logo.png",
    });
    expect(toastErrorMock).not.toHaveBeenCalled();

    rerender(
      <StrictMode>
        <Probe tick={1} />
      </StrictMode>,
    );
    expect(resolveProjectSiteIcon).toHaveBeenCalledOnce();
  });

  it("skips updateProject when no logo is found", async () => {
    vi.mocked(resolveProjectSiteIcon).mockResolvedValue({
      ok: true,
      value: { url: null },
    });
    const onReadyLogo = vi.fn();
    const onBrandChange = vi.fn();
    let snapshot: { logoUrl: string | null; isResolvingLogo: boolean } = {
      logoUrl: null,
      isResolvingLogo: true,
    };

    function Probe() {
      snapshot = useProjectBrandIconLookup({
        projectId: "project-1",
        projectName: "Launch",
        websiteUrl: "https://acme.com",
        logoFailedMessage: "logoFailed",
        onReadyLogo,
        onBrandChange,
      });
      return null;
    }

    render(<Probe />);

    await waitFor(() => {
      expect(snapshot.isResolvingLogo).toBe(false);
    });

    expect(snapshot.logoUrl).toBeNull();
    expect(onReadyLogo).toHaveBeenCalledWith(null);
    expect(onBrandChange).toHaveBeenCalledWith({ logo: null });
    expect(updateProject).not.toHaveBeenCalled();
    expect(toastErrorMock).not.toHaveBeenCalled();
  });

  it("toasts on updateProject failure or lookup rejection and clears loading state", async () => {
    vi.mocked(updateProject).mockResolvedValue({
      ok: false,
      error: { kind: "identifier_invalid" },
    });

    let firstSnapshot = { isResolvingLogo: true };
    function UpdateFailProbe() {
      firstSnapshot = useProjectBrandIconLookup({
        projectId: "project-1",
        projectName: "Launch",
        websiteUrl: "https://acme.com",
        logoFailedMessage: "logoFailed",
      });
      return null;
    }

    render(<UpdateFailProbe />);
    await waitFor(() => {
      expect(firstSnapshot.isResolvingLogo).toBe(false);
    });
    expect(toastErrorMock).toHaveBeenCalledWith("logoFailed");

    toastErrorMock.mockClear();
    expectConsole("error", "Failed to resolve project logo");
    vi.mocked(resolveProjectSiteIcon).mockRejectedValue(new Error("network"));

    let secondSnapshot = { isResolvingLogo: true };
    function RejectProbe() {
      secondSnapshot = useProjectBrandIconLookup({
        projectId: "project-2",
        projectName: "Launch",
        websiteUrl: "https://acme.com",
        logoFailedMessage: "logoFailed",
      });
      return null;
    }

    render(<RejectProbe />);
    await waitFor(() => {
      expect(secondSnapshot.isResolvingLogo).toBe(false);
    });
    expect(toastErrorMock).toHaveBeenCalledWith("logoFailed");
  });
});
