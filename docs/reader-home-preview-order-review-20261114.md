What this change does: Restores the upstream home preview's first-eight order instead of moving every book with new chapters ahead of the reader's latest books. Renames the full-shelf link from “全部” to “查看书架” so it cannot be mistaken for an active display filter. New-chapter digits remain on the visible covers and on the independent continue-reading card.

Looks good. Ship.

Compared with upstream 67c4fbb: HomePage fixes its shelf query to recent and takes the first eight; the complete shelf keeps its own saved sort. The old upstream query translated recent to file-updated ordering. The custom branch's existing real reading-time query and offline sorting are retained rather than reintroducing that upstream bug. No new preference, API, dependency, request or polling is added.

The two implementation edits remove the extra sort and clarify one link label. The shared shelf data is not mutated, account-scoped query keys and offline fallback stay intact, and reading progress, source bindings and the single continue card are unchanged. Books outside the first eight still carry their badges on the full shelf; update counts no longer change home ordering.

Two regression cases failed before the fix. After the fix, 62 related tests pass, covering home, shelf ordering and offline queries, shelf navigation and Mine. Browser and PWA/build results are recorded at deployment. Expected load is the current personal deployment; the preview still uses the existing first shelf page of up to 60 books.

Not checked: physical phones or the entire backend; this is a frontend ordering and link-label fix.
