What this change does: Puts books with pending new chapters first in the home shelf preview, before taking its eight books. Within each group the existing recent-reading order stays intact. The continue-reading card still points to the last book read.

Looks good. Ship.

The reported case was a pending chapter on the ninth book, while home showed only the first eight. A regression with eight recent books and an updated ninth book failed before the fix. After the fix it checks visibility, the digit, stable remaining order, unchanged continue reading, no mutation of the shared shelf array, and the return to recent order when the count is zero. The change is a copy and a stable sort, with no new API, polling, dependency, CSS or data write.

Checked the home query, shelf query and offline fallback, server count projection, BookCard display conditions, reading acknowledgement, and shared home tests. Expected load is the current personal shelf of 15 books. Home still uses the first shelf page of up to 60 books; global prioritization outside that page would require a separate server query. It does not change the full shelf's ordering or attempt to fix failed external sources.

Validation: 52 tests passed across home, shelf state, PWA and Mine; TypeScript and production build passed. Chromium and WebKit at phone and desktop widths checked that the ninth book's digit is visible first, zero restores recent order, offline keeps the known count, and continue reading stays unchanged. PWA root and nested-path smoke passed. The interface detector found no issues. Frontend deployment uses a verified full web snapshot and automatic rollback, keeping the backend, book data, account state and old hashed assets.

Not checked: physical iPhone, remote CI, unrelated backend tests or all external sources. Seven subscriptions were failing source checks during diagnosis; this display fix cannot discover new chapters until those checks succeed. A proposed all-account API probe was rejected by automatic approval review and was not run. Diagnosis continued with existing job state and isolated local fixture accounts, without issuing production user tokens.
