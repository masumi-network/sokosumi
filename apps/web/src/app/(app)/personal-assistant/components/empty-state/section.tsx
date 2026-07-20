"use client";

export function Section({
  eyebrow,
  heading,
  description,
  marginTop = "mt-28 md:mt-36",
  children,
}: {
  eyebrow: string;
  heading: string;
  description?: string;
  marginTop?: string;
  children: React.ReactNode;
}) {
  return (
    <section className={marginTop}>
      <div className="mb-6 flex flex-col">
        <div className="text-muted-foreground text-xs font-medium uppercase tracking-widest">
          {eyebrow}
        </div>
        <h2 className="text-foreground mt-2 max-w-2xl text-balance text-xl font-light tracking-tight md:text-2xl">
          {heading}
        </h2>
        {description ? (
          <p className="text-muted-foreground mt-2 max-w-2xl text-pretty text-sm leading-relaxed">
            {description}
          </p>
        ) : null}
      </div>
      {children}
    </section>
  );
}
