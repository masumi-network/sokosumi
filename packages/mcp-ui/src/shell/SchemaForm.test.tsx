import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { InputSchema, SchemaForm } from "./SchemaForm.tsx";

const optional = [{ validation: "optional", value: "true" }];

const FIELDS = [
  {
    id: "topic",
    type: "string",
    name: "Topic",
    data: { description: "What to research" },
    validations: [{ validation: "min", value: 3 }],
  },
  {
    id: "email",
    type: "email",
    name: "Reply to",
    validations: [...optional, { validation: "format", value: "email" }],
  },
  {
    id: "pages",
    type: "number",
    name: "Pages",
    data: { default: 2 },
    validations: [
      { validation: "min", value: 1 },
      { validation: "max", value: 10 },
      { validation: "format", value: "integer" },
    ],
  },
  { id: "deep", type: "checkbox", name: "Deep dive", data: {} },
  {
    id: "tone",
    type: "radio",
    name: "Tone",
    data: { values: ["Formal", "Friendly"], default: "Friendly" },
  },
  {
    id: "markets",
    type: "multiselect",
    name: "Markets",
    data: { values: ["DE", "AT", "CH"] },
    validations: [
      { validation: "min", value: 1 },
      { validation: "max", value: 2 },
    ],
  },
  { id: "brief", type: "file", name: "Brief", data: { outputFormat: "url" } },
  { id: "ref", type: "hidden", name: "Ref", data: { value: "mcp" } },
  { id: "note", type: "none", name: "Results arrive by email." },
];
const SCHEMA = InputSchema.parse({ input_data: FIELDS });

function renderForm(
  schema = SCHEMA,
  props: Partial<Parameters<typeof SchemaForm>[0]> = {},
) {
  const onSubmit = vi.fn();
  render(
    <SchemaForm
      schema={schema}
      submitLabel="Review"
      onSubmit={onSubmit}
      {...props}
    />,
  );
  return onSubmit;
}

const field = (name: string) => screen.getByLabelText(name, { exact: false });
const type = (name: string, value: string) =>
  fireEvent.change(field(name), { target: { value } });
const submit = () =>
  fireEvent.click(screen.getByRole("button", { name: "Review" }));

afterEach(cleanup);

