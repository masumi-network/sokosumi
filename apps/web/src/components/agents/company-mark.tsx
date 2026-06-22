import { cn } from "@/lib/utils";

const COMPANY_LOGOS: Record<string, { light: string; dark: string }> = {
  serviceplan: {
    light: "/images/logos/serviceplan-logo.png",
    dark: "/images/logos/serviceplan-logo-white.png",
  },
  sokosumi: {
    light: "/images/logos/sokosumi-logo-black.svg",
    dark: "/images/logos/sokosumi-logo-white.svg",
  },
};

function companyKey(company: string): string {
  return company
    .toLowerCase()
    .replace(/\s+(ag|gmbh|inc|llc)\.?$/, "")
    .trim();
}

interface CompanyMarkProps {
  company: string;
  className?: string;
  textClassName?: string;
}

/**
 * Renders a company's logo (light/dark variants) when an asset exists, falling
 * back to the company name as text. Shared by the New Task picker and the
 * agents-page coworker gallery so company branding stays consistent.
 */
export function CompanyMark({
  company,
  className = "h-5",
  textClassName,
}: CompanyMarkProps) {
  const asset = COMPANY_LOGOS[companyKey(company)];
  if (asset) {
    return (
      <>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={asset.light}
          alt={company}
          className={cn("w-auto object-contain dark:hidden", className)}
        />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={asset.dark}
          alt={company}
          className={cn("hidden w-auto object-contain dark:block", className)}
        />
      </>
    );
  }
  return (
    <span className={textClassName ?? "text-foreground text-sm font-semibold"}>
      {company}
    </span>
  );
}
