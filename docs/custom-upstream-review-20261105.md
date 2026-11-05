# Reader upstream and mobile settings review — 2026-11-05

What this change does: It merges upstream `dc6cbf5` into the existing custom Reader. It groups reading settings into a compact panel and lets phone users pull the panel header down to close it. It keeps account isolation, offline reading and background downloads.

The expected load is the existing personal Docker instance, with multiple accounts and browser tabs using SQLite. This review follows the changed callers, storage boundaries, shared Sheet, reader layout, source editor, fixtures and deployment.

## Must fix — fixed before release

1. **Reading time could reach the wrong account** (`web/src/features/stats/reading-time.ts`, `web/src/ui/reader-screen.tsx:260`).
   - **What this is:** The new tracker keeps unsent reading time on the device and uploads it later.
   - **Problem:** Upstream used one queue for every server and account. Signing into another account could upload the first account's reading history there; a late flush could also use the new login.
   - **Fix:** Use the existing server/account scope for the queue. Check the original server and user before sending. Tests cover offline queues, returning to the same account, and a late flush after switching accounts. Old queues with no known owner are not imported.
   - **If we skip it:** Reading history crosses account boundaries and totals are wrong.

2. **Dragging a child panel could close its parent** (`web/src/ui/sheet.tsx:162`).
   - **What this is:** Sheet is shared by settings, forms, pickers and confirmations.
   - **Problem:** Pointer events from a nested dialog also reach its parent. Both could begin the same dismiss gesture.
   - **Fix:** Accept the gesture only when the closest dialog is the current Sheet. A nested-panel test checks that only the child closes. Busy panels, controls, body scrolling, cancelled gestures and desktop drawers retain their guards.
   - **If we skip it:** Closing a picker could also discard the form underneath it.

3. **A short pull could restart the entrance animation** (`web/src/ui/sheet.tsx:163`, `web/src/styles/sheet.css`).
   - **What this is:** A short pull should leave the panel open at its original position.
   - **Problem:** Removing an animation override on release restarted the entrance animation. A second pull could start while the header was moving off screen.
   - **Fix:** Cancel the entrance animation when dragging starts. Keep the existing close animation. Browser checks perform a short pull followed by a real closing pull at phone sizes.
   - **If we skip it:** The panel moves away from the user's finger and repeated gestures become unreliable.

4. **Changing type settings during a turn could keep an old drag active** (`web/src/ui/reader-view.ts:442`).
   - **What this is:** Upstream batches layout measurements once per animation frame.
   - **Problem:** The merged path still needed the custom reader's drag and turn cancellation, including when another layout pass was already pending.
   - **Fix:** Cancel the active drag and turn before a layout change; keep one position measurement per frame. Brightness changes do not remeasure the page. Reader layout and gesture tests cover this path.
   - **If we skip it:** A late gesture can move the page after the user changes its layout or restore the wrong reading position.

## Should fix — fixed before release

5. **Old reader code and duplicate entry points no longer had callers** (`web/src/render/text.ts`, `web/src/render/theme.ts`, `web/src/ui/reader-chrome.tsx`, styles).
   - **What this is:** The custom branch still carried an old text renderer, CSS generator and overlapping appearance/tool controls.
   - **Problem:** These paths no longer served the current reader and made future upstream merges harder. High frequency phone controls also competed with less common settings.
   - **Fix:** Remove the unused renderer, generator, orphan tests and unused selectors. Keep active brightness/theme helpers and the shelf sorter that still has callers. Reuse the shared theme preference and existing Sheet; add no dependencies. Put detailed settings in four pinned buttons and remove duplicate footer/floating controls.
   - **If we skip it:** Maintainers keep checking dead paths, and phone users keep searching through repeated controls.

## Checks

- Web: all 144 files, 1,376 Vitest tests and 18 Node contract checks pass. Type checking and production build pass.
- Server: 501 tests, 494 pass and 7 fixture-dependent skips. Eight real FFmpeg checks pass separately, covering the skipped cases. Type checking and build pass.
- Browser: Chromium and WebKit, 320/390/1440 settings, short/long pulls, persistence, all 30 presets and 120 cross-page theme selections. Reader turns, covers, cached novel opening and position choices, background downloads, offline sync, source discovery, real SQLite/stdio source acquisition, text fidelity, 96 status tint cases, full app routes and PWA update/offline restart checks pass.
- WebKit reports two expected failed statistics requests during deliberate reload/offline interruption in the download fixture. They are recorded separately; download recovery and offline reopening pass. Other page errors fail the checks.
- Android shell contract passes. A Node 24 candidate container passes authentication, statistics and payload rejection checks. Two migrations of a private database copy preserve all existing rows in 29 tables; the old image can still open the migrated schema.
- Release preparation uses the official stopped-server backup and verification commands, copies Compose/books/frontend, preserves old hashed assets, keeps member uploads disabled, and verifies every built file at the origin plus key files over public HTTPS.

Verdict: Ship.

Not checked: Physical iPhone gestures/lock-screen behavior, a complete Android APK, remote CI and a fresh dependency vulnerability audit. Browser emulation does not replace hardware checks. The existing large reader JavaScript chunk still triggers Vite's size warning; no new dependency was added.
