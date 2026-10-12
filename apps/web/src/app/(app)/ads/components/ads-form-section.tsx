import type { ReactNode } from "react";

interface AdsFormSectionProps {
  id: string;
  title: string;
  children: ReactNode;
}

/** A titled group of fields on the create page. */
export function AdsFormSection({ id, title, children }: AdsFormSectionProps) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-6">
      <h2 className="text-lg font-semibold" id={id}>
        {title}
      </h2>
      {children}
    </section>
  );
}
