import Image, { ImageProps } from "next/image";

interface IconProps extends Omit<ImageProps, "src" | "alt"> {
  variant?: "red";
}

export function SokosumiIcon({ variant = "red", ...props }: IconProps) {
  return (
    <Image
      src={`/icons/sokosumi-icon-${variant}.svg`}
      alt="Sokosumi Icon"
      {...props}
    />
  );
}
