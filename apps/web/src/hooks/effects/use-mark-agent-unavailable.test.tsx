import { render, screen } from "@testing-library/react";
import { Activity } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  useIsAgentUnavailable,
  useMarkAgentUnavailable,
} from "./use-mark-agent-unavailable";

function Marker({ agentId }: { agentId: string }) {
  useMarkAgentUnavailable(agentId);
  return null;
}

function Probe({ agentId }: { agentId: string | null }) {
  return (
    <output data-testid="probe">
      {String(useIsAgentUnavailable(agentId))}
    </output>
  );
}

describe("useMarkAgentUnavailable", () => {
  it("marks an agent unavailable while mounted and clears on unmount", () => {
    const { rerender } = render(
      <>
        <Marker agentId="agent-1" />
        <Probe agentId="agent-1" />
      </>,
    );

    expect(screen.getByTestId("probe")).toHaveTextContent("true");

    rerender(<Probe agentId="agent-1" />);
    expect(screen.getByTestId("probe")).toHaveTextContent("false");
  });

  it("keeps an agent marked while another overlapping marker is still mounted", () => {
    const { rerender } = render(
      <>
        <Marker key="old" agentId="agent-overlap" />
        <Marker key="new" agentId="agent-overlap" />
        <Probe agentId="agent-overlap" />
      </>,
    );

    expect(screen.getByTestId("probe")).toHaveTextContent("true");

    rerender(
      <>
        <Marker key="new" agentId="agent-overlap" />
        <Probe agentId="agent-overlap" />
      </>,
    );
    expect(screen.getByTestId("probe")).toHaveTextContent("true");

    rerender(<Probe agentId="agent-overlap" />);
    expect(screen.getByTestId("probe")).toHaveTextContent("false");
  });

  it("clears on React Activity hide and restores on reveal", () => {
    const { rerender } = render(
      <>
        <Activity mode="visible">
          <Marker agentId="agent-activity" />
        </Activity>
        <Probe agentId="agent-activity" />
      </>,
    );

    expect(screen.getByTestId("probe")).toHaveTextContent("true");

    rerender(
      <>
        <Activity mode="hidden">
          <Marker agentId="agent-activity" />
        </Activity>
        <Probe agentId="agent-activity" />
      </>,
    );
    expect(screen.getByTestId("probe")).toHaveTextContent("false");

    rerender(
      <>
        <Activity mode="visible">
          <Marker agentId="agent-activity" />
        </Activity>
        <Probe agentId="agent-activity" />
      </>,
    );
    expect(screen.getByTestId("probe")).toHaveTextContent("true");
  });

  it("returns false for the SSR server snapshot", () => {
    const html = renderToString(<Probe agentId="agent-ssr" />);
    expect(html).toContain("false");
  });
});
