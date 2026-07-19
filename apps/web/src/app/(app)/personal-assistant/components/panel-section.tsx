/**
 * Section frame shared by the assistant's sheet panels (Settings, Autonomy).
 * One consistent header pattern (semibold title + optional muted description
 * + optional right-aligned trailing slot). Spacing between sections is owned
 * by the parent `gap-10` so sections don't need `<Separator />` lines.
 */
export default function PanelSection({
  title,
  description,
  trailing,
  children,
}: {
  title: string;
  description?: string;
  trailing?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="text-foreground text-sm font-semibold tracking-tight">
            {title}
          </h3>
          {description ? (
            <p className="text-muted-foreground mt-1 text-xs leading-relaxed">
              {description}
            </p>
          ) : null}
        </div>
        {trailing ? <div className="shrink-0">{trailing}</div> : null}
      </div>
      {children}
    </section>
  );
}
