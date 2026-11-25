import type { ButtonHTMLAttributes } from "react";
import { t } from "./text.ts";

/** The one Iris button a view may have. Everything else stays neutral. */
export function PrimaryButton({
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className={`bg-primary text-primary-foreground hover:bg-primary-hover focus-visible:outline-ring inline-flex min-h-11 w-full items-center justify-center rounded-md px-4 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed sm:w-auto ${className}`}
      {...props}
    />
  );
}

/** A neutral text button for secondary actions, such as Refresh. */
export function QuietButton({
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className={`hover:bg-accent focus-visible:outline-ring inline-flex min-h-11 items-center justify-center rounded-md px-3 text-sm font-medium focus-visible:outline-2 focus-visible:-outline-offset-2 disabled:cursor-not-allowed disabled:opacity-60 ${className}`}
      {...props}
    />
  );
}

export function Skeleton() {
  return (
    <div role="status" aria-busy="true" className="flex flex-col gap-3">
      <span className="sr-only">{t("shell.loading")}</span>
      <div className="bg-accent h-5 w-2/5 rounded-md motion-safe:animate-pulse" />
      <div className="bg-accent h-4 w-4/5 rounded-md motion-safe:animate-pulse" />
      <div className="bg-accent h-4 w-3/5 rounded-md motion-safe:animate-pulse" />
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
