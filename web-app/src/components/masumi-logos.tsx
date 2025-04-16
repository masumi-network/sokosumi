import Image, { ImageProps } from "next/image";
import { type ComponentType } from "react";

interface LogoProps extends Omit<ImageProps, "src" | "alt"> {
  variant?: "black" | "white";
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
      src={`/kanji/sokosumi-${variant}.svg`}
      alt="Hero Background"
      width={20}
      height={40}
      {...props}
    />
  );
}

function SokosumiLogo({ variant = "black", ...props }: LogoProps) {
  return (
    <Image
      src={`/logos/sokosumi-logo-${variant}.svg`}
      alt="Sokosumi Logo"
      {...props}
    />
  );
}

function MasumiLogo({ variant = "black", ...props }: LogoProps) {
  return (
    <Image
      src={`/logos/masumi-logo-${variant}.svg`}
      alt="Masumi Logo"
      {...props}
    />
  );
}

function KodosumiLogo({ variant = "black", ...props }: LogoProps) {
  return (
    <Image
      src={`/logos/kodosumi-logo-${variant}.svg`}
      alt="Kodosumi Logo"
      {...props}
    />
  );
}

export { KanjiLogo, KodosumiLogo, MasumiLogo, SokosumiLogo, ThemedLogo };
