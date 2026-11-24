# BloomConnect development status

## 0.3.2 — Emerald theme

- Reworked the shared light and dark palettes around forest green, emerald, and teal. The update covers navigation, the dashboard, onboarding, document and print screens, and workflow accents.
- Added short page entrances, hover feedback, and chart entrances. The renderer respects reduced-motion preferences.
- Status colours still distinguish warnings and errors from successful operations. The Windows visual check passed across 16 views, including dark mode, Sinhala navigation and PDF preview. All five regression tests passed.

## 0.3.1 — Manual WhatsApp Web replies

- Manual replies in an existing conversation on the current linked WhatsApp Web account can use the normal Web messaging flow even when the last customer message is older than 24 hours.
- Meta Cloud API replies retain their customer-service window, and BloomConnect automatic replies retain the 24-hour safeguard. An existing account-scoped direct-chat ID can identify a WhatsApp Web recipient whose phone number is private.
- Reply errors use plain application messages without Electron IPC prefixes. All five automated tests passed. The fixtures verify a manual Web reply after 36 hours, an automatic Web reply blocked after 36 hours, and an expired Meta Cloud API reply.

## 0.3.0 — Premium desktop redesign

- Restyled all 11 original workspace views and the seven-step setup wizard. The expanded/collapsed shell adds Engine, Auto Replies, Engine Logs, Print History and Backup views backed by the existing workspace operations.
- Centralized the purple, cyan, emerald and amber tokens, compact forms, navigation, badges, tables, loading states, toasts, drawers and reduced-motion behavior. Inter and Noto Sans Sinhala are bundled locally.
- Added six dashboard cards, a recorded-revenue chart, connection activity, a three-step workflow editor with React Flow minimap, document thumbnails and grid/list modes, three-pane print studio, queue board, customer and order drawers, receipt preview and categorized settings.
- Replies use the existing per-rule active message. English and Sinhala drafts are stored on the current computer. Connection actions use the existing link, reconnect and unlink operations. Print previews and photo guides use the existing layout presets and Windows driver options.
- Verification passed all five regression tests. The Windows renderer opened all 16 views at 1366×768, captured additional screenshots at 1440×900 and 1920×1080, and checked the first-time setup, Sinhala navigation, dark theme, collapsed sidebar, PDF preview, workflow editor, reply preview and customer/order/receipt drawers. Backend regression coverage uses isolated records and fixtures. Live account access and physical Windows printing were not exercised in the visual pass.

## 0.2.4 — Desktop visual refresh

- Added a cobalt and navy workspace palette, with violet, amber and mint accents. Light and dark themes share the same visual roles.
- Updated typography, spacing, navigation, dashboard cards, focus states, forms, and setup screens.
- The WhatsApp inbox has a fixed conversation header, independently scrolling columns, distinct incoming and outgoing bubbles, attachment buttons and colour-coded connection status. All five automated tests passed. In an isolated Electron run, the light and dark dashboards rendered with their intended palettes, the dark inbox rendered at a compact window size, and the PDF preview rendered successfully.

## 0.2.3 — Targeted document loading

- The inbox shows the current WhatsApp connection state and the reconnection route. WhatsApp system events such as `notification_template` are excluded from normal chat display, including old events already in SQLite.
- Search for an existing customer in the inbox and choose **Chat documents → Load chat documents** to request up to 200 recent messages for that direct chat. If loading older history fails, the adapter falls back to currently loaded history and reports that limitation.
- Files that WhatsApp still exposes can be opened in Documents on demand. Loading past history does not trigger print automation. All five automated tests passed, including discovery of an older PDF outside the general sync, filtering system events, and repeated-sync deduplication. Live access to the reported chat was not tested.

## 0.2.2 — Sent messages and chat documents

- Shows direct messages sent from the linked account, including messages sent from the phone while BloomConnect is connected. Recent history sync also includes sent messages.
- Shows supported PDF and image attachments from recent chat history and sent messages. Open a file in the inbox to download and preview it when WhatsApp still makes it available.
- Downloading old or sent attachments does not create automatic print orders. Live incoming documents keep their existing automation behavior. All five automated tests passed, including the fixture for a message and PDF sent from the phone, plus an older PDF downloaded on demand. Live linked-account behavior was not exercised on the build machine.

## 0.2.1 — WhatsApp inbox sync

- A successful QR link starts a bounded recent-chat sync and exposes a retry button in the WhatsApp inbox. Sync loads up to 30 direct chats with up to 20 messages per chat, including sent messages.
- WhatsApp direct chats with a private phone number use a stable account-scoped identity and display with the available contact name. A phone number is shown only when WhatsApp provides one.
- Historical records are deduplicated and do not trigger automation or download attachments. New incoming PDFs continue to use the existing workflow.
- All five automated tests passed. The inbox fixture checks history, outgoing messages, no automatic jobs from old PDFs, no duplicate messages on resync, and live messages from contacts without a visible phone number. A live account with existing chat history is needed for linked-account acceptance. A fresh QR smoke run on the build machine timed out during the Windows build.

