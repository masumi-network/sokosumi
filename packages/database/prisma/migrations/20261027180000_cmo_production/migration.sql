-- CMO.xyz: after payment Cuso makes the whole month at once (production),
-- and Shopify is offered for measurement only on Shopify sites.
ALTER TABLE "cmo_hire" ADD COLUMN "production" JSONB,
ADD COLUMN "sitePlatform" TEXT;
