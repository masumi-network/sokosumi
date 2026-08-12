import type { ReactNode } from "react";

interface StepShellProps {
  children?: ReactNode;
  /** Only where it adds something the question does not already say. */
  subtitle?: string;
  title: string;
}

/**
 * Heading frame for an onboarding screen: one question, nothing else.
 *
 * Type matches the chat welcome — light and large rather than tight and bold —
 * so moving from the greeting into the questions does not feel like moving
 * from a product into a form.
 */
export function StepShell({ children, subtitle, title }: StepShellProps) {
  return (
    <div className="w-full text-center">
      <h2 className="text-foreground text-2xl font-light text-balance sm:text-3xl">
        {title}
      </h2>
      {subtitle ? (
        <p className="text-muted-foreground mx-auto mt-4 max-w-[52ch] text-base leading-[1.65] text-balance">
          {subtitle}
        </p>
      ) : null}
      {children}
    </div>
  );
}
