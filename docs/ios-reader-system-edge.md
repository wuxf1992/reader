# iOS reader top-edge blur investigation

The user observed native top-edge blur after opening and closing reading controls,
even with an opaque fixed chapter readout. Browser layout tests did not render the
iPhone's UIKit scroll-edge effect and did not establish that the blur was removed.

## Evidence gathered before this change

- [WebKit LocalFrameView.cpp, revision d878117](https://github.com/WebKit/WebKit/blob/d878117d5b773fb1151dabcb11e8617390f3c74d/Source/WebCore/page/LocalFrameView.cpp):
  `fixedContainerEdges()` samples 4 CSS pixels inside the viewport edge. The color
  read requires both border-box dimensions to exceed 10 pixels. Fixed/sticky
  candidates are subject to visibility, opacity and viewport-size checks. Sampling
  initially ignores `pointer-events: none`.
- [WebKit WKWebView.mm, same revision](https://github.com/WebKit/WebKit/blob/d878117d5b773fb1151dabcb11e8617390f3c74d/Source/WebKit/UIProcess/API/Cocoa/WKWebView.mm):
  native color-extension views depend on host obscured insets and fixed-edge state;
  native scroll-edge visibility is updated in the UI process, outside page CSS.
- [Original iOS 27 device experiment, September 20, 2026](https://zenn.dev/uakihir0/articles/260920-ios27-pwa-blur):
  an empty, full-width, 11px fixed element at z-index 2147483647 with a declared
  background color and `background-clip: text` supplied a stable sampling candidate
  without painting a visible strip. The author verified candidate variants on an
  iPhone and describes the native inset prerequisites and edge-retention behavior.
- [Independent device experiment, updated September 27, 2026](https://tips.ojapp.app/en/ios-27-pwa-top-blur-workaround-2/):
  ordinary CSS blur removal and a default status-bar meta did not remove the native
  blur; fixed overlay state affected it. Its workaround is explicitly experimental.

## Implementation and limits

The previous readout had z-index 5, below controls and dimming layers. Being fixed
alone does not establish that it is the native sampler's selected candidate. This
is a code discrepancy with the device-tested recipe, not a confirmed diagnosis of
the user's exact iOS build.

The brightness/dialog browser check also exposed a definite color propagation bug:
applying a local reading palette wrote `--reader-browser-paper` on the reader
container. It shadowed the document's subsequently composed browser tint. The
reader now removes that local override so the sampling node inherits the current
document color, including brightness and dialog state.

The reader now owns one separate empty DOM sampling node, continuously mounted
above the controls and dimming layer. It uses the already composed browser color,
including brightness and dialog tint, and does not intercept input or add body
spacing. `background-clip: text` prevents the empty node from painting. The rule is
limited to iOS WebKit via its touch-callout feature; existing default status-bar
metadata and input locking remain unchanged.

This relies on private browser heuristics, not a supported blur-disable API.
Desktop Playwright WebKit does not expose the iOS CSS feature or UIKit compositor.
The harness records that limitation and explicitly applies the emitted iOS rule
to test geometry, identity, color updates, non-painting and control cycles. These
checks cannot establish that the system blur disappears on a physical iPhone.
