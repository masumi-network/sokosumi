import type { ReactNode } from "react";

interface AdsFormSectionProps {
  id: string;
  title: string;
  /** A control that belongs to the section, beside its title. */
  action?: ReactNode;
  children: ReactNode;
}

/** A titled group of fields on the create page and of facts on the details page. */
export function AdsFormSection({
  id,
  title,
  action,
  children,
}: AdsFormSectionProps) {
  const heading = (
    <h2 className="text-lg font-semibold" id={id}>
      {title}
    </h2>
  );

  return (
    <section aria-labelledby={id} className="flex flex-col gap-6">
      {action ? (
        <div className="flex items-center justify-between gap-3">
          {heading}
          {action}
        </div>
      ) : (
        heading
      )}
      {children}
    </section>
  );
}
