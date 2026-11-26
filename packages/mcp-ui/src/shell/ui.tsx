import type { ButtonHTMLAttributes } from "react";
import { t } from "./text.ts";

/**
 * Web's Button (apps/web/src/components/ui/button.tsx): one shared focus ring
 * and the press. Heights stay at 44px for touch (AGENTS.md); Web's are 40.
 */
const BUTTON =
  "press focus-visible:ring-ring focus-visible:ring-offset-background inline-flex min-h-11 shrink-0 cursor-pointer items-center justify-center gap-2 rounded-md text-sm font-medium transition-[color,background-color,border-color,transform] duration-150 ease-out outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0";

/** Web's `primary`: the one Iris button a view may have. Everything else stays neutral. */
export function PrimaryButton({
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className={`${BUTTON} bg-primary text-primary-foreground hover:bg-primary-hover w-full border border-transparent px-4 sm:w-auto ${className}`}
      {...props}
    />
  );
}

/** Web's `ghost`: a neutral button for secondary actions, such as Refresh. */
export function QuietButton({
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className={`${BUTTON} hover:bg-accent hover:text-accent-foreground px-3 ${className}`}
      {...props}
    />
  );
}

export function Skeleton() {
  return (
    <div role="status" aria-busy="true" className="flex flex-col gap-3">
      <span className="sr-only">{t("shell.loading")}</span>
      <div className="bg-muted h-5 w-2/5 rounded-md motion-safe:animate-pulse" />
      <div className="bg-muted h-4 w-4/5 rounded-md motion-safe:animate-pulse" />
      <div className="bg-muted h-4 w-3/5 rounded-md motion-safe:animate-pulse" />
    </div>
  );
}

export function Message({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex flex-col gap-1">
      <h1 className="text-base font-semibold tracking-tight">{title}</h1>
      <p className="text-muted-foreground text-sm">{body}</p>
    </div>
  );
}
