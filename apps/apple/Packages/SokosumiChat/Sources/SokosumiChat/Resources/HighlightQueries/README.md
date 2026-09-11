# Pinned native highlight queries

Unmodified query files from the already-approved grammar dependencies below.
Their C-only SwiftPM targets expose no Swift resource accessor. Keep these
resources beside their license copies so `Bundle.module` resolves them in both
app bundles and package tests. When updating a grammar, refresh its query and
license from the same pinned release and run the native highlighter tests.

| File | Repository | Release | Original path |
| --- | --- | --- | --- |
| objc.scm | https://github.com/tree-sitter-grammars/tree-sitter-objc | 3.0.2 | queries/highlights.scm |
| xml.scm | https://github.com/tree-sitter-grammars/tree-sitter-xml | 0.7.0 | queries/xml/highlights.scm |
| make.scm | https://github.com/tree-sitter-grammars/tree-sitter-make | 1.1.1 | queries/highlights.scm |
| diff.scm | https://github.com/tree-sitter-grammars/tree-sitter-diff | 0.2.0 | queries/highlights.scm |
| ini.scm | https://github.com/justinmk/tree-sitter-ini | 1.4.0 | queries/highlights.scm |

Objective-C inherits the existing C query, composed by the loader. These are
native Tree-sitter queries; no JavaScript runtime or source execution is used.
