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
      src={`/kanji/sokosumi-logo-kanji-${variant}.svg`}
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
      src={`/logos/sokosumi-logo-${variant}.svg`}
      alt="Sokosumi Logo"
      width={200}
      height={26}
      {...props}
    />
  );
}

function KodosumiLogo({ variant = "black", ...props }: LogoProps) {
  return (
    <Image
      src={`/logos/kodosumi-logo-${variant}.svg`}
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
      src={`/logos/masumi-logo-${variant}.svg`}
      alt="Masumi Logo"
      width={200}
      height={31}
      {...props}
    />
  );
}

export { KanjiLogo, KodosumiLogo, MasumiLogo, SokosumiLogo, ThemedLogo };