describe("SchemaForm", () => {
  it("renders each field with its label and description", () => {
    renderForm(InputSchema.parse({ input_data: FIELDS.slice(0, 6) }));

    expect(field("Topic").getAttribute("type")).toBe("text");
    expect(field("Topic").getAttribute("aria-describedby")).toBeTruthy();
    expect(screen.getByText("What to research")).toBeTruthy();
    expect(field("Reply to").getAttribute("type")).toBe("email");
    expect(screen.getByText("Optional")).toBeTruthy();
    expect((field("Pages") as HTMLInputElement).value).toBe("2");
    expect((field("Deep dive") as HTMLInputElement).checked).toBe(false);
    const tone = screen.getByRole("group", { name: "Tone" });
    expect(
      (within(tone).getByLabelText("Friendly") as HTMLInputElement).checked,
    ).toBe(true);
    expect(
      within(screen.getByRole("group", { name: /Markets/ })).getAllByRole(
        "checkbox",
      ),
    ).toHaveLength(3);
  });

  it("shows inline errors, focuses the first and does not submit", () => {
    const onSubmit = renderForm(
      InputSchema.parse({ input_data: FIELDS.slice(0, 6) }),
    );
    type("Topic", "ab");
    type("Reply to", "not-an-email");
    type("Pages", "2.5");
    submit();

    expect(onSubmit).not.toHaveBeenCalled();
    expect(field("Topic").getAttribute("aria-invalid")).toBe("true");
    expect(document.activeElement).toBe(field("Topic"));
    expect(screen.getByText("Enter at least 3 characters.")).toBeTruthy();
    expect(screen.getByText("Enter an email address.")).toBeTruthy();
    expect(screen.getByText("Enter a whole number.")).toBeTruthy();
    expect(screen.getByText("Choose at least 1.")).toBeTruthy();

    type("Pages", "11");
    submit();
    expect(screen.getByText("Enter 10 or less.")).toBeTruthy();
  });

  it("submits on Enter in a single-line field, since hosts block form submission", () => {
    const onSubmit = renderForm(
      InputSchema.parse({
        input_data: [{ id: "topic", type: "text", name: "Topic" }],
      }),
    );
    type("Topic", "Pricing");
    fireEvent.keyDown(field("Topic"), { key: "Enter" });

    expect(onSubmit).toHaveBeenCalledWith({ topic: "Pricing" });
  });

  it("requires a field that is not optional", () => {
    const onSubmit = renderForm(
      InputSchema.parse({
        input_data: [{ id: "topic", type: "textarea", name: "Topic" }],
      }),
    );
    type("Topic", "   ");
    submit();

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText("Required.")).toBeTruthy();
  });

  it("submits typed values the way Web does, leaving out empty optional fields", () => {
    const onSubmit = renderForm(
      InputSchema.parse({
        input_data: FIELDS.filter(({ type }) => type !== "file"),
      }),
    );
    type("Topic", "Pricing in DACH");
    fireEvent.click(field("Deep dive"));
    fireEvent.click(screen.getByLabelText("AT"));
    fireEvent.click(screen.getByLabelText("CH"));
    submit();

    expect(onSubmit).toHaveBeenCalledWith({
      topic: "Pricing in DACH",
      pages: 2,
      deep: true,
      tone: [1],
      markets: [1, 2],
      ref: "mcp",
    });
  });

  it("sends people to Sokosumi for a file and blocks a required one", () => {
    const onUpload = vi.fn();
    const onSubmit = renderForm(
      InputSchema.parse({
        input_data: [
          {
            id: "brief",
            type: "file",
            name: "Brief",
            data: { outputFormat: "url" },
          },
        ],
      }),
      { onUpload },
    );
    expect(screen.queryByLabelText("Brief")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Upload in Sokosumi" }));
    expect(onUpload).toHaveBeenCalledOnce();

    submit();
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText("Add this file in Sokosumi.")).toBeTruthy();
  });

  it("skips an optional file", () => {
    const onSubmit = renderForm(
      InputSchema.parse({
        input_data: [
          {
            id: "brief",
            type: "file",
            name: "Brief",
            data: { outputFormat: "url" },
            validations: optional,
          },
        ],
      }),
    );
    expect(screen.getByText(/Upload files in Sokosumi/)).toBeTruthy();
    submit();
    expect(onSubmit).toHaveBeenCalledWith({});
  });

  it("titles each group of a grouped schema", () => {
    renderForm(
      InputSchema.parse({
        input_groups: [
          {
            id: "about",
            title: "About you",
            input_data: [{ id: "name", type: "text", name: "Name" }],
          },
        ],
      }),
    );
    expect(screen.getByRole("group", { name: "About you" })).toBeTruthy();
    expect(field("Name")).toBeTruthy();
  });

  it("restores the values it is given", () => {
    renderForm(undefined, { initial: { topic: "Kept", markets: [0] } });
    expect((field("Topic") as HTMLInputElement).value).toBe("Kept");
    expect((screen.getByLabelText("DE") as HTMLInputElement).checked).toBe(
      true,
    );
  });

  it("renders untrusted field text as text", () => {
    const html = '<img src=x onerror="alert(1)">';
    renderForm(
      InputSchema.parse({
        input_data: [
          {
            id: "x",
            type: "option",
            name: html,
            data: { values: [html], description: html, placeholder: html },
          },
        ],
      }),
    );
    expect(document.querySelector("img")).toBeNull();
    expect(screen.getAllByText(html).length).toBeGreaterThanOrEqual(2);
  });
});
