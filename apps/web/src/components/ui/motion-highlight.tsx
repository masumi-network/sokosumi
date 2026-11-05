"use client";

import * as React from "react";

import { AnimatePresence, motion, type Transition } from "motion/react";

import { cn } from "@/lib/utils";

type MotionHighlightContextType = {
  activeValue: string | null;
  setActiveValue: (value: string | null) => void;
  id: string;
  className?: string;
  transition?: Transition;
  disabled?: boolean;
  enabled?: boolean;
  exitDelay?: number;
};

const MotionHighlightContext = React.createContext<
  MotionHighlightContextType | undefined
>(undefined);

function useMotionHighlight(): MotionHighlightContextType {
  const context = React.useContext(MotionHighlightContext);

  if (!context) {
    throw new Error(
      "useMotionHighlight must be used within a MotionHighlightProvider",
    );
  }

  return context;
}

interface MotionHighlightProps<T extends string> {
  controlledItems: true;
  value?: T | null;
  defaultValue?: T | null;
  onValueChange?: (value: string | null) => void;
  className?: string;
  transition?: Transition;
  disabled?: boolean;
  enabled?: boolean;
  exitDelay?: number;
  children: React.ReactNode;
}

function MotionHighlight<T extends string>({
  children,
  value,
  defaultValue,
  onValueChange,
  className,
  transition = { type: "spring", stiffness: 350, damping: 35 },
  enabled = true,
  disabled = false,
  exitDelay = 0.2,
}: MotionHighlightProps<T>) {
  const [activeValue, setActiveValue] = React.useState<string | null>(
    value ?? defaultValue ?? null,
  );

  const safeSetActiveValue = React.useCallback(
    (id: string | null) => {
      setActiveValue((prev) => (prev === id ? prev : id));
      if (id !== activeValue) onValueChange?.(id);
    },
    [activeValue, onValueChange],
  );

  React.useLayoutEffect(() => {
    if (value !== undefined) setActiveValue(value);
    else if (defaultValue !== undefined) setActiveValue(defaultValue);
  }, [value, defaultValue]);

  const id = React.useId();

  return (
    <MotionHighlightContext.Provider
      value={{
        activeValue,
        setActiveValue: safeSetActiveValue,
        id,
        className,
        transition,
        disabled,
        enabled,
        exitDelay,
      }}
    >
      {children}
    </MotionHighlightContext.Provider>
  );
}

function getNonOverridingDataAttributes(
  element: React.ReactElement,
  dataAttributes: Record<string, unknown>,
): Record<string, unknown> {
  return Object.keys(dataAttributes).reduce<Record<string, unknown>>(
    (acc, key) => {
      if ((element.props as Record<string, unknown>)[key] === undefined) {
        acc[key] = dataAttributes[key];
      }

      return acc;
    },
    {},
  );
}

type ExtendedChildProps = React.ComponentProps<"div"> & {
  id?: string;
  ref?: React.Ref<HTMLElement>;
  "data-active"?: string;
  "data-value"?: string;
  "data-disabled"?: boolean;
  "data-highlight"?: boolean;
  "data-slot"?: string;
};

type MotionHighlightItemProps = React.ComponentProps<"div"> & {
  children: React.ReactElement;
  id?: string;
  value?: string;
  className?: string;
  transition?: Transition;
  activeClassName?: string;
  disabled?: boolean;
  exitDelay?: number;
};

function MotionHighlightItem({
  ref,
  children,
  id,
  value,
  className,
  transition,
  disabled = false,
  activeClassName,
  exitDelay,
  ...props
}: MotionHighlightItemProps) {
  const itemId = React.useId();

  const {
    activeValue,
    setActiveValue,
    enabled,
    className: contextClassName,
    transition: contextTransition,
    id: contextId,
    disabled: contextDisabled,
    exitDelay: contextExitDelay,
  } = useMotionHighlight();

  const element = children as React.ReactElement<ExtendedChildProps>;
  const childValue =
    id ?? value ?? element.props?.["data-value"] ?? element.props?.id ?? itemId;
  const isActive = activeValue === childValue;
  const isDisabled = disabled === undefined ? contextDisabled : disabled;
  const itemTransition = transition ?? contextTransition;

  const localRef = React.useRef<HTMLDivElement>(null);

  React.useImperativeHandle(ref, () => localRef.current as HTMLDivElement);

  if (!React.isValidElement(children)) return children;

  const dataAttributes = {
    "data-active": isActive ? "true" : "false",
    "aria-selected": isActive,
    "data-disabled": isDisabled,
    "data-value": childValue,
    "data-highlight": true,
  };

  // Check if the child element is disabled (e.g., a disabled button)
  const childDisabled = (element.props as { disabled?: boolean })?.disabled;

  // Don't attach click handlers when the child element is disabled
  // This prevents bypassing native disabled behavior on buttons
  const commonHandlers =
    childDisabled || isDisabled
      ? {}
      : {
          onClick: (e: React.MouseEvent<HTMLDivElement>) => {
            setActiveValue(childValue);
            element.props.onClick?.(e);
          },
        };

  return enabled ? (
    <div
      key={childValue}
      ref={localRef}
      data-slot="motion-highlight-item-container"
      className={cn("relative", className)}
      {...dataAttributes}
      {...props}
      {...commonHandlers}
    >
      <AnimatePresence initial={false}>
        {isActive && !isDisabled && (
          <motion.div
            layoutId={`transition-background-${contextId}`}
            data-slot="motion-highlight"
            className={cn(
              "bg-muted absolute inset-0 z-0",
              contextClassName,
              activeClassName,
            )}
            transition={itemTransition}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{
              opacity: 0,
              transition: {
                ...itemTransition,
                delay:
                  (itemTransition?.delay ?? 0) +
                  (exitDelay ?? contextExitDelay ?? 0),
              },
            }}
            {...dataAttributes}
          />
        )}
      </AnimatePresence>

      {React.cloneElement(element, {
        className: cn("relative z-[1]", element.props.className),
        ...getNonOverridingDataAttributes(element, {
          ...dataAttributes,
          "data-slot": "motion-highlight-item",
        }),
      })}
    </div>
  ) : (
    children
  );
}

export {
  MotionHighlight,
  MotionHighlightItem,
  type MotionHighlightProps,
  type MotionHighlightItemProps,
};
