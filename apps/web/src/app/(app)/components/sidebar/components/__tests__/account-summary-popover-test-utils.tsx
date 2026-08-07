import type { ComponentProps, ReactElement } from "react";

/**
 * Shared flags for account-summary shell tests. When `forceMount` is true,
 * popover children stay in the tree through close (same window as a real exit
 * animation) so remount-on-close vs remount-on-open is observable in jsdom.
 */
export const accountSummaryPopoverTestFlags = {
  forceMount: false,
};

export function resetAccountSummaryPopoverTestFlags(): void {
  accountSummaryPopoverTestFlags.forceMount = false;
}

type PopoverModule = typeof import("@/components/ui/popover");

/**
 * Builds a `@/components/ui/popover` mock that optionally force-mounts content.
 * Use inside `vi.mock` factories:
 *
 * ```ts
 * vi.mock("@/components/ui/popover", async (importOriginal) => {
 *   const actual = await importOriginal<typeof import("@/components/ui/popover")>();
 *   const { createAccountSummaryPopoverMock } = await import(
 *     "@/app/components/sidebar/components/__tests__/account-summary-popover-test-utils"
 *   );
 *   return createAccountSummaryPopoverMock(actual);
 * });
 * ```
 */
export function createAccountSummaryPopoverMock(
  actual: PopoverModule,
): PopoverModule {
  function PopoverContent(
    props: ComponentProps<typeof actual.PopoverContent>,
  ): ReactElement {
    if (accountSummaryPopoverTestFlags.forceMount) {
      return (
        <div data-slot="popover-content" data-testid="forced-popover-content">
          {props.children}
        </div>
      );
    }
    return <actual.PopoverContent {...props} />;
  }

  return {
    ...actual,
    PopoverContent,
  };
}
