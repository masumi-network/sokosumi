import type {
  StudioProduct,
  StudioProductCatalog,
  StudioProductPhoto,
} from "@sokosumi/core-client";
import { isValidHttpUrl, normalizeWebsiteUrl } from "@sokosumi/utils";
import { Package, Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRef, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  attachStudioCatalogPhoto,
  getStudioProducts,
  importStudioProducts,
  saveStudioProducts,
} from "@/lib/actions/image-studio/product-catalog";

const MAX_PRODUCTS = 20;

export function StudioProductCatalogDialog({
  projectId,
  websiteUrl,
  onUseProduct,
  canUseProduct = true,
}: {
  projectId: string;
  websiteUrl?: string | null;
  onUseProduct: (
    product: StudioProduct,
    photo: StudioProductPhoto | null,
  ) => void;
  canUseProduct?: boolean;
}) {
  const t = useTranslations("App.Studio.ProductCatalog");
  const [open, setOpen] = useState(false);
  const usedProduct = useRef(false);
  const [catalog, setCatalog] = useState<StudioProductCatalog | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [website, setWebsite] = useState(websiteUrl ?? "");
  const [dirty, setDirty] = useState(false);
  const [message, setMessage] = useState("");
  const [saveFailed, setSaveFailed] = useState(false);
  const [pending, startTransition] = useTransition();
  const products = catalog?.products ?? [];
  const selected = products.find(({ id }) => id === selectedId) ?? products[0];
  const full = products.length >= MAX_PRODUCTS;

  function handleLoad() {
    startTransition(async () => {
      setMessage("");
      try {
        setCatalog(await getStudioProducts({ projectId }));
        setSaveFailed(false);
        setDirty(false);
      } catch {
        setMessage(t("loadError"));
      }
    });
  }

  function handleOpenChange(nextOpen: boolean) {
    if (pending) return;
    setOpen(nextOpen);
    if (nextOpen && !dirty) handleLoad();
  }

  function setProducts(next: StudioProduct[]) {
    setCatalog((current) => current && { ...current, products: next });
    setDirty(true);
  }

  function handleAdd() {
    if (full || pending) return;
    const id = crypto.randomUUID();
    setProducts([
      ...products,
      { id, name: "", description: "", price: "", url: null, imageUrl: null },
    ]);
    setSelectedId(id);
  }

  function handleChange(update: Partial<StudioProduct>) {
    if (!selected) return;
    setProducts(
      products.map((product) =>
        product.id === selected.id ? { ...product, ...update } : product,
      ),
    );
  }

  function handleImport() {
    const url = normalizeWebsiteUrl(website);
    if (!url || full || pending) return;
    startTransition(async () => {
      setMessage("");
      try {
        const result = await importStudioProducts({ projectId, url });
        if (!result.products.length) {
          setMessage(t("noImportResults"));
          return;
        }
        const keys = new Set(
          products.map(({ url, name }) => JSON.stringify([url, name])),
        );
        const additions = result.products
          .filter((product) => {
            const key = JSON.stringify([product.url, product.name]);
            if (keys.has(key)) return false;
            keys.add(key);
            return true;
          })
          .slice(0, MAX_PRODUCTS - products.length);
        const first = additions[0];
        if (!first) {
          setMessage(t("alreadyImported"));
          return;
        }
        setProducts([...products, ...additions]);
        setSelectedId(first.id);
        setMessage(t("imported", { count: additions.length }));
      } catch {
        setMessage(t("importError"));
      }
    });
  }

  function handleSave() {
    if (!catalog || pending) return;
    startTransition(async () => {
      setMessage("");
      try {
        setCatalog(await saveStudioProducts({ projectId, catalog }));
        setSaveFailed(false);
        setDirty(false);
        setMessage(t("saved"));
      } catch {
        setSaveFailed(true);
        setMessage(t("saveError"));
      }
    });
  }

  function handleUse(product: StudioProduct, withPhoto: boolean) {
    if (pending || !canUseProduct || !product.name.trim()) return;
    function use(photo: StudioProductPhoto | null) {
      usedProduct.current = true;
      setOpen(false);
      onUseProduct(product, photo);
    }

    if (!withPhoto || !product.imageUrl) {
      use(null);
      return;
    }

    const imageUrl = product.imageUrl;
    startTransition(async () => {
      setMessage("");
      try {
        use(
          await attachStudioCatalogPhoto({
            projectId,
            name: product.name,
            imageUrl,
          }),
        );
      } catch {
        setMessage(t("attachPhotoError"));
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button size="sm" type="button" variant="outline">
          <Package aria-hidden />
          {t("title")}
        </Button>
      </DialogTrigger>
      <DialogContent
        className="app-scrollbar max-h-[calc(100dvh-2rem)] overflow-y-auto"
        onCloseAutoFocus={(event) => {
          if (!usedProduct.current) return;
          usedProduct.current = false;
          event.preventDefault();
        }}
        showCloseButton={false}
      >
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>
            {t("description", { count: MAX_PRODUCTS })}
          </DialogDescription>
        </DialogHeader>
        {catalog ? (
          <div className="min-w-0 space-y-4">
            <fieldset className="min-w-0 space-y-3" disabled={pending}>
              <div className="space-y-1.5">
                <Label htmlFor="studio-catalog-website">{t("website")}</Label>
                <Input
                  id="studio-catalog-website"
                  inputMode="url"
                  onChange={(event) => setWebsite(event.currentTarget.value)}
                  placeholder={t("websitePlaceholder")}
                  value={website}
                />
                <Button
                  disabled={full || !normalizeWebsiteUrl(website)}
                  onClick={handleImport}
                  size="sm"
                  type="button"
                  variant="secondary"
                >
                  {t("import")}
                </Button>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-muted-foreground text-xs">
                  {t("count", { count: products.length, limit: MAX_PRODUCTS })}
                </p>
                <Button
                  disabled={full}
                  onClick={handleAdd}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  <Plus aria-hidden />
                  {t("add")}
                </Button>
              </div>
              {selected ? (
                <>
                  <div className="space-y-1.5">
                    <Label htmlFor="studio-catalog-product">
                      {t("product")}
                    </Label>
                    <select
                      className="border-input bg-background text-foreground focus-visible:ring-ring h-9 w-full rounded-md border px-3 text-sm focus-visible:ring-2"
                      id="studio-catalog-product"
                      onChange={(event) =>
                        setSelectedId(event.currentTarget.value)
                      }
                      value={selected.id}
                    >
                      {products.map(({ id, name }) => (
                        <option key={id} value={id}>
                          {name.trim() || t("untitled")}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="studio-product-name">{t("name")}</Label>
                    <Input
                      id="studio-product-name"
                      maxLength={160}
                      value={selected.name}
                      onChange={(event) =>
                        handleChange({ name: event.currentTarget.value })
                      }
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="studio-product-description">
                      {t("productDescription")}
                    </Label>
                    <Textarea
                      id="studio-product-description"
                      maxLength={800}
                      value={selected.description}
                      onChange={(event) =>
                        handleChange({ description: event.currentTarget.value })
                      }
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="studio-product-price">{t("price")}</Label>
                    <Input
                      id="studio-product-price"
                      maxLength={80}
                      value={selected.price}
                      onChange={(event) =>
                        handleChange({ price: event.currentTarget.value })
                      }
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="studio-product-page">
                      {t("productUrl")}
                    </Label>
                    <Input
                      id="studio-product-page"
                      inputMode="url"
                      maxLength={2048}
                      value={selected.url ?? ""}
                      onChange={(event) =>
                        handleChange({ url: event.currentTarget.value || null })
                      }
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="studio-product-image">
                      {t("imageUrl")}
                    </Label>
                    <Input
                      id="studio-product-image"
                      inputMode="url"
                      maxLength={2048}
                      value={selected.imageUrl ?? ""}
                      onChange={(event) =>
                        handleChange({
                          imageUrl: event.currentTarget.value || null,
                        })
                      }
                    />
                    {selected.imageUrl && isValidHttpUrl(selected.imageUrl) ? (
                      <a
                        className="text-foreground text-xs underline underline-offset-2"
                        href={selected.imageUrl}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {t("viewPhoto")}
                      </a>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      disabled={
                        !canUseProduct ||
                        !selected.name.trim() ||
                        Boolean(
                          selected.imageUrl &&
                            !isValidHttpUrl(selected.imageUrl),
                        )
                      }
                      onClick={() => handleUse(selected, true)}
                      size="sm"
                      type="button"
                      variant="secondary"
                    >
                      {t("use")}
                    </Button>
                    {selected.imageUrl ? (
                      <Button
                        disabled={!canUseProduct || !selected.name.trim()}
                        onClick={() => handleUse(selected, false)}
                        size="sm"
                        type="button"
                        variant="ghost"
                      >
                        {t("useDetailsOnly")}
                      </Button>
                    ) : null}
                    <Button
                      onClick={() =>
                        setProducts(
                          products.filter(({ id }) => id !== selected.id),
                        )
                      }
                      size="sm"
                      type="button"
                      variant="ghost"
                    >
                      {t("remove")}
                    </Button>
                  </div>
                </>
              ) : null}
            </fieldset>
          </div>
        ) : pending ? (
          <p className="text-muted-foreground text-sm" role="status">
            {t("loading")}
          </p>
        ) : (
          <Button
            onClick={handleLoad}
            size="sm"
            type="button"
            variant="outline"
          >
            {t("retry")}
          </Button>
        )}
        {catalog && pending ? (
          <p className="text-muted-foreground text-sm" role="status">
            {t("working")}
          </p>
        ) : null}
        {message ? (
          <p className="text-muted-foreground text-sm" role="status">
            {message}
          </p>
        ) : null}
        {saveFailed ? (
          <Button
            disabled={pending}
            onClick={handleLoad}
            size="sm"
            type="button"
            variant="outline"
          >
            {t("discardAndReload")}
          </Button>
        ) : null}
        <DialogFooter>
          <Button
            disabled={pending}
            onClick={() => handleOpenChange(false)}
            type="button"
            variant="outline"
          >
            {t("close")}
          </Button>
          {catalog ? (
            <Button
              disabled={
                !dirty ||
                products.some(
                  ({ name, imageUrl, url }) =>
                    !name.trim() ||
                    (imageUrl && !isValidHttpUrl(imageUrl)) ||
                    (url && !isValidHttpUrl(url)),
                )
              }
              loading={pending}
              onClick={handleSave}
              type="button"
            >
              {t("save")}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
