import Image from "next/image";

/**
 * Who makes a marketplace agent. The author logo comes first, as the old
 * gallery showed it: an admin override usually sets only the logo, and the
 * registry's author name under it is often a placeholder.
 */
export function AgentVendor({
  logo,
  label,
  alt,
}: {
  logo: string | null;
  label: string;
  alt: string;
}) {
  if (!logo) return <span className="min-w-0 truncate">{label}</span>;
  return (
    <Image
      src={logo}
      alt={alt}
      width={100}
      height={16}
      unoptimized
      className="h-4 w-auto max-w-32 object-contain object-left brightness-0 invert-[0.5] dark:brightness-100"
    />
  );
}
