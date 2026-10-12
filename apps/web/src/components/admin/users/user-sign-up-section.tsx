import type { SignUpContext } from "@sokosumi/core-client";
import { getFormatter, getTranslations } from "next-intl/server";

interface UserSignUpSectionProps {
  /** Null when Core has no sign-up recorded for the user. */
  signUp: SignUpContext | null;
}

const ENTRY_LIST_CLASS =
  "grid grid-cols-[minmax(0,10rem)_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm";

/**
 * Read-only sign-up origin, date and context entries for one user. Context
 * values are untrusted input from the sign-up origin, so they render as plain
 * text and never as links.
 */
export async function UserSignUpSection({ signUp }: UserSignUpSectionProps) {
  const [t, formatter] = await Promise.all([
    getTranslations("App.Admin.Users.UserDetail.SignUp"),
    getFormatter(),
  ]);
  const entries = signUp ? Object.entries(signUp.context) : [];

  return (
    <section
      aria-labelledby="admin-user-sign-up-title"
      className="bg-card-background space-y-4 rounded-lg border p-4"
    >
      <h2 id="admin-user-sign-up-title" className="font-medium">
        {t("title")}
      </h2>
      {signUp ? (
        <>
          <dl className={ENTRY_LIST_CLASS}>
            <dt className="text-muted-foreground">{t("origin")}</dt>
            <dd className="wrap-anywhere">{signUp.origin}</dd>
            <dt className="text-muted-foreground">{t("recorded")}</dt>
            <dd className="tabular-nums">
              {formatter.dateTime(signUp.createdAt, "dateTimeWithYear")}
            </dd>
          </dl>
          <div className="space-y-2">
            <h3 className="text-sm font-medium">{t("context")}</h3>
            {entries.length > 0 ? (
              <dl className={ENTRY_LIST_CLASS}>
                {entries.map(([key, value]) => (
                  <div key={key} className="contents">
                    <dt className="text-muted-foreground font-mono wrap-anywhere">
                      {key}
                    </dt>
                    <dd className="font-mono wrap-anywhere">{String(value)}</dd>
                  </div>
                ))}
              </dl>
            ) : (
              <p className="text-muted-foreground text-sm">{t("noContext")}</p>
            )}
          </div>
        </>
      ) : (
        <p className="text-muted-foreground text-sm">{t("notRecorded")}</p>
      )}
    </section>
  );
}