## 0.2.0 — WhatsApp Web QR

- Added a second adapter using the unofficial whatsapp-web.js library. A phone approves linking by scanning the QR code from WhatsApp Linked Devices. An installed Windows browser and internet connection are required.
- Linked browser state is held in a separate local profile. BloomConnect attempts to restore it on launch. A shop can unlink locally, reconnect manually, or revoke the device from the phone. The Meta Cloud API adapter remains available as a separate setting.
- Direct messages with trusted phone metadata, PDFs and supported images use the existing inbox, media pipeline and automation rules. Existing customer records are associated by phone only when WhatsApp exposes a valid number. Group messages, historical sync, and messages without resolvable phone metadata are outside the QR adapter's scope.
- In-window text replies still require a recent inbound message on the active connection. Existing enabled rules continue running against the active connection.
- WhatsApp Web changes can interrupt the integration. This adapter carries platform terms and account restriction risk.
- Strict TypeScript/Vite build and five automated tests passed. The new test uses a local browser-client fixture to check QR state, media intake, order creation, duplicate suppression, account replies and local unlinking.
- Both the source engine and the packaged Windows engine obtained a genuine QR from WhatsApp Web in Chrome and returned it through their IPC responses. A real customer account never participated in automated testing. Linking an account and verifying live message and attachment delivery require scanning the QR from the user's phone.

## 0.1.0 — Initial release

## Implemented

| Area | Current behavior |
| --- | --- |
| Windows desktop | Original Electron and React UI with 11 functional sections, a seven-step setup wizard, global search, English/Sinhala navigation and light/dark themes. |
| Storage | SQLite with migrations, foreign keys, indexed records, order IDs, audit history, restart persistence, local backups and a backup validator. |
| WhatsApp | Official Meta Cloud API with credential checks, Windows-protected credentials, connection checks, signed webhook intake, message deduplication, sender metadata, media downloads, delivery status events, and free-form replies within the active customer-service window. |
| Documents | PDF, JPEG, PNG and WebP intake, local import, customer association, SHA-256 content-addressed storage, failed media retry, date/type filters, document preview and same-customer batch orders. |
| Automation | Simple rules plus a React Flow editor for linear trigger, keyword condition, action and notification chains. Supports order creation, tagging, notifications and permitted replies. Runs are logged. The test button performs a local dry run. |
| Printing | PDF.js preview, page navigation, Windows printer discovery, page ranges, copies, paper, orientation, colour, driver-dependent duplex, photo rotation, fit/crop and preset layouts, recorded print settings and reprint. Physical completion requires operator confirmation. |
| Sales | Customer profiles and history, order statuses, audit history, adjustable totals, partial payments, printable receipt PDFs and period summaries. |
| Packaging | Windows x64 NSIS build with shortcuts, app icon, version metadata, uninstall support and retained user data. |

## Integration and release limitations

- A shop supplies its Meta account, access token, public HTTPS webhook forwarding and live acceptance test. The app must be running for direct webhook delivery. QR login, prior chat sync, and multi-account switching are unavailable. Cloud status distinguishes API reachability from webhook verification.
- The app sends in-window text replies. Outbound attachments, approved template messages outside the service window, opt-in tracking and an offline outbound queue are pending. Incoming PDF and image media are supported. Office document conversion and thumbnail grids are pending.
- Visual workflows run as linear sequences. Delay nodes cannot be enabled. Branching and automatic replay after interrupted side effects are pending.
- Print submission uses Electron and the Windows driver. Driver options, spooler cancellation and physical print output require Windows or operator confirmation. The studio shows the source preview and prepares the final sheet at submission. Interactive crop/resize controls, custom sizes and adjustable print quality are pending.
- Base mono and colour pricing share the same rate across A4/A5. Document-center and automated orders start with a per-file estimate. Review the total in Print Studio before billing. Print Studio uses page counts for a newly configured single-file order.
- Sinhala localization covers the main navigation and page titles. Forms and help text use English. The UI uses project-owned React primitives with Tailwind. It does not include shadcn/ui components.
- Recovery uses the offline validator and a documented manual restore. Application-level retention controls, encrypted backups, automatic updates and Authenticode signing are pending.
- Live Meta delivery, physical printer output, Windows 10 runtime compatibility and installing/upgrading/uninstalling through NSIS on a separate clean Windows system remain release acceptance checks.

## Verification

| Check | Result |
| --- | --- |
| Strict TypeScript, Vite and Electron build | Passed. Vite reported third-party bundling warnings and a large renderer bundle. |
| Automated tests | 4 passed. Coverage includes page ranges, raw webhook signatures, customer and attachment links, import deduplication, payment limits, queue submission versus completion, backup validation, data persistence and a signed end-to-end webhook fixture. |
| Packaged Windows runtime | Rendered the shop dashboard, imported a generated PDF, rendered the PDF with PDF.js, and recovered shop settings on a second launch. One concurrent-build smoke run exceeded its shutdown wait after writing its results. A subsequent isolated run completed and exited cleanly. |
| Windows x64 NSIS | Build succeeded. Packaged executable reports BloomConnect 0.1.0. Installer is unsigned. |

