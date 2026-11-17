import { type CusoArt, cusoArt } from "./cuso";

interface MascotProps {
  className?: string;
  art?: CusoArt;
}

/** Cuso, large, on his light circle beside a page's lead. */
export function Mascot({ className, art = "walking" }: MascotProps) {
  return (
    <img
      className={["mascot", className].filter(Boolean).join(" ")}
      src={cusoArt(art)}
      alt=""
      width={640}
      height={640}
    />
  );
}
