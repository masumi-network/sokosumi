; Baseline: same node types as tree-sitter-css / tree-sitter-scss (LESS extends CSS like SCSS).
; Upstream shipped a tiny highlights file; this restores property/selector/value coloring comparable to SCSS.
(comment) @comment

(tag_name) @tag
(nesting_selector) @tag
(universal_selector) @tag

"~" @operator
">" @operator
"+" @operator
"-" @operator
"*" @operator
"/" @operator
"=" @operator
"^=" @operator
"|=" @operator
"~=" @operator
"$=" @operator
"*=" @operator

"and" @operator
"or" @operator
"not" @operator
"only" @operator

(attribute_selector (plain_value) @string)

((property_name) @variable
 (#match? @variable "^--"))
((plain_value) @variable
 (#match? @variable "^--"))

(class_name) @property
(id_name) @property
(namespace_name) @property
(property_name) @property
(feature_name) @property

(pseudo_element_selector (tag_name) @attribute)
(pseudo_class_selector (class_name) @attribute)
(attribute_name) @attribute

(function_name) @function

"@media" @keyword
"@import" @keyword
"@charset" @keyword
"@namespace" @keyword
"@supports" @keyword
"@keyframes" @keyword
(at_keyword) @keyword
(to) @keyword
(from) @keyword
(important) @keyword

(string_value) @string
(color_value) @string.special

(integer_value) @number
(float_value) @number
(unit) @type

[
  "#"
  ","
  "."
  ":"
  "::"
  ";"
] @punctuation.delimiter

[
  "{"
  ")"
  "("
  "}"
] @punctuation.bracket

; Line comments (// …) — from tree-sitter-css extras
(js_comment) @comment @spell

; Do not list SCSS-only @ literals (e.g. @forward, @use, @mixin) — tree-sitter rejects
; query strings that are not tokens in the LESS grammar (QueryError.nodeType).

[
  ">="
  "<="
] @operator

; LESS: mixin call uses (function_name), not SCSS’s name: (identifier)
(mixin_statement
  (function_name) @function)

(mixin_statement
  (arguments
    (variable) @variable.parameter))

(mixin_definition
  (parameters
    (parameter) @variable.parameter))

; Values (avoid clashing with CSS custom-property --* plain_value → @variable above)
((plain_value) @string
 (#not-match? @string "^--"))

(keyword_query) @function

(identifier) @variable

(variable) @variable

(arguments
  (variable) @variable.parameter)

[
  "["
  "]"
] @punctuation.bracket
