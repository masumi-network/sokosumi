"use client";

import { useCallback, useEffect, useState } from "react";

interface WindowSize {
  innerWidth: number;
  outerWidth: number;
  innerHeight: number;
  outerHeight: number;
}

const readWindowSize = () => {
  if (typeof window === "undefined") {
    return undefined;
  }

  return {
    innerWidth: window.innerWidth,
    outerWidth: window.outerWidth,
    innerHeight: window.innerHeight,
    outerHeight: window.outerHeight,
  };
};

export default function useWindowSize(): WindowSize | undefined {
  const [windowSize, setWindowSize] = useState<WindowSize | undefined>(
    undefined,
  );

  const handleSize = useCallback(() => {
    const newWindowSize = readWindowSize();

    if (newWindowSize) {
      setWindowSize({ ...newWindowSize });
    }
  }, [setWindowSize]);

  useEffect(() => {
    window.addEventListener("resize", handleSize);
    handleSize();

    return () => {
      window.removeEventListener("resize", handleSize);
    };
  }, [handleSize]);

  return windowSize;
}
