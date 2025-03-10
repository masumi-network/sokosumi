import Image, { ImageProps } from "next/image";

interface IconProps extends Omit<ImageProps, "src" | "alt"> {
  variant?: "red";
  width?: number;
  height?: number;
}

export function SokosumiIcon({
  variant = "red",
  width = 32,
  height = 32,
  ...props
}: IconProps) {
  return (
    <Image
      src={`/icons/sokosumi-icon-${variant}.svg`}
      alt="Sokosumi Icon"
      width={width}
      height={height}
      {...props}
    />
  );
}
