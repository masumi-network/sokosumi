import { z } from "zod";
import type { ViewContext } from "../../shell/Shell.tsx";
import { formatDateTime, isUnderBase, t } from "../../shell/text.ts";
import { PrimaryButton } from "../../shell/ui.tsx";

/** Placeholder view (SOKD-415): proves the build, the shell and the harness. */
export const HelloData = z.object({
  name: z.string(),
  createdAt: z.string(),
  url: z.string().optional(),
});
export type HelloData = z.infer<typeof HelloData>;

export function HelloView({
  data,
  context,
}: {
  data: HelloData;
  context: ViewContext;
}) {
  const { url } = data;
  const canOpen = url !== undefined && isUnderBase(url, context.webBaseUrl);

  return (
    <article className="flex flex-col gap-4">
      <header className="flex flex-col gap-1">
        <h1 className="text-lg font-semibold tracking-tight">
          {t("hello.title", { name: data.name })}
        </h1>
        <p className="text-muted-foreground text-xs">
          {t("hello.created", {
            date: formatDateTime(data.createdAt, context),
          })}
        </p>
      </header>
      <p className="max-w-prose">{t("hello.body")}</p>
      {canOpen && (
        <div>
          <PrimaryButton onClick={() => void context.app.openLink({ url })}>
            {t("hello.open")}
          </PrimaryButton>
        </div>
      )}
    </article>
  );
}
