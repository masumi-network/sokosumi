export interface Category {
  slug: string;
  name: string;
  priority: number;
  description?: string;
  image?: string;
  styles?: CategoryStyles;
}

export interface CategoryStyleTheme {
  color?: string;
  border?: {
    gradient?: {
      type: string;
      angle?: number;
      shape?: string;
      extent?: string;
      position?: { x: number; y: number };
      stops: Array<{
        color: string;
        offset: number;
        opacity?: number;
      }>;
    };
  };
}

export interface CategoryStyles {
  light?: CategoryStyleTheme;
  dark?: CategoryStyleTheme;
}
