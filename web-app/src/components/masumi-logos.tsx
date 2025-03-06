import Image from "next/image";
import Link from "next/link";

interface Props {
  variant?: "black" | "white";
  href: string;
  src: string;
  alt: string;
  width: number;
  height: number;
}

function Logo({ src, alt, width, height, href }: Props) {
  return (
    <div className="flex items-center">
      <Link href={href} className="text-xl font-bold">
        <Image
          src={src}
          alt={alt}
          width={width}
          height={height}
          priority={false}
        />
      </Link>
    </div>
  );
}

interface LogoProps {
  variant?: "black" | "white";
}

export function SokosumiLogo({ variant = "black" }: LogoProps) {
  return (
    <Logo
      src={`/logos/sokosumi-logo-${variant}.svg`}
      alt="Sokosumi Logo"
      width={200}
      height={26}
      href="/"
    />
  );
}

export function MasumiLogo({ variant = "black" }: LogoProps) {
  return (
    <Logo
      src={`/logos/masumi-logo-${variant}.svg`}
      alt="Masumi Logo"
      width={371}
      height={57}
      href="/"
    />
  );
}

export function KodosumiLogo({ variant = "black" }: LogoProps) {
  return (
    <Logo
      src={`/logos/kodosumi-logo-${variant}.svg`}
      alt="Kodosumi Logo"
      width={418}
      height={56}
      href="/"
    />
  );
}
