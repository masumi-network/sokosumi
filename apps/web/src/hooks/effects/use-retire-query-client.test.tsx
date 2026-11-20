import type { QueryClient } from "@tanstack/react-query";
import { act, render } from "@testing-library/react";
import { StrictMode } from "react";
import { describe, expect, it, vi } from "vitest";
import { createQueryClient } from "@/queries/get-query-client";
import { useRetireQueryClient } from "./use-retire-query-client";

function Harness({ client }: { client: QueryClient }) {
  useRetireQueryClient(client);
  return null;
}

describe("useRetireQueryClient", () => {
  it("cancels queries before clearing the replaced client", () => {
    const first = createQueryClient();
    const second = createQueryClient();
    const callOrder: string[] = [];

    const cancelSpy = vi
      .spyOn(first, "cancelQueries")
      .mockImplementation(() => {
        callOrder.push("cancelQueries");
        return Promise.resolve();
      });
    const clearSpy = vi.spyOn(first, "clear").mockImplementation(() => {
      callOrder.push("clear");
    });
    const secondClearSpy = vi.spyOn(second, "clear");

    const view = render(<Harness client={first} />);
    expect(cancelSpy).not.toHaveBeenCalled();
    expect(clearSpy).not.toHaveBeenCalled();

    view.rerender(<Harness client={second} />);

    expect(callOrder).toEqual(["cancelQueries", "clear"]);
    expect(secondClearSpy).not.toHaveBeenCalled();
  });

  it("retires the active client when genuinely unmounted", async () => {
    const client = createQueryClient();
    client.setQueryData(["private"], "secret");
    const cancelSpy = vi.spyOn(client, "cancelQueries");
    const clearSpy = vi.spyOn(client, "clear");

    const view = render(<Harness client={client} />);
    view.unmount();

    await act(async () => {
      await Promise.resolve();
    });

    expect(cancelSpy).toHaveBeenCalledOnce();
    expect(clearSpy).toHaveBeenCalledOnce();
    expect(client.getQueryData(["private"])).toBeUndefined();
  });

  it("does not retire the initial client during StrictMode double mount", async () => {
    const client = createQueryClient();
    client.setQueryData(["hydrated"], "job-1");
    const cancelSpy = vi.spyOn(client, "cancelQueries");
    const clearSpy = vi.spyOn(client, "clear");

    render(
      <StrictMode>
        <Harness client={client} />
      </StrictMode>,
    );

    await act(async () => {
      await Promise.resolve();
    });

    expect(cancelSpy).not.toHaveBeenCalled();
    expect(clearSpy).not.toHaveBeenCalled();
    expect(client.getQueryData(["hydrated"])).toBe("job-1");
  });
});
