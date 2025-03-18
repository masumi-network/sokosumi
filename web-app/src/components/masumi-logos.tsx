import Image, { ImageProps } from "next/image";

interface LogoProps extends Omit<ImageProps, "src" | "alt"> {
  variant?: "black" | "white";
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

export { KodosumiLogo, MasumiLogo, SokosumiLogo };
