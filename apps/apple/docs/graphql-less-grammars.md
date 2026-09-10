# GraphQL and LESS grammar provenance

Approved by the user on 2026-09-10 as a separate dependency prerequisite for slice 10. These native parsers use the existing SwiftTreeSitter 0.10.0 runtime. They execute no message code and require no JavaScript engine or web view.

- GraphQL: [11bit/tree-sitter-graphql](https://github.com/11bit/tree-sitter-graphql/tree/951bde9fb3145b5f676204231e35f8b21d21f7b3), revision `951bde9fb3145b5f676204231e35f8b21d21f7b3`, MIT. Upstream has no SwiftPM manifest. `Vendor/TreeSitterGraphQL/src/parser.c` and `src/tree_sitter/parser.h` are unchanged upstream generated files. The local public header only declares the C entry point for SwiftPM. Do not hand-edit generated sources.
- LESS: [mdovale/tree-sitter-less](https://github.com/mdovale/tree-sitter-less/tree/02988c765d30adb0476657b5d220e8dfde1c07d3), revision `02988c765d30adb0476657b5d220e8dfde1c07d3`, MIT. SwiftPM pins this exact revision and links its TreeSitterLess product in dependency tests.

`Sources/SokosumiChat/Resources/GrammarDependencies` bundles the unchanged upstream GraphQL `queries/graphql/highlights.scm`, LESS `queries/highlights.scm`, and both full license notices. Keeping queries in the Chat bundle provides a stable resource path without relying on upstream private Bundle.module access. Parsers are test-only in this prerequisite; production highlighting follows merge in the renderer PR.

To update, obtain the approved upstream revisions, copy the generated files and queries verbatim, update the manifest pin and notices, regenerate Package.resolved with SwiftPM, and rerun dependency tests and the iOS build. Do not run grammar generators locally or modify their output. New dependency updates still require approval.

SHA-256 of copied files, relative to Packages/SokosumiChat:

- `Vendor/TreeSitterGraphQL/src/parser.c`: `5b56cf9d98c1f70ddf211e4c9271608da158d015eba6e300dd0243b16c1e43d6`
- `Vendor/TreeSitterGraphQL/src/tree_sitter/parser.h`: `8e819abdeba5866bf1aaf6e7b97522241c903d94a18395c6a75ed02984270ee8`
- `Sources/SokosumiChat/Resources/GrammarDependencies/graphql-highlights.scm`: `01fb7e593d604fcdbdf2276de2db10a50966bceae32dc21cf56bf7b8476d3ac2`
- `Sources/SokosumiChat/Resources/GrammarDependencies/less-highlights.scm`: `1905e29214ebc35e32696a67157d6d821943b5edd2e56814795cc7e4881e194d`

Verification covers error-free parsing, complete UTF-16 ranges, GraphQL keyword/field/Unicode string captures, and LESS variable/nested-selector/number/unit/Unicode string captures. This establishes dependency compatibility, not complete language coverage or renderer parity.
