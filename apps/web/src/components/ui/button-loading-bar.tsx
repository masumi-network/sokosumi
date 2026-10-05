"use client"

import { useTranslations } from "next-intl"
import * as React from "react"

import { useMountEffect } from "@/hooks/use-mount-effect"
import { cn } from "@/lib/utils"

type AnnounceLoading = (label: string) => () => void

const ButtonLoadingAnnouncerContext =
  React.createContext<AnnounceLoading | null>(null)

// Long enough for a screen reader to notice the region went empty, so a label
// that is already in it is read again on the button's next run.
const ANNOUNCE_DELAY_MS = 100

/**
 * The one polite live region every loading Button reports to. Mount it once,
 * high in the tree and before any button loads: a region that appears together
 * with its text is announced unreliably. `aria-live` is set explicitly (on top
 * of `role="status"`) because Radix modals hide everything outside the dialog
 * except `[aria-live]` nodes, and most loading buttons sit inside dialogs.
 */
function ButtonLoadingAnnouncer({ children }: { children: React.ReactNode }) {
  const t = useTranslations("Components.Button")
  const [message, setMessage] = React.useState("")

  const announce = React.useCallback<AnnounceLoading>(
    (label) => {
      setMessage("")
      const timer = window.setTimeout(() => {
        setMessage(label ? t("loading", { label }) : t("loadingUnnamed"))
      }, ANNOUNCE_DELAY_MS)
      // A request that is already over is not worth announcing.
      return () => window.clearTimeout(timer)
    },
    [t]
  )

  return (
    <ButtonLoadingAnnouncerContext.Provider value={announce}>
      {children}
      <div
        role="status"
        aria-live="polite"
        className="sr-only"
        data-slot="button-loading-announcer"
      >
        {message}
      </div>
    </ButtonLoadingAnnouncerContext.Provider>
  )
}

function accessibleLabel(control: Element | null | undefined) {
  const ariaLabel = control?.getAttribute("aria-label")
  if (ariaLabel || !control) return (ariaLabel ?? "").trim()
  // Decoration hidden from screen readers is not part of the name either.
  const copy = control.cloneNode(true) as Element
  for (const hidden of copy.querySelectorAll('[aria-hidden="true"]')) {
    hidden.remove()
  }
  return (copy.textContent ?? "").trim()
}

/**
 * The bar a loading Button sweeps along its bottom edge. Mounting it is the
 * start of the loading state, so it also tells the announcer, by the button's
 * own name. It lives in the button's DOM but is `aria-hidden`, so it never
 * changes that name; the announcement goes to the region outside.
 *
 * Also exported for buttons this component cannot render, such as third-party
 * sign-in buttons. The parent needs `relative overflow-hidden` and the
 * button's radius, and `label` names the button, since the bar then sits
 * outside it.
 */
function ButtonLoadingBar({
  className,
  label,
}: {
  className?: string
  label?: string
}) {
  const announce = React.useContext(ButtonLoadingAnnouncerContext)
  const ref = React.useRef<HTMLSpanElement>(null)

  useMountEffect(() =>
    announce?.(
      label ?? accessibleLabel(ref.current?.closest('[data-slot="button"]'))
    )
  )

  return (
    <span
      ref={ref}
      aria-hidden="true"
      data-slot="button-loading-bar"
      className={cn(
        "animate-button-loading-sweep pointer-events-none absolute bottom-0 left-0 h-0 w-2/5 border-t-2 border-current motion-reduce:w-full motion-reduce:animate-pulse",
        className
      )}
    />
  )
}

export { ButtonLoadingAnnouncer, ButtonLoadingBar }
