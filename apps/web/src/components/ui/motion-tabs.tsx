"use client";

import * as React from "react";

import { motion, type Transition, type HTMLMotionProps } from "motion/react";

import { cn } from "@/lib/utils";
import {
  MotionHighlight,
  MotionHighlightItem,
} from "@/components/ui/motion-highlight";

type TabsContextType<T extends string> = {
  activeValue: T;
  handleValueChange: (value: T) => void;
  registerTrigger: (value: T, node: HTMLElement | null) => void;
  /** Get ordered list of tab values for keyboard navigation */
  getTabValues: () => T[];
  /** Get the trigger element for a specific value */
  getTriggerElement: (value: T) => HTMLElement | null;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const TabsContext = React.createContext<TabsContextType<any> | undefined>(
  undefined,
);

function useTabs<T extends string = string>(): TabsContextType<T> {
  const context = React.useContext(TabsContext);

  if (!context) {
    throw new Error("useTabs must be used within a TabsProvider");
  }

  return context;
}

type BaseTabsProps = React.ComponentProps<"div"> & {
  children: React.ReactNode;
};

type UnControlledTabsProps<T extends string = string> = BaseTabsProps & {
  defaultValue?: T;
  value?: never;
  onValueChange?: never;
};

type ControlledTabsProps<T extends string = string> = BaseTabsProps & {
  value: T;
  onValueChange?: (value: T) => void;
  defaultValue?: never;
};

type TabsProps<T extends string = string> =
  | UnControlledTabsProps<T>
  | ControlledTabsProps<T>;

function Tabs<T extends string = string>({
  defaultValue,
  value,
  onValueChange,
  children,
  className,
  ...props
}: TabsProps<T>) {
  const [activeValue, setActiveValue] = React.useState<T | undefined>(
    defaultValue ?? undefined,
  );
  const triggersRef = React.useRef(new Map<string, HTMLElement>());
  const initialSet = React.useRef(false);
  const isControlled = value !== undefined;

  React.useEffect(() => {
    if (
      !isControlled &&
      activeValue === undefined &&
      triggersRef.current.size > 0 &&
      !initialSet.current
    ) {
      const firstTab = Array.from(triggersRef.current.keys())[0];

      setActiveValue(firstTab as T);
      initialSet.current = true;
    }
  }, [activeValue, isControlled]);

  const registerTrigger = (value: string, node: HTMLElement | null) => {
    if (node) {
      triggersRef.current.set(value, node);

      if (!isControlled && activeValue === undefined && !initialSet.current) {
        setActiveValue(value as T);
        initialSet.current = true;
      }
    } else {
      triggersRef.current.delete(value);
    }
  };

  const handleValueChange = (val: T) => {
    if (!isControlled) setActiveValue(val);
    else onValueChange?.(val);
  };

  const getTabValues = React.useCallback(() => {
    return Array.from(triggersRef.current.keys()) as T[];
  }, []);

  const getTriggerElement = React.useCallback((val: T) => {
    return triggersRef.current.get(val) ?? null;
  }, []);

  return (
    <TabsContext.Provider
      value={{
        activeValue: (value ?? activeValue)!,
        handleValueChange,
        registerTrigger,
        getTabValues,
        getTriggerElement,
      }}
    >
      <div
        data-slot="tabs"
        className={cn("flex flex-col gap-2", className)}
        {...props}
      >
        {children}
      </div>
    </TabsContext.Provider>
  );
}

type TabsListProps = React.ComponentProps<"div"> & {
  children: React.ReactNode;
  activeClassName?: string;
  transition?: Transition;
};

function TabsList({
  children,
  className,
  activeClassName,
  transition = {
    type: "spring",
    stiffness: 200,
    damping: 25,
  },
  ...props
}: TabsListProps) {
  const { activeValue } = useTabs();

  return (
    <MotionHighlight
      controlledItems
      className={cn("bg-background rounded-sm shadow-sm", activeClassName)}
      value={activeValue}
      transition={transition}
    >
      <div
        role="tablist"
        data-slot="tabs-list"
        className={cn(
          "bg-muted text-muted-foreground inline-flex h-10 w-fit items-center justify-center rounded-lg p-[4px]",
          className,
        )}
        {...props}
      >
        {children}
      </div>
    </MotionHighlight>
  );
}

type TabsTriggerProps = HTMLMotionProps<"button"> & {
  value: string;
  children: React.ReactNode;
};

function TabsTrigger({
  ref,
  value,
  children,
  className,
  disabled,
  ...props
}: TabsTriggerProps) {
  const {
    activeValue,
    handleValueChange,
    registerTrigger,
    getTabValues,
    getTriggerElement,
  } = useTabs();

  const localRef = React.useRef<HTMLButtonElement | null>(null);

  React.useImperativeHandle(ref, () => localRef.current as HTMLButtonElement);

  React.useEffect(() => {
    registerTrigger(value, localRef.current);

    return () => registerTrigger(value, null);
  }, [value, registerTrigger]);

  const handleClick = () => {
    if (disabled) return;
    handleValueChange(value);
  };

  const handleKeyDown = React.useCallback(
    (e: React.KeyboardEvent<HTMLButtonElement>) => {
      const tabValues = getTabValues();
      const currentIndex = tabValues.indexOf(value);

      if (currentIndex === -1) return;

      let nextIndex: number | null = null;

      switch (e.key) {
        case "ArrowRight":
          e.preventDefault();
          for (let i = currentIndex + 1; i < tabValues.length; i++) {
            const el = getTriggerElement(tabValues[i]);
            if (el && !el.hasAttribute("disabled")) {
              nextIndex = i;
              break;
            }
          }
          break;
        case "ArrowLeft":
          e.preventDefault();
          for (let i = currentIndex - 1; i >= 0; i--) {
            const el = getTriggerElement(tabValues[i]);
            if (el && !el.hasAttribute("disabled")) {
              nextIndex = i;
              break;
            }
          }
          break;
        case "Home":
          e.preventDefault();
          for (let i = 0; i < tabValues.length; i++) {
            const el = getTriggerElement(tabValues[i]);
            if (el && !el.hasAttribute("disabled")) {
              nextIndex = i;
              break;
            }
          }
          break;
        case "End":
          e.preventDefault();
          for (let i = tabValues.length - 1; i >= 0; i--) {
            const el = getTriggerElement(tabValues[i]);
            if (el && !el.hasAttribute("disabled")) {
              nextIndex = i;
              break;
            }
          }
          break;
      }

      if (nextIndex !== null) {
        const nextValue = tabValues[nextIndex];
        const nextElement = getTriggerElement(nextValue);
        if (nextElement) {
          handleValueChange(nextValue);
          nextElement.focus();
        }
      }
    },
    [value, getTabValues, getTriggerElement, handleValueChange],
  );

  const isActive = activeValue === value;

  return (
    <MotionHighlightItem
      value={value}
      className="size-full"
      disabled={disabled}
    >
      <motion.button
        ref={localRef}
        type="button"
        data-slot="tabs-trigger"
        role="tab"
        aria-selected={isActive}
        tabIndex={isActive ? 0 : -1}
        onClick={handleClick}
        onKeyDown={handleKeyDown}
        disabled={disabled}
        data-state={isActive ? "active" : "inactive"}
        className={cn(
          "ring-offset-background focus-visible:ring-ring z-1 inline-flex size-full cursor-pointer items-center justify-center rounded-sm px-2 py-1 text-sm font-medium whitespace-nowrap transition-transform focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50 data-[state=active]:text-white",
          className,
        )}
        {...props}
      >
        {children}
      </motion.button>
    </MotionHighlightItem>
  );
}

type TabsContentsProps = React.ComponentProps<"div"> & {
  children: React.ReactNode;
  transition?: Transition;
};

function TabsContents({
  children,
  className,
  transition = {
    type: "spring",
    stiffness: 300,
    damping: 30,
    bounce: 0,
    restDelta: 0.01,
  },
  ...props
}: TabsContentsProps) {
  const { activeValue } = useTabs();
  const childrenArray = React.Children.toArray(children);

  const foundIndex = childrenArray.findIndex(
    (child): child is React.ReactElement<{ value: string }> =>
      React.isValidElement(child) &&
      typeof child.props === "object" &&
      child.props !== null &&
      "value" in child.props &&
      child.props.value === activeValue,
  );

  const activeIndex = Math.max(0, foundIndex);

  const slideCount = Math.max(1, childrenArray.length);
  const panelWidthPercent = 100 / slideCount;
  const translatePercent = -(activeIndex * panelWidthPercent);

  const slideRefs = React.useRef<(HTMLDivElement | null)[]>([]);

  React.useEffect(() => {
    slideRefs.current.forEach((el, index) => {
      if (!el) return;
      const isInactive = index !== activeIndex;
      if (isInactive) {
        el.setAttribute("inert", "");
        el.setAttribute("aria-hidden", "true");
      } else {
        el.removeAttribute("inert");
        el.removeAttribute("aria-hidden");
      }
    });
  }, [activeIndex]);

  return (
    <div
      data-slot="tabs-contents"
      className={cn("-m-2 overflow-hidden", className)}
      {...props}
    >
      <motion.div
        className="flex"
        style={{ width: `${slideCount * 100}%` }}
        animate={{ x: `${translatePercent}%` }}
        transition={transition}
      >
        {childrenArray.map((child, index) => (
          <div
            key={index}
            ref={(el) => {
              slideRefs.current[index] = el;
            }}
            className="min-w-0 shrink-0 p-2"
            style={{ width: `${panelWidthPercent}%` }}
          >
            {child}
          </div>
        ))}
      </motion.div>
    </div>
  );
}

type TabsContentProps = HTMLMotionProps<"div"> & {
  value: string;
  children: React.ReactNode;
};

function TabsContent({
  children,
  value,
  className,
  ...props
}: TabsContentProps) {
  const { activeValue } = useTabs();
  const isActive = activeValue === value;

  return (
    <motion.div
      role="tabpanel"
      data-slot="tabs-content"
      className={cn("h-full overflow-hidden", className)}
      initial={{ filter: "blur(0px)" }}
      animate={{ filter: isActive ? "blur(0px)" : "blur(2px)" }}
      exit={{ filter: "blur(0px)" }}
      transition={{ type: "spring", stiffness: 300, damping: 20 }}
      {...props}
    >
      {children}
    </motion.div>
  );
}

export {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContents,
  TabsContent,
  useTabs,
  type TabsContextType,
  type TabsProps,
  type TabsListProps,
  type TabsTriggerProps,
  type TabsContentsProps,
  type TabsContentProps,
};
