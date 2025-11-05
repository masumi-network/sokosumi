import { CategoryStyles, CategoryStyleTheme } from "@/lib/types/category";

function generateGradientFromTheme(
  themeStyles: CategoryStyleTheme,
): string | null {
  if (!themeStyles.border?.gradient || !themeStyles.border.gradient.stops) {
    return null;
  }

  const { gradient } = themeStyles.border;
  const { stops, angle = 135 } = gradient;

  if (stops.length === 0) {
    return null;
  }

  const stopStrings = stops.map((stop) => {
    let color = stop.color;
    if (stop.opacity !== undefined && stop.color.startsWith("#")) {
      // Convert hex to rgba if opacity is provided
      let hex = stop.color.slice(1);

      // Expand short hex codes (#FFF -> #FFFFFF)
      if (hex.length === 3) {
        hex = hex
          .split("")
          .map((c) => c + c)
          .join("");
      }

      // Validate hex format (must be 6 valid hex characters)
      if (hex.length !== 6 || !/^[0-9A-Fa-f]{6}$/.test(hex)) {
        // Invalid hex - use original color without opacity
        return `${stop.color} ${stop.offset * 100}%`;
      }

      const r = parseInt(hex.slice(0, 2), 16);
      const g = parseInt(hex.slice(2, 4), 16);
      const b = parseInt(hex.slice(4, 6), 16);
      color = `rgba(${r}, ${g}, ${b}, ${stop.opacity})`;
    } else if (
      stop.opacity !== undefined &&
      stop.color.startsWith("rgb(") &&
      !stop.color.startsWith("rgba(")
    ) {
      // Convert rgb to rgba if opacity is provided
      color = stop.color
        .replace("rgb(", "rgba(")
        .replace(")", `, ${stop.opacity})`);
    }
    return `${color} ${stop.offset * 100}%`;
  });

  return `linear-gradient(${angle}deg, ${stopStrings.join(", ")})`;
}

export function generateGradientBorder(
  styles: CategoryStyles,
  theme: "light" | "dark" = "light",
): string | null {
  if (styles.light || styles.dark) {
    const themeStyles = theme === "dark" ? styles.dark : styles.light;
    if (themeStyles) {
      return generateGradientFromTheme(themeStyles);
    }
    // Fallback to the other theme if current theme doesn't have styles
    const fallbackThemeStyles = theme === "dark" ? styles.light : styles.dark;
    if (fallbackThemeStyles) {
      return generateGradientFromTheme(fallbackThemeStyles);
    }
    return null;
  }
  return null;
}
