'use client'

import { useTheme } from 'next-themes';
import Image from 'next/image';
import { useEffect, useState } from 'react';

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
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) return null;

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