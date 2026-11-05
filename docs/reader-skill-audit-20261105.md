# Reader temporary skill check — 2026-11-05

What this change does: Reader now shows integer font-size steps instead of percentages, with 20 as the default display step and one step per tap. Existing saved scale values and reading size remain compatible. This check also found and fixed four problems in the same settings surface.

临时检查结论：字号已统一成数字档位，默认 20，点一次加减一档；已有字号大小不突变。以下四项为实际复现后修复，未全局安装或升级 skill。

## Skills actually exercised

| Skill | Execution and evidence |
| --- | --- |
| [Impeccable](https://github.com/pbakaus/impeccable) | Loaded the local audit rubric and project context. Ran its engine from `/tmp`, with its cache also in `/tmp`, against the touched UI components and styles. The installed launcher remains mode 664. The engine reported a newer skill version; no update was performed. |
| [OpenAI Playwright](https://github.com/openai/skills/blob/main/skills/.curated/playwright/SKILL.md) | Temporarily ran `@playwright/cli` with an isolated local fixture and the existing Chromium executable. Open, navigation, rendered snapshots, login, opening settings and closing the session all succeeded (8 commands). |
| [Anthropic webapp-testing](https://github.com/anthropics/skills/blob/main/skills/webapp-testing/SKILL.md) | Ran the official `with_server.py --help`, then used it to start and stop the isolated fixture around the browser checks. The browser scripts reuse the project's Node Playwright; Python Playwright was not installed. |
| Ponytail Review | Followed callers, settings storage, shared Sheet, theme tokens, tests and browser fixtures. Expected load: the existing personal Docker Reader with several accounts, with no server or database changes in this patch. |

## Must fix — fixed

1. **Hover text lost contrast** (`web/src/styles/reader.css:4139`).
   - **What this is:** A mouse hover changes the colour of the settings links and the font details link.
   - **Problem:** The warm theme used its pale brand fill for small text. The reading-tools link measured 1.66:1 against its background, below the 4.5:1 target for this text.
   - **Fix:** Use the existing `--color-brand-text` token. Both browser engines now pass the sampled text contrast checks, including the hovered link.
   - **If we skip it:** The link becomes hard to read precisely when the pointer is over it.

## Should fix — fixed

2. **Landscape settings entered the reserved safe area** (`web/src/styles/sheet.css:325`).
   - **What this is:** At phone landscape widths, settings use the shared side drawer.
   - **Problem:** A fixed 16px outer margin ignored the simulated 47px side inset. The close control and several right-side controls crossed that reserved rectangle in both engines.
   - **Fix:** Regular drawer margins, width and height use the larger of the normal margin and each safe inset. Normal desktop insets remain 16px when no safe area is present.
   - **If we skip it:** Controls can enter a phone's notch or rounded-edge region after rotation.

3. **Some settings targets were only 40px** (`web/src/styles/reader.css:4158`).
   - **What this is:** The close, back and font +/- buttons use the shared icon-button primitive.
   - **Problem:** Their actual boxes measured 40×40px and had no extra hit region. This is below this project's 44px touch target, although it is not by itself a failure of WCAG's 24px minimum.
   - **Fix:** Set a 44px minimum on icon buttons within reader settings. The check uses the whole clickable row for switches, so it does not mistake their smaller visible track for the touch target.
   - **If we skip it:** These frequent phone actions remain less forgiving to touch.

4. **Large interface text squeezed the range track** (`web/src/styles/reader.css:4160`).
   - **What this is:** A slider row contains a label, flexible range and a value.
   - **Problem:** With a 32px root font in a 390px viewport, the label and value consumed the range's width. The brightness thumb looked like a dot with little usable track.
   - **Fix:** A container query moves the range to a full-width second row when the text/container ratio is too tight. The controls still scroll inside the capped panel.
   - **If we skip it:** Enlarging interface text makes the slider difficult to adjust by touch.

## Font-size requirement

Quick settings and the detailed slider use the same integer steps, 16–44, with default 20. One step corresponds to the existing 0.05 scale increment. This is a display scale, not a claim that every authored EPUB paragraph has the same CSS pixel size. Brightness and reading progress still correctly use percentages. No preference migration or new dependency is needed.

## Impeccable audit health score

These are scoped review scores, not an accessibility certification or a whole-repository grade.

| Dimension | Score | Evidence and limit |
| --- | --- | --- |
| Accessibility | 3/4 | Sampled contrast, button names, focus containment, Escape and targets checked; no screen-reader or full axe/WCAG audit. |
| Performance | 3/4 | No new product dependency; native CSS layout and existing browser observer used. Existing Vite chunk-size warning remains; no low-end phone profiling. |
| Theming | 3/4 | Existing 30-preset flow passes; warm-theme hover contrast fixed. Not every text state in every theme was contrast-audited. |
| Responsive | 3/4 | Portrait, narrow, landscape, root-font enlargement and shortened-view cases checked in Chromium/WebKit; real iPhone keyboard and OS text scaling remain untested. |
| Implementation integrity | 4/4 | Reuses shared Sheet and semantic tokens, preserves stored settings, and adds no framework or configuration layer. |
| Total | 16/20 | Good within the stated scope. |

Implementation integrity: pass. The detector returned two `side-tab` warnings at the annotation/reading-tools blockquotes. Both mark quoted or selected book text and were retained as semantic content, not decorative card accents. No other primary detector findings were returned.

## Verification

- 150 component, layout, theme, drag, design-token and class-reference tests pass; type checking and production build pass.
- Temporary skill-driven browser flow: 12 scenarios, zero remaining recorded issues or page errors. Six cases per engine: 390px portrait PWA, 320px narrow PWA, 844×390 landscape with 47px side insets, 32px root font, 390×430 shortened input view, and desktop.
- Additional large-text slider check passes with synthesized Chromium touch and a WebKit mouse pointer. It scrolls the native range fully into view and verifies that dragging changes brightness.
- Existing reader-settings regression: 12 scenarios pass, including integer font-size changes, all detail screens, 30 themes, persistence, dynamic safe-area changes, footer geometry and dismissal gestures.
- PWA root/subpath installability, offline restart, API isolation, multi-tab update and cache cleanup pass.
- The fixture uses synthetic local accounts and blocks requests to the production Reader. The temporary helper stops its server, and the isolated CLI browser session is closed.
- Evidence: `artifacts/skill-audit-20261105/` contains before/after screenshots, CLI snapshots and structured results. Temporary skill files and runtime caches were kept outside the global skill directories.

Publication: Source `fb668c4c02675e8a5923afe408caef80d36e5545` was published at 2026-11-05 21:56 Asia/Shanghai. All 60 frontend files match the origin, key files match public HTTPS with certificate verification, and health is normal. The complete previous frontend is retained at `/opt/reader/backups/web-reader-fontsize-skill-20261105-135641`. Temporary tool caches were removed after the check.

Verdict: Ship.

Not checked: Physical iPhone Safari/PWA, real software-keyboard transitions, OS Dynamic Type, screen readers, complete Android APK and low-end network/render performance. A shortened viewport is a keyboard surrogate. WebKit mouse interaction is not physical iPhone touch.
