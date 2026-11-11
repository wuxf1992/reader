# Reader upstream release review — 2026-11-11

What this change does: It merges upstream `67c4fbb` into the custom Reader. It adds streamed scans, PDF range reading, resource tokens, media controls and incremental sync. It keeps offline reading, account boundaries, themes, background downloads and the mobile reader settings.

The expected load is the existing personal Docker instance. Several accounts and tabs share SQLite, with reading and media workers running together. This review covers `727c386..a748fd8` and the release fixes. It follows sync storage, token refresh, account changes, media checks, scan handlers, PDF cleanup, fixtures and deployment callers.

## Must fix — fixed before release

1. **Background sync skipped remote records** (`web/src/core/sync.ts`, `pushOutbox` and `flush`).
   - **What this is:** When the app goes into the background, it sends local changes. The server returns remote changes and a cursor, which says how far the next download should start.
   - **Problem:** `flush` discarded the returned records. `pushOutbox` had already saved their cursor. Another device's notes could then be skipped by every later incremental download. An interruption between acknowledgment and saving the response had the same risk. The discarded-response path existed before this merge and remained in the merged code.
   - **Fix:** Acknowledge the sent batch while keeping the old download cursor. In `flush`, check that the account is still current, then save the returned records and cursor together through the existing `applyPulled`. The normal sync path uses that same store method. Remove the unused cursor accumulator.
   - **If we skip it:** Going into the background can silently leave this device without remote notes or positions. Two tests fail before the fix and pass after it, including a failed local response write followed by a restart and retry.

2. **A full profile cache logged out a valid account** (`web/src/api/client.ts`, `ReaderApi.me`).
   - **What this is:** Permission refresh reads the current user and updates the cached profile in the saved session.
   - **Problem:** A quota error while saving this optional profile cache escaped as a failed verification. The runtime discarded valid credentials, even though the server had accepted the request. It also failed to apply the returned media permission.
   - **Fix:** Allow only this profile-cache write to fail. Keep the verified profile in memory and the existing credentials on disk. Required login and refresh-token writes keep their existing error handling.
   - **If we skip it:** Filling offline storage can sign the user out and interrupt offline reading. A runtime test reproduces the failure before the fix and checks preserved credentials plus updated permissions after it.

## Checks

- All 155 web test files pass: 1,453 Vitest tests and 22 Node checks. The five connected regression files pass 86 tests. Type checking and the production-configured build pass.
- The unchanged server source already passed type checking, build, 531 default tests and eight real FFmpeg checks covering seven fixture-dependent skips during this merge. Android shell checks also passed. Those results remain in `reader-assessment-20261111`.
- Browser fixtures use local disposable data and block the production domain. The media-permissions fixture now sets its local server explicitly, so the production bundle cannot send fixture logins to the real service.
- Release checks, the actual Node 24 image, migration compatibility, stopped-server backup, origin/public HTTPS hashes and final publication status are recorded separately in `UPSTREAM-SYNC.md` and `reader-release-20261111`.
- The actual Node 24 image passed isolated registration, authentication, resource-token range requests, incremental sync with an old client clock, body limits and media permissions. The Reader process runs as uid 100 with zero capabilities.
- All nine release browser fixtures passed, including Chromium/WebKit offline restart and hanging-network startup. Database-copy migrations were repeatable and the old image could still read and write the migrated copy.
- Production was published at 20:17 Beijing time. All 310 frontend files match the local HTTP release hashes, and seven key files match over public HTTPS. Both databases pass integrity and foreign-key checks. Existing primary keys, progress, settings, plugins and the signing key are preserved. The existing admin, books and plugin 1.6.8 pass read-only API checks.
- No new runtime dependency or new storage layer was added for these fixes.

Verdict: Ship. Both findings are fixed and the release checks passed. No unresolved blocker was found in the reviewed code and connected callers.

Not checked: Physical iPhone or lock-screen behavior, a complete Android APK, remote CI, every external source site, or exploitability of inherited dependency advisories. The dependency versions behind those advisories are unchanged by this merge.
