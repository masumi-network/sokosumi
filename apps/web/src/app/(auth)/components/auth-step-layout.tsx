import type { ReactNode } from "react";

import OAuthClientBackLink from "@/auth/components/oauth-client-back-link";
import type { OAuthRequestClient } from "@/lib/auth/oauth-request.server";
import { cn } from "@/lib/utils";

/** A link or text button in the links row, e.g. to switch the method. */
export const AUTH_STEP_LINK_CLASS =
  "text-muted-foreground hover:text-foreground focus-visible:ring-ring-halo rounded-sm text-sm font-medium underline underline-offset-4 outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed";

interface AuthStepLayoutProps {
  /** The product that sent the person here through Sign in with Sokosumi. */
  client?: OAuthRequestClient | undefined;
  /** What to do on this step, e.g. "Check your email". */
  title: string;
  subtitle?: string | undefined;
  /** The address the step acts on, under the subtitle. */
  chip?: ReactNode;
  /** Why the step opened, between the chip and the content. */
  notice?: ReactNode;
  /** For the content's `aria-describedby`. */
  noticeId?: string | undefined;
  /** The step's field. */
  children: ReactNode;
  /** Checking, accepted, or what went wrong; nothing while the person types. */
  status?: ReactNode;
  /**
   * For the content's `aria-describedby`; set even while `status` is empty.
   * A step without either has no status line, e.g. step 1, whose checks
   * speak through toasts and the unknown-address notice.
   */
  statusId?: string | undefined;
  /** Marks `status` as the reason the field was refused. */
  statusIsError?: boolean | undefined;
  /** The Security check, under the status line. */
  securityCheck?: ReactNode;
  /** The ways out, in one row under the step. */
  links?: ReactNode;
  /** At the foot of the page, e.g. the terms notice. */
  footer?: ReactNode;
}

/**
 * The frame every log-in and sign-up step shares: one question per step,
 * centred, with the ways out in a row of links underneath.
 */
export function AuthStepLayout({
  client,
  title,
  subtitle,
  chip,
  notice,
  noticeId,
  children,
  status,
  statusId,
  statusIsError = false,
  securityCheck,
  links,
  footer,
}: AuthStepLayoutProps) {
  return (
    <div className="flex w-full min-w-0 flex-1 flex-col items-center gap-8 py-6 text-center contain-inline-size">
      <div className="flex w-full flex-col items-center gap-2">
        {client ? (
          <OAuthClientBackLink client={client} className="self-center" />
        ) : null}
        <h1 className="text-3xl font-light text-balance tracking-tight sm:text-4xl">
          {title}
        </h1>
        {subtitle ? (
          <p className="text-muted-foreground text-sm">{subtitle}</p>
        ) : null}
        {chip}
        {notice ? (
          // A div: a notice can be a whole alert, e.g. why a sign-in failed.
          <div
            id={noticeId}
            className="text-muted-foreground mt-4 w-full text-sm"
          >
            {notice}
          </div>
        ) : null}
      </div>
      <div className="flex w-full flex-col items-center">
        {children}
        {/* Rendered from the start on a step that checks something, so a
            screen reader hears what appears in it. */}
        {statusId !== undefined || status ? (
          <div
            id={statusId}
            role="status"
            className={cn(
              "text-sm",
              statusIsError ? "text-destructive" : "text-muted-foreground",
              status ? "mt-6" : null,
            )}
          >
            {status}
          </div>
        ) : null}
        {securityCheck}
      </div>
      {links ? (
        // A div, not a p: a Security check may render inside a link's button.
        <div className="text-muted-foreground flex flex-wrap items-center justify-center gap-x-3 gap-y-2 text-sm">
          {links}
        </div>
      ) : null}
      {footer}
    </div>
  );
}

/**
 * A step's one line for a refusal, between its fields and its button. Always
 * rendered, so a screen reader hears what appears in it (a submit leaves
 * focus on the disabled form), and out of the flow until there is one. A div,
 * so it can hold a link.
 */
interface AuthStepErrorLineProps {
  id: string;
  /** The reason; the line takes no space without one. */
  children?: ReactNode;
}

export function AuthStepErrorLine({ id, children }: AuthStepErrorLineProps) {
  return (
    <div
      id={id}
      role="alert"
      className={children ? "text-destructive text-center text-sm" : "sr-only"}
    >
      {children}
    </div>
  );
}

/** The dot between two links in the links row. */
export function AuthStepLinkSeparator() {
  return <span aria-hidden>·</span>;
}
