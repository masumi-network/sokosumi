"use client";

import { createContext, useContext, useState } from "react";

interface CreateJobModalContextType {
  // modal open
  open: boolean;
  setOpen: (open: boolean) => void;
  handleClose: () => void;
  // create job form loading
  loading: boolean;
  setLoading: (loading: boolean) => void;
  // accordion
  isExpanded: boolean;
  accordionValue: string[];
  setAccordionValue: (accordionValue: string[]) => void;
  handleExpand: () => void;
  handleCollapse: () => void;
}

const initialState: CreateJobModalContextType = {
  open: false,
  setOpen: () => {},
  handleClose: () => {},
  loading: false,
  setLoading: () => {},
  isExpanded: false,
  accordionValue: ["information", "input"],
  setAccordionValue: () => {},
  handleExpand: () => {},
  handleCollapse: () => {},
};

export const CreateJobModalContext =
  createContext<CreateJobModalContextType>(initialState);

export function CreateJobModalContextProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [accordionValue, setAccordionValue] = useState<string[]>([
    "information",
    "input",
  ]);

  const handleExpand = () => {
    setAccordionValue(["information", "input"]);
  };

  const handleCollapse = () => {
    setAccordionValue([]);
  };

  const handleClose = () => {
    setOpen(false);
  };

  const value: CreateJobModalContextType = {
    open,
    setOpen,
    handleClose,
    loading,
    setLoading,
    isExpanded: accordionValue.length === 2,
    accordionValue,
    setAccordionValue,
    handleExpand,
    handleCollapse,
  };

  return (
    <CreateJobModalContext.Provider value={value}>
      {children}
    </CreateJobModalContext.Provider>
  );
}

export function useCreateJobModalContext() {
  const context = useContext(CreateJobModalContext);
  if (!context) {
    throw new Error(
      "useCreateJobModal must be used within a CreateJobModalProvider",
    );
  }
  return context;
}
