import type { SidebarLayout } from "@sokosumi/core-client";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { useState } from "react";
import { expect, it } from "vitest";
import messages from "@/messages/en.json";
import { SidebarLayoutEditor } from "./sidebar-layout-editor";

const start: SidebarLayout = {
  sections: [
    { id: "work", name: "Work", items: ["tasks", "gated"] },
    { id: "chats", name: "Chats", items: ["channels"] },
  ],
  hidden: [],
};

function TestEditor({ unread }: { unread: number }) {
  const [layout, setLayout] = useState(start);
  return (
    <NextIntlClientProvider
      locale="en"
      timeZone="UTC"
      messages={{ App: { Sidebar: { Layout: messages.App.Sidebar.Layout } } }}
    >
      <SidebarLayoutEditor
        layout={layout}
        features={[
          {
            id: "tasks",
            defaultSection: "work",
            label: "Tasks",
            available: true,
          },
          {
            id: "gated",
            defaultSection: "work",
            label: "Unavailable feature",
            available: false,
          },
          {
            id: "channels",
            defaultSection: "chats",
            label: "Channels",
            available: true,
            hasContent: unread > 0,
          },
        ]}
        sectionLabel={(section) => section.name ?? section.id}
        renderItem={(id) =>
          id === "channels" ? (
            <div>Design · {unread} unread</div>
          ) : (
            <div>Tasks</div>
          )
        }
        onChange={(next) => setLayout(next ?? start)}
        onSave={() => {}}
        onCancel={() => {}}
      />
    </NextIntlClientProvider>
  );
}

it("moves a live collection to another section by keyboard and keeps its preview current", () => {
  const { rerender } = render(<TestEditor unread={1} />);
  fireEvent.keyDown(screen.getByRole("button", { name: "Reorder Channels" }), {
    key: "ArrowLeft",
  });
  expect(screen.getByText("Channels, Work, 2 of 2.")).toBeInTheDocument();
  expect(
    screen.getByText("Drop a feature here or add one from the section menu."),
  ).toBeInTheDocument();
  expect(screen.queryByText("Unavailable feature")).not.toBeInTheDocument();
  rerender(<TestEditor unread={3} />);
  expect(screen.getByText("Design · 3 unread")).toBeInTheDocument();
  rerender(<TestEditor unread={0} />);
  expect(
    screen.getByRole("button", { name: "Reorder Channels" }),
  ).toBeInTheDocument();
  expect(screen.queryByText("Design · 3 unread")).not.toBeInTheDocument();
});

it("allows the first feature to be placed into a new, named section while editing", () => {
  render(<TestEditor unread={0} />);
  fireEvent.click(screen.getByRole("button", { name: "Add section" }));
  const dialog = screen.getByRole("dialog");
  fireEvent.change(
    within(dialog).getByRole("textbox", { name: "Section name" }),
    { target: { value: "  Team  " } },
  );
  fireEvent.click(within(dialog).getByRole("button", { name: "Add section" }));
  expect(screen.getByRole("heading", { name: "Team" })).toBeInTheDocument();
  fireEvent.keyDown(screen.getByRole("button", { name: "Reorder Channels" }), {
    key: "ArrowRight",
  });
  expect(screen.getByText("Channels, Team, 1 of 1.")).toBeInTheDocument();
});
