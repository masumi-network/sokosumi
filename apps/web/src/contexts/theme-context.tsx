import {
  ThemeProvider as NextThemesProvider,
  type ThemeProviderProps,
} from "next-themes";
import type { ComponentType, ReactNode } from "react";

interface AppThemeProviderProps extends ThemeProviderProps {
  children: ReactNode;
}

const ThemeProviderComponent =
  NextThemesProvider as ComponentType<AppThemeProviderProps>;

export function ThemeProvider({ children, ...props }: AppThemeProviderProps) {
  return (
    <ThemeProviderComponent
      attribute="class"
      defaultTheme="system"
      enableSystem
      scriptProps={{ "data-cfasync": "false" }}
      {...props}
    >
      {children}
    </ThemeProviderComponent>
  );
}
