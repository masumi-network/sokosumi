import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import { SCOPE_SELECTED_QUERY_KEY } from "@/app/components/project-scope/use-scope-projects";

import { useInvalidateProjectScopeOnNavigation } from "./use-invalidate-project-scope-on-navigation";

describe("useInvalidateProjectScopeOnNavigation", () => {
  it("does not invalidate on mount and invalidates when pathname changes", () => {
    const client = new QueryClient();
    const invalidateSpy = vi.spyOn(client, "invalidateQueries");
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );

    const { rerender } = renderHook(
      ({ pathname }: { pathname: string }) =>
        useInvalidateProjectScopeOnNavigation(pathname),
      { initialProps: { pathname: "/tasks" }, wrapper },
    );

    expect(invalidateSpy).not.toHaveBeenCalled();

    rerender({ pathname: "/tasks" });
    expect(invalidateSpy).not.toHaveBeenCalled();

    rerender({ pathname: "/projects" });
    expect(invalidateSpy).toHaveBeenCalledTimes(1);
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: [SCOPE_SELECTED_QUERY_KEY],
    });
  });
});
