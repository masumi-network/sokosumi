"use client";

import { useEffect, useState } from "react";

const MOBILE_MAX_WIDTH = 768;
const KEYBOARD_THRESHOLD_PX = 80;

/**
 * Returns the vertical offset (px) to apply to the input container's bottom
 * so it sits above the virtual keyboard on mobile. When the keyboard is open,
 * visualViewport.height shrinks; we return the difference so the container
 * can use bottom: offset and stay above the keyboard.
 */
export function useKeyboardBottomOffset(): number {
  const [offset, setOffset] = useState(0);

  useEffect(() => {
    if (typeof window === "undefined" || !window.visualViewport) {
      return;
    }

    const update = () => {
      const isMobile = window.innerWidth < MOBILE_MAX_WIDTH;
      if (!isMobile) {
        setOffset(0);
        return;
      }
      const keyboardHeight = window.innerHeight - window.visualViewport.height;
      setOffset(keyboardHeight > KEYBOARD_THRESHOLD_PX ? keyboardHeight : 0);
    };

    update();
    window.visualViewport.addEventListener("resize", update);
    window.visualViewport.addEventListener("scroll", update);
    return () => {
      window.visualViewport.removeEventListener("resize", update);
      window.visualViewport.removeEventListener("scroll", update);
    };
  }, []);

  return offset;
}
