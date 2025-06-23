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

const initialValue: WindowSize = {
  innerWidth: 0,
  outerWidth: 0,
  innerHeight: 0,
  outerHeight: 0,
};

export default function useWindowSize(): WindowSize {
  const [windowSize, setWindowSize] = useState<WindowSize>(initialValue);

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
      console.log("unmounting");
      window.removeEventListener("resize", handleSize);
    };
  }, [handleSize]);

  return windowSize;
}
