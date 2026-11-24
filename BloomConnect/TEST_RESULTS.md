# Test results - advanced print upgrade 0.4.0

Date: 2026-11-19 (Asia/Colombo).

## Executed

| Check | Result |
| --- | --- |
| npm run build | PASS: strict TypeScript, Vite renderer and bundled Electron/engine. Existing third-party directive/comment and renderer-size warnings remain. |
| npm test | PASS: 32 tests, zero failures, approximately 25 seconds. |
| Requested 10-page cases | PASS: simplex 10 sheets, duplex 5, 4-up simplex 3, 2-up duplex 3, 6-up simplex 2; copies multiplied after per-document rounding. |
| Arithmetic boundaries | PASS: page selection, odd/even/reverse, 8/9/16-up, blank sides versus slots, safe integers, validation and no input mutation. 1,365 N-up/duplex/page-count combinations checked. |
| Booklets | PASS: exact 8-page order, 10-to-12-page padding, left/right binding and explicit manual-duplex pass counts. |
| Pricing | PASS: sheet/side/page/photo/booklet units; mixed colour on imposed sides/sheets; uncertain classifications; A3/A4 and other dimensions; tier/setup/finishing/discount/minimum; override reason. |
| Bulk | PASS: five separate one-page documents each consume a fresh sheet; per-file price and copies; cross-customer and duplicate selections rejected. |
| SQLite upgrade | PASS: recreated v2 fixture migrated to v3; existing customer, file, order, partial payment and settings survive migration and repeated startup; foreign-key check passes. |
| Saved calculated orders | PASS: central totals override supplied legacy estimate only when explicit calculation inputs exist; input/result/settings persist across restart; original calculation remains after reasoned total adjustment. |
| Printer failure/reprint records | PASS: simulated preparation/submission failures, unresolved submission duplicate guard, restart to Unconfirmed, operator verification and retained reprint history. These are engine tests, not physical printing. |
| Existing regression coverage | PASS: import/content deduplication, customer grouping, payment limits, backup validation, Cloud signed webhook fixture, Web QR/media/reply fixture, recent history, reconnect and restart persistence. |
| Electron real PDF smoke | PASS: Electron generated a real 10-page PDF; PDF.js reported ten pages; Studio showed 3 sheets for 2-up duplex, 2 for 4-up duplex and 3 for booklet. Booklet preparation generated six sides. Preview first-side pixels exactly equal prepared first-side pixels. |
| Desktop visual inspection | PASS: inspected advanced Studio screenshot at 1366x900; file count, final booklet sheet, controls, totals and reason field visible. |

Local evidence: .local/advanced-tests.log, .local/advanced-build.log, .local/advanced-print-smoke-verified/advanced-print-smoke.json and advanced-studio-booklet.png. The smoke path runs only with BLOOMCONNECT_SMOKE_DIR and BLOOMCONNECT_SMOKE_PRINT=1; it never calls physical printer submission.

## Not executed or not implemented

- No physical Windows printer submission, spooler completion or printed-page quality check. Discovered OneNote (Desktop) and Microsoft Print to PDF; neither was submitted to during testing.
- No live WhatsApp account linking or customer message/media test. Web and Cloud regression tests use isolated fixtures.
- No claim of rendered PDF colour analysis, mixed-size photo packing, per-file printer overrides, full pricing catalogue, capabilities/trays, manual-duplex submission or stage notification templates. These remain tracked in ADVANCED_PRINT_UPGRADE_PLAN.md.
- The complete five-PDF/ten-photo live acceptance scenario and clean-machine installer upgrade are still required.

## Windows artifact

PASS: Windows x64 NSIS installer built successfully at release/BloomConnect Setup 0.4.0.exe (125,961,278 bytes). App ID and retained-user-data uninstall settings remain unchanged. Installer is unsigned.

SHA-256: 64930AC479A9C71A4F6E60C22CD9E8C91B2CE99D8374F596EE05915D90B29F0D.

Packaged runtime smoke: PASS using release/win-unpacked/BloomConnect.exe with isolated .local/advanced-print-smoke-packaged data. The packaged app generated/read a genuine ten-page PDF, showed the expected N-up/booklet calculations, prepared six booklet sides and matched the preview to prepared raster pixels. No physical printer submission. Evidence: .local/advanced-print-smoke-packaged/advanced-print-smoke.json. Installation over an existing installation on a clean Windows machine was not executed.

## Professional settings continuation (development only)

