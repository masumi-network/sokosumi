import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createTranslator, NextIntlClientProvider } from "next-intl";
import { describe, expect, it } from "vitest";
import de from "../../../../messages/de.json";
import en from "../../../../messages/en.json";
import es from "../../../../messages/es.json";
import { AttachmentSubmenu } from "../attachment-submenu";

const catalogs = { en, de, es } as const;

const expected = {
  en: {
    breadcrumb: "Files",
    myDrive: "My Files",
    selectTitle: "Select from Files",
    fromDrive: "From Files",
    uploadFile: "Upload from device",
    menu: "Files",
    copyToFilesAction: "Copy to Files",
    copyToFilesDialogTitle: "Copy to Files?",
    copyToFilesDialogDescription: "Copy report.pdf to My Files.",
  },
  de: {
    breadcrumb: "Dateien",
    myDrive: "Meine Dateien",
    selectTitle: "Aus Dateien auswählen",
    fromDrive: "Aus Dateien",
    uploadFile: "Vom Gerät hochladen",
    menu: "Dateien",
    copyToFilesAction: "In Dateien kopieren",
    copyToFilesDialogTitle: "In Dateien kopieren?",
    copyToFilesDialogDescription: "report.pdf nach Meine Dateien kopieren.",
  },
  es: {
    breadcrumb: "Archivos",
    myDrive: "Mis archivos",
    selectTitle: "Seleccionar desde Archivos",
    fromDrive: "Desde Archivos",
    uploadFile: "Subir desde el dispositivo",
    menu: "Archivos",
    copyToFilesAction: "Copiar a Archivos",
    copyToFilesDialogTitle: "¿Copiar a Archivos?",
    copyToFilesDialogDescription: "Copiar report.pdf a Mis archivos.",
  },
} as const;

describe("Drive UI copy", () => {
  it.each(Object.keys(expected) as Array<keyof typeof expected>)(
    "resolves Files labels in %s",
    (locale) => {
      const messages = catalogs[locale];
      const drive = createTranslator({
        locale,
        messages,
        namespace: "App.Drive",
      });
      const menu = createTranslator({
        locale,
        messages,
        namespace: "App.Sidebar.Content.MenuItems",
      });
      const crumb = createTranslator({
        locale,
        messages,
        namespace: "Components.Breadcrumb",
      });
      const want = expected[locale];

      expect(crumb("drive")).toBe(want.menu);
      expect(menu("drive")).toBe(want.menu);
      expect(drive("breadcrumb")).toBe(want.breadcrumb);
      expect(drive("myDrive")).toBe(want.myDrive);
      expect(drive("selectTitle")).toBe(want.selectTitle);
      expect(drive("fromDrive")).toBe(want.fromDrive);
      expect(drive("uploadFile")).toBe(want.uploadFile);
      expect(drive("copyToFilesAction")).toBe(want.copyToFilesAction);
      expect(drive("copyToFilesDialogTitle")).toBe(want.copyToFilesDialogTitle);
      expect(
        drive("copyToFilesDialogDescription", {
          fileName: "report.pdf",
          workspace: want.myDrive,
        }),
      ).toBe(want.copyToFilesDialogDescription);
    },
  );

  it("shows Upload from device and From Files in the paperclip submenu", async () => {
    const user = userEvent.setup();
    render(
      <NextIntlClientProvider locale="en" messages={en}>
        <AttachmentSubmenu
          onUploadClick={() => undefined}
          onDriveClick={() => undefined}
        >
          <button type="button">Attach</button>
        </AttachmentSubmenu>
      </NextIntlClientProvider>,
    );

    await user.click(screen.getByRole("button", { name: "Attach" }));

    expect(
      await screen.findByRole("menuitem", { name: /Upload from device/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("menuitem", { name: /From Files/ }),
    ).toBeInTheDocument();
    expect(screen.queryByText("From Drive")).not.toBeInTheDocument();
    expect(screen.queryByText("Drive")).not.toBeInTheDocument();
  });
});
