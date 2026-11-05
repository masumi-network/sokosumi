# SEO analysis dispatch rollout

VERIFIED: `SEO_ANALYSIS_DISPATCH_ENABLED` defaults to `false` in Core. The default hides analysis and monitor creation controls. Core also refuses direct analysis dispatch and monitor creation before any Task or schedule is written. Stored reports, Audits, saved page selections, imports, native statistics, recommendation Tasks and page-change notes remain available.

VERIFIED: the Task parser from worker commit `6f7a34de` returned only the first URL from a `seo_job:` packet. The tested packet requested two pages, Germany, mobile and zero provider calls. Its parsed Case retained none of those bounds. A zero-call page check must not be sent to that worker.

INFERRED: a maintainer should enable `SEO_ANALYSIS_DISPATCH_ENABLED=true` only in a Core environment whose assigned public SEO Coworker uses the reviewed versioned protocol, implemented in worker commit `90ded488`. Verify the worker release and assigned Coworker before changing the flag. Enablement requires a Core redeployment because Core caches validated environment settings.

VERIFIED: the Sokosumi implementation contains Core and Web changes. The worker implementation lives in the separate `seo-bot` repository. Opening or deploying a Sokosumi PR does not deploy that worker.

INFERRED: deploy the PR with dispatch disabled to inspect `/seo`, create an Audit with a first page, save pages, import completed public reports, record changes and read native statistics. Do not infer worker compatibility from a successful health request alone.
