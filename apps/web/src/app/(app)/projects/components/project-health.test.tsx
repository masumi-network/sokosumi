import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ProjectHealthSection } from "@/app/projects/components/project-health";
import { setProjectHealth } from "@/lib/actions/project/action";

vi.mock("@/lib/actions/project/action", () => ({
  setProjectHealth: vi.fn(),
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, string>) =>
    values?.name ? `${key}:${values.name}` : key,
}));

vi.mock("@/components/time-ago", () => ({
  TimeAgo: () => <span>time-ago</span>,
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

const PROJECT_ID = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";

const AT_RISK = {
  status: "AT_RISK" as const,
  note: "Waiting on the client",
  setAt: new Date("2026-11-14T09:00:00.000Z"),
  setByName: "Ana",
};

describe("ProjectHealthSection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows the verdict, its note, and who set it", () => {
    render(<ProjectHealthSection projectId={PROJECT_ID} health={AT_RISK} />);

    expect(screen.getByTestId("project-health-badge")).toHaveTextContent(
      "status.AT_RISK",
    );
    expect(screen.getByText("Waiting on the client")).toBeInTheDocument();
    expect(screen.getByText(/setBy:Ana/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "change" })).toBeInTheDocument();
  });

  it("sets health with a note from the empty state", async () => {
    vi.mocked(setProjectHealth).mockResolvedValue({
      ok: true,
      value: { health: { ...AT_RISK, status: "ON_TRACK", note: "Shipping" } },
    });
    render(<ProjectHealthSection projectId={PROJECT_ID} health={null} />);
    expect(screen.getByText("empty")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "set" }));
    expect(screen.getByRole("button", { name: "save" })).toBeDisabled();
    fireEvent.click(screen.getByRole("radio", { name: "status.ON_TRACK" }));
    fireEvent.change(screen.getByRole("textbox", { name: "noteLabel" }), {
      target: { value: "Shipping" },
    });
    fireEvent.click(screen.getByRole("button", { name: "save" }));

    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith("saved");
    });
    expect(setProjectHealth).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      status: "ON_TRACK",
      note: "Shipping",
    });
    expect(screen.getByTestId("project-health-badge")).toHaveTextContent(
      "status.ON_TRACK",
    );
  });

  it("clears health", async () => {
    vi.mocked(setProjectHealth).mockResolvedValue({
      ok: true,
      value: { health: null },
    });
    render(<ProjectHealthSection projectId={PROJECT_ID} health={AT_RISK} />);

    fireEvent.click(screen.getByRole("button", { name: "change" }));
    fireEvent.click(screen.getByRole("button", { name: "clear" }));

    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith("cleared");
    });
    expect(setProjectHealth).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: PROJECT_ID, status: null }),
    );
    expect(screen.getByText("empty")).toBeInTheDocument();
  });

  it("reports a failed save and keeps the old verdict", async () => {
    vi.mocked(setProjectHealth).mockResolvedValue({
      ok: false,
      error: { code: "INTERNAL_SERVER_ERROR" } as never,
    });
    render(<ProjectHealthSection projectId={PROJECT_ID} health={AT_RISK} />);

    fireEvent.click(screen.getByRole("button", { name: "change" }));
    fireEvent.click(screen.getByRole("radio", { name: "status.OFF_TRACK" }));
    fireEvent.click(screen.getByRole("button", { name: "save" }));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith("saveFailed");
    });
    expect(screen.getAllByTestId("project-health-badge")[0]).toHaveTextContent(
      "status.AT_RISK",
    );
  });

  it("shows but does not offer a change when read-only", () => {
    render(
      <ProjectHealthSection projectId={PROJECT_ID} health={AT_RISK} readOnly />,
    );

    expect(screen.getByTestId("project-health-badge")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