Installer SHA-256: `9830F3B946EDAFB51A9B4CA34A50EB61672D4D10AD320C5C7F1485043975B91D`.

## 0.4.0 - Central print calculations and PDF imposition

- Extended the existing application; no project replacement or production database reset.
- Added a shared validated calculation engine for independent per-file rounding, selected logical pages, N-up, duplex sheets/sides/blanks, booklet order and padding, mixed side colour and integer-money pricing. Manual duplex is calculated but not exposed for physical submission.
- Studio and Documents use individual PDF page counts. Studio exposes real PDF N-up/booklet final-side previews, sheet totals, billing basis and per-file estimates; preview and submission share raster composition. Existing photo tools remain available.
- New calculated orders preserve immutable calculation snapshots and print settings through safe v3 additive migrations. Historical totals and legacy automatic-order estimates remain unchanged. Price adjustments require an audit reason.
- Added unresolved submission guards and restart recovery to Unconfirmed before reprint. Existing WhatsApp recovery, payments, receipts, automation and backups retained; backup validator accepts the new schema.
- Strict build and all 32 tests pass. An isolated Electron run with a genuine ten-page PDF verified the Studio calculations and six-side booklet preparation; preview and prepared first-side pixels match. No real printer submission or live WhatsApp account test executed.
- This is the first advanced-engine delivery, not completion of the entire requested upgrade. Pricing catalogue/settings, colour pixel analysis, per-file printer/config editing, advanced photo packing, capability/spooler integration and stage notification templates remain tracked in ADVANCED_PRINT_UPGRADE_PLAN.md. See TEST_RESULTS.md for executed verification and exclusions.

- Windows 0.4.0 x64 NSIS packaging and isolated packaged-runtime calculation/booklet smoke both passed. Installer checksum and remaining live acceptance checks are in TEST_RESULTS.md.

## Professional print settings continuation - no release

- Continued existing unfinished source. Added validated Windows capability IPC/native dialogs, pre-submission gates and prepared-PDF export.
- Connected page filters, blank skipping, scaling, PDF rotation, N-up ordering, mono/grayscale processing, brightness/contrast, rendering DPI, copy collation and preset management to the shared renderer.
- Added bounded poster/photo planning and pixel analysis foundations; their incomplete advanced UI/pricing paths remain unexposed. Manual duplex and direct tray/DPI submission are explicitly gated off.
- Development build passes and 41 automated tests pass. Actual Microsoft Print to PDF capabilities queried; no physical submission or live WhatsApp test. Full implementation matrix and remaining integration are in PRINT_SETTINGS_IMPLEMENTATION.md.
- Version unchanged at 0.4.0; no release or installer created.

## Auto reply creation and diagnostics

Added New auto reply directly in Auto Replies: name, event trigger, keyword when needed, Sinhala/English message, and Save and enable. Existing switches and templates retained. Automated sends use the existing authenticated adapter, recent inbound-message checks and event reservations. Failed rule actions now record the actual error in Engine Logs rather than only a generic failure. Signed Cloud fixture verifies a new incoming message receives an automatic reply and duplicate intake does not create another reply record. Live account sending was not exercised. No version bump or installer.

## Bulk Photo Studio and notification implementation (2026-11-19)

Implemented inside the existing Electron application: a customer photo library and three-panel sheet workspace; bulk/per-photo settings and nondestructive edits; dimension-based multi-source packing and manual positions; real preview/export composition; photo and PDF subtotals; configurable photo pricing; safe order updates with audited reasons; selected-file physical submissions and reprints.

Extended existing automation with editable Sinhala/English stage templates, persistent acknowledgement batching, original-account checks, bounded offline/media retries, message/attempt logs, and all-file print-confirmation coverage. Database migrations are additive; production data was not used for tests.

Read PRINT_SETTINGS_IMPLEMENTATION.md for capability limits. Driver defaults, physical output and live WhatsApp delivery are not asserted from fixture tests. Final build/test/packaging evidence is recorded in TEST_RESULTS.md.
## 0.4.2 Windows packaging and updates

The Windows x64 installer is built with `npm run installer` and written to `release`. Upgrades use the existing application ID and retain the BloomConnect workspace.

For an update-enabled installer, set `BLOOMCONNECT_UPDATE_URL` to the production HTTPS directory before building. Host the generated installer, blockmap and `latest.yml` together at that URL. Publish the installer and blockmap before replacing `latest.yml`. Increment the package version for each new update and keep the update channel and signing publisher consistent. Set the standard electron-builder signing credentials for a signed release.

Settings → About BloomConnect shows the update status. Channel-enabled builds check and download updates in the background. Downloaded updates install when the operator closes the app or chooses Restart and install. An active print operation prevents the update from installing. Installations built without a channel display that status and can be upgraded with a new installer.

