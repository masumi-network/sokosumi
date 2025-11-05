export interface Category {
  slug: string;
  name: string | null;
  priority: number;
  description: string | null;
  image: string | null;
  styles: CategoryStyles | null;
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
