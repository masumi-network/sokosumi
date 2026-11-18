ALTER TABLE "workspace_label"
  ADD COLUMN "customColor" VARCHAR(7),
  ADD CONSTRAINT "workspace_label_custom_color_check"
    CHECK ("customColor" ~ '^#[0-9A-F]{6}$');
