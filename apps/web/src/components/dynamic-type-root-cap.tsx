"use client";

import { useEffect } from "react";

import { applyDynamicTypeRootCap } from "@/lib/utils/dynamic-type";

export function DynamicTypeRootCap() {
  useEffect(() => {
    applyDynamicTypeRootCap();

    function handleResume() {
      applyDynamicTypeRootCap();
    }

    window.addEventListener("pageshow", handleResume);
    document.addEventListener("visibilitychange", handleResume);

    return () => {
      window.removeEventListener("pageshow", handleResume);
      document.removeEventListener("visibilitychange", handleResume);
    };
  }, []);

  return null;
}
