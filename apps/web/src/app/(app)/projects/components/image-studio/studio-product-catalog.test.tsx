import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const { loadCatalog, importProducts, saveCatalog, attachPhoto } = vi.hoisted(
  () => ({
    loadCatalog: vi.fn(),
    importProducts: vi.fn(),
    saveCatalog: vi.fn(),
    attachPhoto: vi.fn(),
  }),
);

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
    fireEvent.click(await screen.findByRole("button", { name: "import" }));
    expect(await screen.findByLabelText("name")).toHaveValue("Clay mug");
    expect(importProducts).toHaveBeenCalledWith({
      projectId: "project-a",
      url: "https://store.example.com/",
    });
    expect(saveCatalog).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("price"), {
      target: { value: "EUR 21.00" },
    });
    fireEvent.click(screen.getByRole("button", { name: "save" }));
    await waitFor(() =>
      expect(saveCatalog).toHaveBeenCalledWith({
        projectId: "project-a",
        catalog: { revision: 3, products: [edited] },
      }),
    );
    await screen.findByText("saved");
    fireEvent.click(screen.getByRole("button", { name: "use" }));
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
    fireEvent.change(await screen.findByLabelText("name"), {
      target: { value: "Local edits" },
    });
    fireEvent.click(screen.getByRole("button", { name: "save" }));
    const reload = await screen.findByRole("button", {
      name: "discardAndReload",
    });
    expect(screen.getByLabelText("name")).toHaveValue("Local edits");

    fireEvent.click(reload);
    await waitFor(() =>
      expect(screen.getByLabelText("name")).toHaveValue("Updated vase"),
    );
    expect(screen.getByRole("button", { name: "save" })).toBeDisabled();
  });
});
