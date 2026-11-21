import { normalizeHex } from "@sokosumi/utils";

export function studioRgbColors(palette: readonly string[]) {
  return palette.flatMap((color) => {
    const hex = normalizeHex(color);
    return hex
      ? [
          {
            r: Number.parseInt(hex.slice(1, 3), 16),
            g: Number.parseInt(hex.slice(3, 5), 16),
            b: Number.parseInt(hex.slice(5, 7), 16),
          },
        ]
      : [];
  });
}
