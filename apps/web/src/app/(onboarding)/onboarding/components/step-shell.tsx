import type { ReactNode } from "react";

interface StepShellProps {
  children?: ReactNode;
  /** Only where it adds something the question does not already say. */
  subtitle?: string;
  title: string;
}

/** Heading frame for an onboarding screen: one question, nothing else. */
export function StepShell({ children, subtitle, title }: StepShellProps) {
  return (
    <div className="w-full text-center">
      <h2 className="text-[1.625rem] leading-[1.15] font-semibold tracking-[-0.02em] text-balance sm:text-[1.875rem]">
        {title}
      </h2>
      {subtitle ? (
        <p className="text-muted-foreground mx-auto mt-3 max-w-[46ch] text-[0.9375rem] leading-[1.6] text-balance">
          {subtitle}
        </p>
      ) : null}
      {children}
    </div>
  );
}
