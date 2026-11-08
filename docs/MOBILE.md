# Mobile behaviour

## Layout

* Below 900 px width the console switches to the mobile shell (`MobileConsole`):
  * the globe fills the screen and stays fully interactive (drag to rotate, pinch to zoom),
  * the clock/title/HDD columns collapse into two swipe-up drawers (`PANELS`, `CONTROLS`) using the
    same panel styling,
  * the LAT/LON/ALT/VEL/TEMP strip and the command bar stay pinned to the bottom with
    `env(safe-area-inset-bottom)` padding.
* The globe renderer uses `touch-action: none`, pointer events for multi-touch and caps the pixel
  ratio at 2 to protect battery.

## Voice on mobile

* Push-to-talk works while the tab is foregrounded.
* **Background listening is not possible** in mobile browsers (Safari/Chrome suspend audio and the
  Web Speech API when the page is not visible). A wake word needs a dedicated engine such as
  Porcupine running in a native shell with a licence key.
* Replies are muted by default; unmute with the `MUTE` button.

## Landscape and safe areas

* `viewport-fit=cover` is set in `index.html`, so the shell can draw under the notch and home
  indicator; bottom padding uses `env(safe-area-inset-bottom)` on the readout strip and command bar,
  and the drawers pad their content the same way.
* Portrait: the globe keeps the upper two-thirds, drawers slide over the bottom, the readout strip
  and command bar stay visible.
* Landscape: the drawers are capped at `78vh` so the command bar is never pushed off-screen, and
  the globe keeps a usable centre area between the thumb zones.
* Tap targets are at least 24 px on the icon rows (larger than the desktop HUD, which is scaled).

## PWA / offline

* `manifest.webmanifest` + icons (`icon-192`, `icon-512`, `maskable-512`) with
  `display: standalone`, so the app installs to the home screen without browser chrome.
* The service worker caches the **app shell only**. `/api/**`, any request carrying an
  `Authorization` header, GIBS tiles, NASA endpoints and Nominatim are network-only, so private
  responses never linger on a shared device and stale imagery is never shown as current.
* Offline banner: *"OFFLINE — cached interface only."* It also appears when the interface loads but
  the backend is unreachable, and distinguishes the two cases.
* `sw.js` is served with `no-store` so updates roll out promptly.

## Accessibility / motion

* `prefers-reduced-motion` disables the loader animation, globe auto-rotation, atmosphere pulse and
  cinematic `flyTo` easing (instant camera cut instead).
* All icon-only buttons have `aria-label`s; the globe has a descriptive `role="img"` label.
* The offline banner uses `role="status"` with `aria-live="polite"` so it is announced.

## Verified

* `scripts/pwa-check.js` runs against a production build and asserts: manifest is valid and
  installable, the service worker is active with scope `/`, and **0 API responses and 0 imagery
  tiles** appear in any cache.

## Known limits

* Background voice listening is impossible in mobile browsers (see above).
* The drawers use CSS transforms rather than a gesture library, so there is no drag-to-dismiss
  beyond the 28 px handle.
