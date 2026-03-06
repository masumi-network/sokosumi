"use client";

import * as React from "react";
import { Collapsible as CollapsiblePrimitive } from "radix-ui";

const CollapsibleContentIdContext = React.createContext<string | undefined>(
  undefined,
);

function useCollapsibleContentId() {
  return React.useContext(CollapsibleContentIdContext);
}

function Collapsible({
  ...props
}: React.ComponentProps<typeof CollapsiblePrimitive.Root>) {
  const contentId = React.useId();

  return (
    <CollapsibleContentIdContext.Provider value={contentId}>
      <CollapsiblePrimitive.Root data-slot="collapsible" {...props} />
    </CollapsibleContentIdContext.Provider>
  );
}

function CollapsibleTrigger({
  ...props
}: React.ComponentProps<typeof CollapsiblePrimitive.CollapsibleTrigger>) {
  const contentId = useCollapsibleContentId();

  return (
    <CollapsiblePrimitive.CollapsibleTrigger
      data-slot="collapsible-trigger"
      aria-controls={contentId}
      {...props}
    />
  );
}

function CollapsibleContent({
  ...props
}: React.ComponentProps<typeof CollapsiblePrimitive.CollapsibleContent>) {
  const contentId = useCollapsibleContentId();

  return (
    <CollapsiblePrimitive.CollapsibleContent
      data-slot="collapsible-content"
      id={contentId}
      {...props}
    />
  );
}

export { Collapsible, CollapsibleTrigger, CollapsibleContent };
