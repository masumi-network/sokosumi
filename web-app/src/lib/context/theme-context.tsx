import { ThemeProvider as NextThemesProvider } from "next-themes";
import { type ThemeProviderProps } from "next-themes";

export function ThemeProvider({ children, ...props }: ThemeProviderProps) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      scriptProps={{ "data-cfasync": "false" }}
      {...props}
    >
      {children}
    </NextThemesProvider>
  );
}
