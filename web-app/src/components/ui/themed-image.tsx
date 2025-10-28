'use client'

import { useTheme } from 'next-themes';
import Image from 'next/image';
import { useSyncExternalStore } from 'react';

interface ThemedImageProps {
  srcLight: string;
  srcDark: string;
  alt: string;
  width: number;
  height: number;
  style?: React.CSSProperties;
}

export function ThemedImage({ srcLight, srcDark, alt, width, height, style }: ThemedImageProps) {
  const { theme } = useTheme();
  
  // Use useSyncExternalStore to detect client-side rendering without useEffect
  const isClient = useSyncExternalStore(
    () => () => {}, // subscribe (no-op)
    () => true,      // getSnapshot (client)
    () => false,     // getServerSnapshot (server)
  );

  if (!isClient) return null;

  const imageSrc = theme === 'dark' ? srcDark : srcLight;
  
  return (
    <Image
      src={imageSrc}
      alt={alt}
      width={width}
      height={height}
      style={style}
    />
  );
}