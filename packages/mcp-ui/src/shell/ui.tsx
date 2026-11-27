import type { LucideIcon } from "lucide-react";
import type { ButtonHTMLAttributes, ReactNode } from "react";
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

const VARIANT = {
  /** Web's `default`: the bordered button, for every secondary action that is a step. */
  outline: "border-border bg-background hover:bg-accent border px-4",
  /** Web's `ghost`: a quiet action beside content, such as Refresh. */
  ghost: "hover:bg-accent hover:text-accent-foreground px-3",
  /** Web's `destructive`: the solid X, for the confirm of an irreversible step. */
  destructive:
    "bg-semantic-destructive-solid text-semantic-destructive-foreground hover:bg-destructive-hover border border-transparent px-4",
} as const;

/** Web's Button in its neutral variants. The Iris one is `PrimaryButton`. */
export function Button({
  variant = "outline",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: keyof typeof VARIANT;
}) {
  return (
    <button
      type="button"
      className={`${BUTTON} ${VARIANT[variant]} ${className}`}
      {...props}
    />
  );
}

/** Web's Badge (`muted` and `outline`): a fact such as a price, never an action. */
export function Badge({
  variant = "muted",
  children,
}: {
  variant?: "muted" | "outline";
  children: ReactNode;
}) {
  return (
    <span
      className={`inline-flex w-fit shrink-0 items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium whitespace-nowrap tabular-nums [&>svg]:size-3 ${variant === "muted" ? "bg-muted border-transparent" : "text-foreground"}`}
    >
      {children}
    </span>
  );
}

/** A grey bar of the given size, pulsing unless motion is reduced. */
function Bar({ className }: { className: string }) {
  return (
    <div
      className={`bg-muted rounded-md motion-safe:animate-pulse ${className}`}
    />
  );
}

/**
 * Loading, in the shape of what is coming, as Web's per-page skeletons:
 * `cards` for lists and boards, `detail` for one record, `form` for a form.
 */
export function Skeleton({
  shape = "detail",
}: {
  shape?: "cards" | "detail" | "form";
}) {
  return (
    <div role="status" aria-busy="true" className="flex flex-col gap-4">
      <span className="sr-only">{t("shell.loading")}</span>
      <div className="flex flex-col gap-2">
        <Bar className="h-5 w-2/5" />
        <Bar className="h-3 w-1/4" />
      </div>
      {shape === "cards" &&
        [0, 1, 2].map((key) => (
          <div
            key={key}
            className="border-border flex flex-col gap-3 rounded-lg border p-3"
          >
            <Bar className="h-3 w-1/3" />
            <Bar className="h-4 w-4/5" />
            <div className="flex items-center justify-between">
              <Bar className="h-3 w-1/4" />
              <Bar className="size-5 rounded-full" />
            </div>
          </div>
        ))}
      {shape === "detail" && (
        <div className="flex flex-col gap-2">
          <Bar className="h-4 w-full" />
          <Bar className="h-4 w-4/5" />
          <Bar className="h-4 w-3/5" />
        </div>
      )}
      {shape === "form" &&
        [0, 1].map((key) => (
          <div key={key} className="flex flex-col gap-2">
            <Bar className="h-4 w-1/4" />
            <Bar className="h-10 w-full" />
          </div>
        ))}
    </div>
  );
}

/**
 * Web's EmptyState (components/common/empty-state.tsx): an icon disc, a
 * title and a short body, centred, with the way on below.
 */
export function StateMessage({
  icon: Icon,
  title,
  body,
  action,
}: {
  icon: LucideIcon;
  title: string;
  body: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-1 px-6 py-12 text-center">
      <span
        aria-hidden="true"
        className="bg-quinary text-muted-foreground mb-2 flex size-10 items-center justify-center rounded-full"
      >
        <Icon className="size-5" />
      </span>
      <h1 className="text-base font-semibold">{title}</h1>
      <p className="text-muted-foreground max-w-[44ch] text-sm">{body}</p>
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}
