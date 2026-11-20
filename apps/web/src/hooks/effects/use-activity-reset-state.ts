"use client";

import {
  type Dispatch,
  type SetStateAction,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

/**
 * Local UI state that resets to its initial value before paint when React
 * hides a retained `<Activity>` route or unmounts the component, while
 * surviving ordinary re-renders and data refreshes.
 */
export function useActivityResetState<T>(
  initialValue: T,
): [T, Dispatch<SetStateAction<T>>] {
  const [value, setValue] = useState<T>(initialValue);
  const initialRef = useRef(initialValue);

  useLayoutEffect(() => {
    return () => setValue(initialRef.current);
  }, []);

  return [value, setValue];
}
