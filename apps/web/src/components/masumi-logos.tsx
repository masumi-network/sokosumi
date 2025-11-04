import Image, { ImageProps } from "next/image";
import { type ComponentType, type SVGProps } from "react";

import { cn } from "@/lib/utils";

interface LogoProps extends Omit<ImageProps, "src" | "alt"> {
  variant?: "black" | "white";
}

interface IconProps extends Omit<SVGProps<SVGSVGElement>, "width" | "height"> {
  size?: number;
}

interface ThemedLogoProps extends Omit<LogoProps, "variant" | "className"> {
  LogoComponent: ComponentType<LogoProps>;
}

function ThemedLogo({ LogoComponent, ...props }: ThemedLogoProps) {
  return (
    <>
      <LogoComponent variant="black" className="dark:hidden" {...props} />
      <LogoComponent variant="white" className="hidden dark:block" {...props} />
    </>
  );
}

function KanjiLogo({ variant = "black", ...props }: LogoProps) {
  return (
    <Image
      className="hidden dark:block"
      src={`/images/kanji/sokosumi-logo-kanji-${variant}.svg`}
      alt="Hero Background"
      width={20}
      height={42}
      {...props}
    />
  );
}

function SokosumiLogo({ variant = "black", ...props }: LogoProps) {
  return (
    <Image
      src={`/images/logos/sokosumi-logo-${variant}.svg`}
      alt="Sokosumi Logo"
      width={200}
      height={26}
      {...props}
    />
  );
}

function SokosumiIcon({ className, ...props }: IconProps) {
  // Inline SVG for SokosumiIconFlat (black/white by variant, using currentColor for adaptability)
  return (
    <svg
      viewBox="0 0 950 950"
      fill="none"
      width={32}
      height={32}
      aria-label="Sokosumi Icon"
      className={cn("animate-fade-in animate-rotate-once", className)}
      {...props}
    >
      <path
        d="M475 0C737.335 0 950 212.665 950 475C950 737.335 737.335 950 475 950C212.665 950 0 737.335 0 475C0 212.665 212.665 0 475 0ZM153 475.721C153 613.086 265.71 724.483 404.701 724.483C543.692 724.483 656.402 613.125 656.402 475.721H586.485C586.485 574.783 504.96 655.361 404.701 655.361C304.442 655.361 222.917 574.745 222.917 475.721H153ZM545.732 225C406.742 225 294.031 337.236 294.031 475.722H363.948C363.948 375.879 445.474 294.666 545.732 294.666C645.991 294.666 727.516 375.918 727.517 475.722H797.434C797.433 337.274 684.723 225 545.732 225Z"
        fill="currentColor"
      />
    </svg>
  );
}

function KodosumiLogo({ variant = "black", ...props }: LogoProps) {
  return (
    <Image
      src={`/images/logos/kodosumi-logo-${variant}.svg`}
      alt="Kodosumi Logo"
      width={200}
      height={27}
      {...props}
    />
  );
}

function MasumiLogo({ variant = "black", ...props }: LogoProps) {
  return (
    <Image
      src={`/images/logos/masumi-logo-${variant}.svg`}
      alt="Masumi Logo"
      width={200}
      height={31}
      {...props}
    />
  );
}

export {
  KanjiLogo,
  KodosumiLogo,
  MasumiLogo,
  SokosumiIcon,
  SokosumiLogo,
  ThemedLogo,
};
