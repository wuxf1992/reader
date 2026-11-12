What this change does: It adds a number to book covers when newly detected chapters are still unread. The shelf, home shelf and continue-reading cover use the active theme colours. Reading progress removes completed additions; zero hides the badge.

The expected load is the existing personal Reader instance, with several accounts, tabs and an SQLite reading store. This review covers `48f127d..32def9d` and follows publication refresh, subscriptions, both progress endpoints, shelf projections, offline storage, query freshness and theme tokens.

## Must fix — fixed before release

1. **A short chapter could keep its badge forever** (`web/src/ui/reader-screen.tsx`, `server/src/services/sync.ts`).
   - **What this is:** A one-page chapter can have its last page visible while its saved locator still says zero.
   - **Problem:** Looking only for a locator at one would never confirm that chapter. Changing the saved locator would also change restoration after a reflow.
   - **Fix:** Send an optional, validated `chapterComplete` flag through the existing durable progress outbox when the last page is visible. Keep the original locator. The server applies it only to the accepted account-owned position.
   - **If we skip it:** Some short chapters never lose their number. Client and SQLite regressions cover this case.

2. **The single-progress endpoint dropped the completion flag** (`server/src/http/routes/sync.ts`).
   - **What this is:** Progress can arrive in a batch or through the single-book PUT endpoint.
   - **Problem:** The PUT handler rebuilt the record without the new flag. A real HTTP regression left the badge at one after a completed short chapter.
   - **Fix:** Forward the optional flag through the existing validated merge. The regression failed before this fix and passes on Node 24 after it.
   - **If we skip it:** The two supported progress endpoints disagree about the same reading event.

## Checks

- New chapter IDs are recorded with the directory change in one transaction. Counts are projected with the account-owned shelf joins. Reordering, title changes and removed entries do not leave false additions; changing sources resets the baseline. Legacy cumulative counts are preserved, not mistaken for unread counts.
- Valid reading progress confirms earlier chapters and the current chapter at its final page. Jumping forward treats earlier additions as read. Going backwards does not recreate read additions. A late write for the old last chapter cannot dismiss a later appended chapter; another account and an older rejected position cannot dismiss the owner's updates.
- Backend coverage totals 540 cases: 533 passed and seven media-fixture skips, across the full Node 24 run and documented reruns. The initial root/read-only-image run had two environment failures (inherited WEB_DIR and a compiler output directory); the corrected non-root run passed all 51 affected checks, including the permission test. The final chapter, HTTP and sync regressions pass all 26 cases on Node 24.
- Web coverage totals 1,468 Vitest cases plus 22 Node checks across the full run and focused final reruns. The two initial CSS contract failures were fixed by using existing radius/type tokens; all six design-token checks pass. The final short-chapter/sync/card regression run passes 145 cases; the final home/card/design run passes 29. Production builds and type checks pass.
- Chromium and WebKit pass phone and desktop badge checks over 120 theme selections. All use the actual rendered theme pair, with minimum contrast 5.44:1. Zero/positive transitions, scoped offline counts, recovery, and home continue-reading covers pass. Cache-first novel opening, offline sync and PWA checks pass; the final bundle also passes the PWA smoke check.
- The exact Node 24 release image passes real HTTP checks for counts, both progress interfaces, short chapters, account separation, auth, resource ranges, media controls and body limits. Reader runs as uid 100 with zero effective capabilities.
- Twice opening private database copies is idempotent. All old columns/rows in 32 reader tables and 32 media tables are preserved, and the previous image can still read and write the migrated copy. The official stopped-server backup and post-publication checks are recorded in UPSTREAM-SYNC.md.

Verdict: Ship. Both findings are fixed. No unresolved blocker was found.

Not checked: Physical iPhone, a full Android APK, remote CI or every external source. Dependency lockfiles are unchanged; inherited npm advisories and the Vite chunk warning were not addressed. Offline completion updates the server-owned count after sync; historical cumulative counts are not backfilled.
