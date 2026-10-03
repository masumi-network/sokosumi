import type { ReactNode } from "react";

import OAuthClientBackLink from "@/auth/components/oauth-client-back-link";
import type { OAuthRequestClient } from "@/lib/auth/oauth-request.server";
import { cn } from "@/lib/utils";

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
  /** For the content's `aria-describedby`; set even while `status` is empty. */
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
          <p id={noticeId} className="text-muted-foreground mt-4 text-sm">
            {notice}
          </p>
        ) : null}
      </div>
      <div className="flex w-full flex-col items-center">
        {children}
        {/* Always rendered, so a screen reader hears what appears in it. */}
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

/** The dot between two links in the links row. */
export function AuthStepLinkSeparator() {
  return <span aria-hidden>·</span>;
}
