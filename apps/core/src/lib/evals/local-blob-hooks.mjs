// Node module hooks for local eval runs: every import of `@vercel/blob`
// resolves to the on-disk stand-in (local-blob.ts), so eval lanes upload,
// read and delete through Core's normal code without a real Blob store.
// Registered by evals:local and the world check when EVAL_LOCAL_BLOB_DIR is set.
let stubUrl = "";

export async function initialize(data) {
  stubUrl = data.stubUrl;
}

export async function resolve(specifier, context, next) {
  if (specifier === "@vercel/blob" && stubUrl)
    return { url: stubUrl, shortCircuit: true };
  return next(specifier, context);
}
