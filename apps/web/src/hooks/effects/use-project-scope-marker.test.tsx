import { render, screen } from "@testing-library/react";
import { Activity } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  useMarkedProjectSnapshot,
  useProjectScopeMarker,
} from "./use-project-scope-marker";

function Marker({
  path,
  projectId,
}: {
  path: string | null;
  projectId: string | null;
}) {
  useProjectScopeMarker(path, projectId);
  return null;
}

function Probe() {
  const marked = useMarkedProjectSnapshot();
  return (
    <output data-testid="probe">
      {marked ? `${marked.path}:${marked.projectId ?? "null"}` : "empty"}
    </output>
  );
}

describe("useProjectScopeMarker", () => {
  it("publishes while mounted and clears on unmount unless a newer marker took over", () => {
    const { rerender } = render(
      <>
        <Marker key="old" path="/tasks/t1" projectId="p1" />
        <Probe />
      </>,
    );
    expect(screen.getByTestId("probe")).toHaveTextContent("/tasks/t1:p1");

    rerender(
      <>
        <Marker key="old" path="/tasks/t1" projectId="p1" />
        <Marker key="new" path="/tasks/t2" projectId="p2" />
        <Probe />
      </>,
    );
    rerender(
      <>
        <Marker key="new" path="/tasks/t2" projectId="p2" />
        <Probe />
      </>,
    );
    expect(screen.getByTestId("probe")).toHaveTextContent("/tasks/t2:p2");

    rerender(<Probe />);
    expect(screen.getByTestId("probe")).toHaveTextContent("empty");
  });

  it("clears on React Activity hide and restores on reveal", () => {
    const { rerender } = render(
      <>
        <Activity mode="visible">
          <Marker path="/tasks/t3" projectId="p3" />
        </Activity>
        <Probe />
      </>,
    );
    expect(screen.getByTestId("probe")).toHaveTextContent("/tasks/t3:p3");

    rerender(
      <>
        <Activity mode="hidden">
          <Marker path="/tasks/t3" projectId="p3" />
        </Activity>
        <Probe />
      </>,
    );
    expect(screen.getByTestId("probe")).toHaveTextContent("empty");

    rerender(
      <>
        <Activity mode="visible">
          <Marker path="/tasks/t3" projectId="p3" />
        </Activity>
        <Probe />
      </>,
    );
    expect(screen.getByTestId("probe")).toHaveTextContent("/tasks/t3:p3");
  });

  it("returns null for the SSR server snapshot", () => {
    const html = renderToString(<Probe />);
    expect(html).toContain("empty");
  });
});
