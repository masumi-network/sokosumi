"use client";

import { useState } from "react";

export interface AccountSummaryOpenState {
  isOpen: boolean;
  menuInstance: number;
  handleOpenChange: (open: boolean) => void;
  closeMenu: () => void;
}

/**
 * Open/close state for account summary popover shells (desktop chip + mobile
 * header). Remounts the menu (`key={menuInstance}`) only when opening so a
 * drill panel does not flash the credits root during exit animation.
 */
export function useAccountSummaryOpenState(): AccountSummaryOpenState {
  const [isOpen, setIsOpen] = useState(false);
  const [menuInstance, setMenuInstance] = useState(0);

  function handleOpenChange(open: boolean) {
    if (open) {
      setMenuInstance((value) => value + 1);
    }
    setIsOpen(open);
  }

  function closeMenu() {
    setIsOpen(false);
  }

  return {
    isOpen,
    menuInstance,
    handleOpenChange,
    closeMenu,
  };
}
