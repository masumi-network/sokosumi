import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { loadCatalog, importProducts, saveCatalog, attachPhoto } = vi.hoisted(
  () => ({
    loadCatalog: vi.fn(),
    importProducts: vi.fn(),
    saveCatalog: vi.fn(),
    attachPhoto: vi.fn(),
  }),
);
const { uploadPhoto } = vi.hoisted(() => ({ uploadPhoto: vi.fn() }));

vi.mock("@/lib/auth/auth.client", () => ({
  authClient: {
    getSession: async () => ({
      data: { session: { activeOrganizationId: "workspace-org" } },
    }),
  },
}));

vi.mock("@/lib/utils/drive-file-upload.client", () => ({
  isDriveFileUploadDuplicate: () => false,
  uploadDriveFile: uploadPhoto,
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("@/lib/actions/image-studio/product-catalog", () => ({
  attachStudioCatalogPhoto: attachPhoto,
  getStudioProducts: loadCatalog,
  importStudioProducts: importProducts,
  saveStudioProducts: saveCatalog,
}));

import { StudioProductCatalogDialog } from "./studio-product-catalog";

describe("Studio product catalog", () => {
  beforeEach(() => vi.resetAllMocks());

  it("imports a draft, saves reviewed details with the loaded revision, and uses the product", async () => {
    const original = {
      id: "product-one",
      name: "Clay mug",
      description: "Glazed stoneware",
      price: "19.00",
      url: "https://store.example.com/products/clay-mug",
      imageUrl: "https://store.example.com/photos/mug.png",
    };
    const edited = { ...original, price: "EUR 21.00" };
    loadCatalog.mockResolvedValueOnce({ revision: 3, products: [] });
    importProducts.mockResolvedValueOnce({ products: [original] });
    saveCatalog.mockResolvedValueOnce({ revision: 4, products: [edited] });
    const photo = { id: "file-one", name: edited.name };
    attachPhoto.mockResolvedValueOnce(photo);
    const onUseProduct = vi.fn();
    render(
      <StudioProductCatalogDialog
        onUseProduct={onUseProduct}
        projectId="project-a"
        websiteUrl="https://store.example.com/"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "title" }));
    const importButton = await screen.findByRole("button", { name: "import" });
    await waitFor(() => expect(importButton).toBeEnabled());
    fireEvent.click(importButton);
    expect(await screen.findByLabelText("name")).toHaveValue("Clay mug");
    expect(importProducts).toHaveBeenCalledWith({
      projectId: "project-a",
      url: "https://store.example.com/",
    });
    expect(saveCatalog).not.toHaveBeenCalled();

    const price = screen.getByLabelText("price");
    await waitFor(() => expect(price).toBeEnabled());
    fireEvent.change(price, {
      target: { value: "EUR 21.00" },
    });
    const save = screen.getByRole("button", { name: "save" });
    await waitFor(() => expect(save).toBeEnabled());
    fireEvent.click(save);
    await waitFor(() =>
      expect(saveCatalog).toHaveBeenCalledWith({
        projectId: "project-a",
        catalog: { revision: 3, products: [edited] },
      }),
    );
    await screen.findByText("saved");
    const use = screen.getByRole("button", { name: "use" });
    await waitFor(() => expect(use).toBeEnabled());
    fireEvent.click(use);
    await waitFor(() =>
      expect(onUseProduct).toHaveBeenCalledExactlyOnceWith(edited, photo),
    );
    expect(attachPhoto).toHaveBeenCalledWith({
      projectId: "project-a",
      name: edited.name,
      imageUrl: edited.imageUrl,
    });
  });

  it("keeps draft edits after a failed save until the user reloads the saved catalog", async () => {
    const original = {
      id: "product-a",
      name: "Vase",
      description: "",
      price: "",
      url: null,
      imageUrl: null,
    };
    loadCatalog
      .mockResolvedValueOnce({ revision: 1, products: [original] })
      .mockResolvedValueOnce({
        revision: 2,
        products: [{ ...original, name: "Updated vase" }],
      });
    saveCatalog.mockRejectedValueOnce(new Error("Catalog changed"));

    render(
      <StudioProductCatalogDialog
        projectId="project-a"
        onUseProduct={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "title" }));
    const name = await screen.findByLabelText("name");
    await waitFor(() => expect(name).toBeEnabled());
    fireEvent.change(name, {
      target: { value: "Local edits" },
    });
    const save = screen.getByRole("button", { name: "save" });
    await waitFor(() => expect(save).toBeEnabled());
    fireEvent.click(save);
    const reload = await screen.findByRole("button", {
      name: "discardAndReload",
    });
    expect(screen.getByLabelText("name")).toHaveValue("Local edits");

    await waitFor(() => expect(reload).toBeEnabled());
    fireEvent.click(reload);
    await waitFor(() =>
      expect(screen.getByLabelText("name")).toHaveValue("Updated vase"),
    );
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "save" })).toBeDisabled(),
    );
  });

  it("saves an uploaded product photo and reuses it in a later batch", async () => {
    const product = {
      id: "mug",
      name: "Mug",
      description: "",
      price: "",
      url: null,
      imageUrl: "https://store.example.com/old-photo.png",
    };
    const photo = { id: "file-mug", name: "mug.png" };
    const saved = { ...product, photo, imageUrl: null };
    loadCatalog
      .mockResolvedValueOnce({ revision: 1, products: [product] })
      .mockResolvedValueOnce({ revision: 2, products: [saved] });
    uploadPhoto.mockResolvedValueOnce({ resourceId: photo.id });
    saveCatalog.mockResolvedValueOnce({ revision: 2, products: [saved] });
    const onUseBatch = vi.fn();
    render(
      <StudioProductCatalogDialog
        projectId="project-a"
        onUseProduct={vi.fn()}
        onUseBatch={onUseBatch}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "title" }));
    const input = await screen.findByLabelText("productPhoto");
    await waitFor(() => expect(input).toBeEnabled());
    fireEvent.change(input, {
      target: {
        files: [new File(["image"], photo.name, { type: "image/png" })],
      },
    });
    expect(await screen.findByText(photo.name)).toBeInTheDocument();

    const save = screen.getByRole("button", { name: "save" });
    await waitFor(() => expect(save).toBeEnabled());
    fireEvent.click(save);
    await screen.findByText("saved");
    expect(saveCatalog).toHaveBeenCalledWith({
      projectId: "project-a",
      catalog: { revision: 1, products: [saved] },
    });
    const close = screen.getByRole("button", { name: "close" });
    await waitFor(() => expect(close).toBeEnabled());
    fireEvent.click(close);

    fireEvent.click(screen.getByRole("button", { name: "title" }));
    const add = await screen.findByRole("button", { name: "addToBatch" });
    await waitFor(() => expect(add).toBeEnabled());
    fireEvent.click(add);
    fireEvent.click(screen.getByRole("button", { name: "useBatch" }));

    expect(onUseBatch).toHaveBeenCalledExactlyOnceWith([
      { product: saved, photo, copies: 1 },
    ]);
    expect(uploadPhoto).toHaveBeenCalledTimes(1);
    expect(attachPhoto).not.toHaveBeenCalled();
  });

  it("chooses products with separate copy counts and prepares only their photos", async () => {
    const vase = {
      id: "vase",
      name: "Vase",
      description: "",
      price: "",
      url: null,
      imageUrl: "https://store.example.com/vase.png",
    };
    const mug = { ...vase, id: "mug", name: "Mug", imageUrl: null };
    const photo = { id: "vase-file", name: "Vase photo" };
    loadCatalog.mockResolvedValueOnce({ revision: 1, products: [vase, mug] });
    attachPhoto.mockResolvedValueOnce(photo);
    const onUseBatch = vi.fn();
    render(
      <StudioProductCatalogDialog
        projectId="project-a"
        onUseProduct={vi.fn()}
        onUseBatch={onUseBatch}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "title" }));
    const add = await screen.findByRole("button", { name: "addToBatch" });
    await waitFor(() => expect(add).toBeEnabled());
    fireEvent.click(add);
    const batch = screen.getByRole("region", { name: "batchTitle" });
    fireEvent.change(
      within(batch).getByRole("combobox", { name: "copiesFor" }),
      { target: { value: "2" } },
    );
    fireEvent.change(screen.getByRole("combobox", { name: "product" }), {
      target: { value: mug.id },
    });
    fireEvent.click(screen.getByRole("button", { name: "addToBatch" }));
    fireEvent.click(screen.getByRole("button", { name: "useBatch" }));

    await waitFor(() =>
      expect(onUseBatch).toHaveBeenCalledExactlyOnceWith([
        { product: vase, photo, copies: 2 },
        { product: mug, photo: null, copies: 1 },
      ]),
    );
    expect(attachPhoto).toHaveBeenLastCalledWith({
      projectId: "project-a",
      name: "Vase",
      imageUrl: vase.imageUrl,
    });
  });

  it("discards a batch if the dialog is closed during photo preparation", async () => {
    const vase = {
      id: "vase",
      name: "Vase",
      description: "",
      price: "",
      url: null,
      imageUrl: "https://store.example.com/vase.png",
    };
    loadCatalog.mockResolvedValueOnce({ revision: 1, products: [vase] });
    const photo = Promise.withResolvers<{ id: string; name: string }>();
    attachPhoto.mockReturnValueOnce(photo.promise);
    const onUseBatch = vi.fn();
    render(
      <StudioProductCatalogDialog
        projectId="project-a"
        onUseProduct={vi.fn()}
        onUseBatch={onUseBatch}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "title" }));
    const add = await screen.findByRole("button", { name: "addToBatch" });
    await waitFor(() => expect(add).toBeEnabled());
    fireEvent.click(add);
    fireEvent.click(screen.getByRole("button", { name: "useBatch" }));
    expect(attachPhoto).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "close" }));

    await act(async () => photo.resolve({ id: "vase-file", name: "Vase" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(onUseBatch).not.toHaveBeenCalled();
  });
});
