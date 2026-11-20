import { render, renderHook } from "@testing-library/react";
import { Activity } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { useBodyDataset } from "./use-body-dataset";

function DatasetMarker({
  datasetKey,
  value,
}: {
  datasetKey: string;
  value: string | null | undefined;
}) {
  useBodyDataset(datasetKey, value);
  return null;
}

describe("useBodyDataset", () => {
  afterEach(() => {
    delete document.body.dataset.agentFullbleed;
    delete document.body.dataset.sokoBotCreating;
  });

  it("sets document.body.dataset on mount and clears it on unmount", () => {
    expect(document.body.dataset.agentFullbleed).toBeUndefined();

    const { unmount } = renderHook(() =>
      useBodyDataset("agentFullbleed", "true"),
    );

    expect(document.body.dataset.agentFullbleed).toBe("true");
    expect(document.body.getAttribute("data-agent-fullbleed")).toBe("true");

    unmount();

    expect(document.body.dataset.agentFullbleed).toBeUndefined();
    expect(document.body.hasAttribute("data-agent-fullbleed")).toBe(false);
  });

  it("does not set an attribute when value is nullish and clears previous values on change", () => {
    const { rerender } = renderHook(
      ({
        keyName,
        value,
      }: {
        keyName: string;
        value: string | null | undefined;
      }) => useBodyDataset(keyName, value),
      {
        initialProps: {
          keyName: "agentFullbleed",
          value: null as string | null | undefined,
        },
      },
    );

    expect(document.body.hasAttribute("data-agent-fullbleed")).toBe(false);

    rerender({ keyName: "agentFullbleed", value: "true" });
    expect(document.body.dataset.agentFullbleed).toBe("true");

    rerender({ keyName: "sokoBotCreating", value: "true" });
    expect(document.body.dataset.agentFullbleed).toBeUndefined();
    expect(document.body.dataset.sokoBotCreating).toBe("true");

    rerender({ keyName: "sokoBotCreating", value: undefined });
    expect(document.body.dataset.sokoBotCreating).toBeUndefined();
  });

  it("removes the attribute when hidden under React Activity and restores it on reveal", () => {
    const { rerender } = render(
      <Activity mode="visible">
        <DatasetMarker datasetKey="sokoBotCreating" value="true" />
      </Activity>,
    );

    expect(document.body.dataset.sokoBotCreating).toBe("true");

    rerender(
      <Activity mode="hidden">
        <DatasetMarker datasetKey="sokoBotCreating" value="true" />
      </Activity>,
    );
    expect(document.body.dataset.sokoBotCreating).toBeUndefined();

    rerender(
      <Activity mode="visible">
        <DatasetMarker datasetKey="sokoBotCreating" value="true" />
      </Activity>,
    );
    expect(document.body.dataset.sokoBotCreating).toBe("true");
  });
});
