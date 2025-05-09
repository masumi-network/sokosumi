import Image, { ImageProps } from "next/image";

export function SokosumiIcon({ ...props }: Omit<ImageProps, "src" | "alt">) {
  return (
    <Image src={`/icons/sokosumi-icon.svg`} alt="Sokosumi Icon" {...props} />
  );
}