- Strict TypeScript/Vite/Electron development build: passed.
- Automated suite: 41 passed, zero failed. Evidence: .local/professional-tests.log.
- Additional nine tests cover selection/blank filters, custom grid/order, scaling, duplex uncollated pairs, booklet backside turn, poster tile geometry, photo packing, colour pixel analysis and capability rejection.
- Actual read-only Windows capability query executed against Microsoft Print to PDF; no physical print submission. Request evidence: .local/printer-cap-request.json.
- The full requested upgrade remains incomplete; see PRINT_SETTINGS_IMPLEMENTATION.md for connected versus unfinished paths.
- Version retained; no release or installer created.

## Auto reply verification � 2026-11-19
- Development build: passed.
- Full automated suite: 42 passed, 0 failed.
- Signed Cloud webhook fixture verifies automatic reply and duplicate-message suppression.
- Live WhatsApp delivery was not tested; no customer messages were sent.

## WhatsApp QR freshness follow-up - 2026-11-23

- QR images are now rendered only from the active `whatsapp-web.js` client's `qr` event. The page-canvas fallback was removed because it could display a QR without proving that the current client emitted it.
- New QR events replace the previous image and update the client ID and generation time. The image is cleared on authentication, disconnect, failure, and after the local 30-second freshness window; expiry does not invent or refresh a QR payload.
- QR rendering uses a 400×400 high-contrast PNG with a four-module quiet zone. Diagnostic activity records client IDs, timestamps, browser version, and lifecycle outcomes, never the raw QR payload.
- `npm run build`: passed. `node --test tests/engine.test.cjs`: 20 passed. Standalone validation passed TypeScript, build, full `npm test` (exit code 0), and isolated Electron startup. The validation tool could not parse the Node TAP test count; the test command itself passed.
- No dependencies were changed: `whatsapp-web.js` 1.34.8 and `puppeteer-core` 24.38.0 match the upstream Puppeteer 24.38.0 dependency. The detected system Chrome is 157.0.8103.79, newer than Puppeteer's bundled revision 146.0.7680.31; startup succeeds, but device linking against this browser combination was not verified.
- No real WhatsApp phone scan or packaged-installer linking test was performed. Fixture QR tests validate event routing/rendering and lifecycle behavior only; they do not prove WhatsApp accepts a code.

## WhatsApp QR startup follow-up - 2026-11-23

- The user's running app diagnostics showed `whatsapp-web.js` timing out after 60 seconds while waiting for `WAWebSocketModel.Socket.state`; it never reached QR generation.
- Root cause: the compatibility helper returned early when WhatsApp exposed a socket with an `on` method, even if its existing state did not reflect the current unpaired `Conn.ref`. The helper now derives `UNPAIRED_IDLE` from the current connection reference when no linked account is present, while preserving the original socket listener and state updates.
- Added a regression test for an existing socket reporting `CLOSED` while a current QR reference is available.
- `npm run build`: passed; `node --test tests/engine.test.cjs`: 20 passed; standalone TypeScript/build/full-suite/Electron startup checks: 4/4 passed.

## WhatsApp lifecycle and timeout follow-up - 2026-11-23

- The reported 60-second `Waiting failed` is the `whatsapp-web.js` `Client.inject()` wait for `WAWebSocketModel.Socket.state`; the first `window.Debug.VERSION` wait is converted to a different `auth timeout` error. Startup diagnostics now identify the wait stage and preserve a bounded, sanitized stack trace. The authentication-state helper is self-contained when serialized into Puppeteer's page context.
- Logout/restart/startup are serialized around one client. An in-flight launch is stopped and awaited before auth-session cleanup; browser resources are closed before the selected LocalAuth session is cleared. Detached-frame logout errors are surfaced as “remote logout not confirmed” while local cleanup still proceeds safely.
- Automatic reconnect is limited to three retries after an established connection drops. Initialization/authentication failures stop and display `Connection Failed` instead of looping. The settings screen displays engine progress and leaves logout available while startup is pending.
- Browser executable, Chrome version, Puppeteer-pinned Chrome revision, WhatsApp page errors and WhatsApp request failures are logged without QR payloads or full request URLs. The installed system Chrome (157.0.8103.79) differs from Puppeteer's expected revision (146.0.7680.31); this is reported, not silently overridden or upgraded.
- Added fixtures for duplicate starts, logout during browser launch, detached-frame logout, no automatic retry after initialization failure, and the exact authentication-state wait timeout. Focused WhatsApp tests: 10 passed.
- Final standalone validation: TypeScript, Electron build, full `npm test` command, and isolated Electron startup all exited successfully (4/4 assertions). The validation tool could not parse TAP counts, so the full-suite result is reported by exit code; no dependencies were added or updated.
- No live WhatsApp login/phone scan, packaged installer build, or packaged Windows account-switch test was performed. An already-installed executable will not contain these source changes until a release build is produced.

