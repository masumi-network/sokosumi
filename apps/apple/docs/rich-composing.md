# Native rich composing

## Scope

PARITY row 12: a WYSIWYG composer for rooms and reply threads, with bold, italic, underline, strike, inline/block code, quotes, ordered/unordered lists, links, emoji, keyboard shortcuts and toolbar visibility. Preserve existing account/workspace/room/thread draft identity, failed-send restoration, Enter/modified-Enter and IME behavior. Selected mentions and attachment drafts remain owned by rows 13/14; do not invent those models in this slice.

## Delivery split

- **12a — emoji entry**: native Emoji & Symbols picker, partial-shortcode completion menu, plus caret-local exact shortcode/emoticon conversion and trailing emoticon conversion on send. The system picker owns search/categories/recents. Existing draft storage and room/thread transports are unchanged. No new network contract or dependency.
- **12b — rich formatting**: the remaining formatting controls and Markdown round trips. Emoji entry does not require the rich editor's attributed formatting model and can ship independently.

## Existing implementations to reuse

- `ChatComposerView` owns the draft and accepted-send clearing. Retain its identity and send paths.
- `MacComposerTextInput` isolates native marked-text handling. Retain this adapter instead of replacing Enter handling with `onSubmit`, which previously submitted while committing IME text.
- `SokosumiChat.MessageMarkdown`, inline conversion and URL policy already parse/render persisted Markdown. Reuse their parsing and link validation where they preserve editing semantics; display models alone do not capture selection or typing attributes.
- `SavedComposeDraft` already stores the serialized message per account/workspace/room/thread.
- Existing emoji resources and normalization avoid another dependency.

## Web contract

Read-only references:

- `apps/web/src/components/chat/composer-wysiwyg-editor.tsx`: formatting toggles, selected-text handling, IME, paste and keyboard commands.
- `apps/web/src/components/chat/composer-format-toolbar.tsx`: command set and selection-preserving toolbar actions.
- `apps/web/src/lib/utils/composer-markdown-dom.ts`: persisted Markdown serialization and decoding. Underline and unsupported Markdown structures require matching the existing HTML convention, not introducing a new Core contract.
- `apps/web/src/components/chat/composer-add-link-dialog.tsx`: link insertion/editing.
- `apps/web/src/app/(app)/chat/utils/format-toolbar-preference-storage.ts`: toolbar preference scope/default.
- `apps/web/src/app/(app)/chat/hooks/use-compose-draft.ts`: draft lifecycle.

## Ownership

Portable editing data, formatting transformations and Markdown serialization belong in `SokosumiChat`, using Foundation and APIs available on iOS 17. The Mac adapter maps that data to native attributed text and reports text/selection changes. SwiftUI owns toolbar/popover presentation. `SokosumiWorkspace` continues to receive serialized content through existing send methods; it must not gain UI/editor dependencies.

Keep the editor instance and undo history stable during typing. Toolbar actions must preserve selection and focus. Programmatic restoration must not overwrite marked text. Formatting must retain code literals, Unicode ranges and link destinations across draft round trips. Reject unsupported pasted styling rather than persisting arbitrary native font/color attributes.

## Verification before completion

- Portable tests for range formatting, Unicode selection, toggling, nested structures, Markdown escaping and encode/decode round trips.
- Native adapter tests for Enter/modified-Enter, IME, selection preservation and externally restored drafts.
- Room and thread sending continue to use existing validation, send locks and failure restoration.
- Build/app tests and affected package suites, formatting and lint.
- Interactive typing, shortcuts, toolbar focus, links, undo/redo and draft restoration. Pointer automation currently fails with `noWindowsAvailable`; request user verification where no reliable UI automation is available.

No dependency additions are planned. Do not mark this design as implemented; 12a is in progress; 12b remains Todo until its vertical slice is complete.
