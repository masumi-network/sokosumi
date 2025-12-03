-- Add constraint: OUTPUT blobs require sourceUrl
ALTER TABLE "blob"
ADD CONSTRAINT "blob_output_requires_sourceurl"
CHECK (
  origin != 'OUTPUT' OR "sourceUrl" IS NOT NULL
);

-- Add constraint: INPUT blobs require fileUrl
ALTER TABLE "blob"
ADD CONSTRAINT "blob_input_requires_fileurl"
CHECK (
  origin != 'INPUT' OR "fileUrl" IS NOT NULL
);