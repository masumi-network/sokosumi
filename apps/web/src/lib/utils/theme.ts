import { CategoryStyles, CategoryStyleTheme } from "@/lib/types/category";

export function getThemeAwareStyles(
  categoryStyles: CategoryStyles,
  theme: "light" | "dark",
): CategoryStyleTheme | undefined {
  const themeStyles =
    theme === "dark" ? categoryStyles.dark : categoryStyles.light;
  const fallbackStyles =
    theme === "dark" ? categoryStyles.light : categoryStyles.dark;

  return themeStyles || fallbackStyles;
}

export function getCategoryColor(
  categoryStyles: CategoryStyles,
  theme: "light" | "dark",
  fallbackColor: string = "text-default-foreground",
): string {
  const themeStyles = getThemeAwareStyles(categoryStyles, theme);
  return themeStyles?.color || fallbackColor;
}
