"use client";

import { createContext, ReactNode, useContext, useState } from "react";

export interface ModalContextType<TItem, TAction> {
  open: boolean;
  setOpen: (open: boolean) => void;
  loading: boolean;
  setLoading: (loading: boolean) => void;
  selectedItem: TItem | null;
  selectedAction: TAction | null;
  openActionModal: (item: TItem, action: TAction) => void;
  closeActionModal: () => void;
  startAction: () => Promise<void>;
}

interface ModalContextProviderProps<TItem, TAction> {
  children: ReactNode;
  onAction: (item: TItem, action: TAction) => Promise<{ error?: unknown }>;
  onSuccess?: (action: TAction) => void;
  onError?: (action: TAction, error: unknown) => void;
}

export function createModalContext<TItem, TAction>() {
  const Context = createContext<ModalContextType<TItem, TAction> | undefined>(
    undefined,
  );

  function Provider({
    children,
    onAction,
    onSuccess,
    onError,
  }: ModalContextProviderProps<TItem, TAction>) {
    const [open, setOpen] = useState(false);
    const [loading, setLoading] = useState(false);
    const [selectedItem, setSelectedItem] = useState<TItem | null>(null);
    const [selectedAction, setSelectedAction] = useState<TAction | null>(null);

    const openActionModal = (item: TItem, action: TAction) => {
      if (open) return;
      setSelectedItem(item);
      setSelectedAction(action);
      setOpen(true);
    };

    const closeActionModal = () => {
      if (loading) return;
      setSelectedItem(null);
      setSelectedAction(null);
      setOpen(false);
    };

    const startAction = async () => {
      if (!selectedItem || !selectedAction) return;
      setLoading(true);
      const result = await onAction(selectedItem, selectedAction);
      if (result.error) {
        onError?.(selectedAction, result.error);
      } else {
        onSuccess?.(selectedAction);
        setOpen(false);
      }
      setLoading(false);
    };

    const value: ModalContextType<TItem, TAction> = {
      open,
      setOpen,
      loading,
      setLoading,
      selectedItem,
      selectedAction,
      openActionModal,
      closeActionModal,
      startAction,
    };

    return <Context.Provider value={value}>{children}</Context.Provider>;
  }

  function useModalContext() {
    const context = useContext(Context);
    if (!context) {
      throw new Error(
        "useModalContext must be used within a ModalContextProvider",
      );
    }
    return context;
  }

  return { Provider, useModalContext };
}
