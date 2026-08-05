"use client";

import { useEffect } from "react";

import { applyDynamicTypeRootCap } from "@/lib/utils/dynamic-type";

export function DynamicTypeRootCap() {
  useEffect(() => {
    applyDynamicTypeRootCap();

    function handlePageshow() {
      applyDynamicTypeRootCap();
    }

    function handleVisibilityChange() {
      if (document.visibilityState !== "visible") return;
      applyDynamicTypeRootCap();
    }

    window.addEventListener("pageshow", handlePageshow);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.removeEventListener("pageshow", handlePageshow);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  return null;
}
