# Advanced print upgrade plan

Audit date: 2026-11-19. Extend the existing Electron/React application; retain its SQLite records, WhatsApp adapters, orders, payments, receipts, backups and working print submission.

## Existing project audit

| Area | Existing implementation | Findings and required work |
| --- | --- | --- |
| Desktop / IPC | apps/desktop/main.ts, preload.ts; isolated renderer, validated operations | Real Electron printing and installed/default printer discovery work. Capability and spooler queries, tray selection and export of imposed PDFs remain to add. |
| WhatsApp integration | packages/whatsapp-adapters/web.ts and cloud.ts | QR linked-device LocalAuth profile plus official Meta Cloud API. Web restart restoration, retry backoff and startup watchdog exist. Live account reliability still requires acceptance testing; unofficial Web integration can break or risk account restrictions. |
| Message receiving | automation-engine ingest(), Cloud webhook parser, WebAdapter callbacks | Stable message IDs deduplicate intake; group/system messages excluded. Account-scoped aliases and authenticated phone metadata identify direct customers. Audit malformed metadata and reconnect health checks in phase 10. |
| Attachment downloading | receiveMedia(), saveMedia(), collect(), Web download stream | Account ownership check, 32 MB limit, SHA-256 storage, pending/download/failed states and manual retries. PDFs, JPEG, PNG, WebP supported. Office conversion and scheduled media retry are missing. |
| Customer grouping | customer phone index; account/chat alias mapping; Documents selection; createOrder validation | Same-customer batches are supported and cross-customer files rejected. Walk-in files have null customer identity. Add explicit session/group boundaries for unrelated walk-ins; configurable order grouping, split/combine and per-file options pending. |
| Orders | print_jobs, print_job_files, print_queue, payments, receipts | Transactions on order/payment operations, balance checks, recorded settings and reprint exist. Per-file calculations/configuration, status history and reasoned price overrides missing. |
| PDF | apps/renderer/pdf.tsx and printing/layout.ts | PDF.js renders real pages and supplies page counts to Studio. Ranges are validated with a 100-page submission guard. Counts are not persisted. Current print renders each PDF page on its own side. No N-up/booklet imposition or colour analysis. |
| Photos | preparePrint raster path | Rotation, contain/cover, single/four/six passport layouts exist. Repeated-image layout is a guide in Studio, not a final image preview. Mixed-size real packing and individual photo quantities pending. |
| Pricing | shop mono/colour/photo integer minor-unit rates, Studio arithmetic | Current Studio counts selected pages and copies but does not expose paper/sides separately. Documents and automatic orders use per-file estimates. No physical-sheet pricing, per-file bulk rounding or rule catalogue. Do not silently change existing billing policy. |
| Printer safety | printStart/printFinish and Queue confirmation | Submission is distinct from physical completion; interrupted submissions marked Unconfirmed. Retry safeguards are limited; no available spooler tracking. Driver capabilities are not verified. No real printer test claimed. |
| Notifications | automation_rules, executions and audit logs | Rule/event reservations suppress duplicate execution. Operator-confirmed print-completed and pickup events exist. Editable stage templates and dedicated notification/delivery log pending. |
| Database | packages/database/index.ts | SQLite WAL, foreign keys, indexed relations; migrations v1/v2. No reset required. Further schema changes must migrate transactionally and preserve old records. |
| UI | renderer jobs, records, pdf, automation, setup, design; packages/ui | Existing compact three-pane Studio, documents, customers, orders, queue, payments, settings, light/dark themes. Extend these rather than replacing the shell. |

## Implementation sequence and acceptance gates

1. Audit (this document), then centralized validated calculation engine: selected pages, ordinary N-up, explicit booklet padding/order, duplex/manual pass accounting, mixed side colour, copies and independent bulk file rounding. Deterministic tests; no database reset.
2. Configurable integer-money pricing: independent billable units and physical consumption; tiers, finishing, discounts, minimums, reasoned overrides. Preserve logical-page legacy rates by default.
3. N-up document rendering using the same imposed side plan, final sheet preview, scaling/margins/order; reject settings not actually implemented.
4. Booklet rendering and preview using explicit padded side plans. Manual duplex needs a two-pass operator workflow before enabling physical submission.
5. PDF rendered colour analysis with tolerance, uncertain results and operator correction.
6. Per-file bulk settings, persisted page counts, same-customer grouping, reorder/separate/merge workflows and queue controls.
7. Mixed-size photo packing, editing, presets and exact preview.
8. Printer-supported sizes/trays/duplex and available spooler status; submission and verified readiness remain distinct.
9. WhatsApp health/recovery, media retry, sender validation/logging and stage-specific notification log/templates.
10. UI integration and regression testing, then Windows installer and honest live acceptance report.

## Calculation definitions

Counts describe one independently imposed document unless explicitly multiplied by copies. A printed side contains at least one selected logical page; a blank side is a completely unused physical side on a duplex sheet. Padding slots are reported separately. Mixed sides are billed as colour when any imposed page is colour. Uncertain/unanalysed pages require an explicit conservative policy. Each separate file starts on a fresh physical sheet; summing logical pages before rounding is incorrect. Booklets use padding to a multiple of four and explicit front/back pairing, never the ordinary N-up shortcut. Manual duplex has two passes and is an estimate until the operator workflow is implemented.

## Final live acceptance still required

Use an isolated shop/customer and actual supported Windows printer, receive five genuine PDFs and ten photos, verify sender grouping, each setting, prices, imposed previews, spooler observations, notification timing and reprint history. Fixture tests cannot establish physical printer output or live WhatsApp behaviour. No messages or physical print jobs are sent during automated verification.

## 0.4.0 implementation status

This release implements the requested first calculation upgrade and an initial PDF imposition integration. It is not a claim that all fourteen phases or the final live acceptance test are complete.

| Phase | Status after this change |
| --- | --- |
| 1 Audit | Completed before code changes; baseline audit above retained. |
| 2 Calculation | Implemented in packages/printing/calculation.ts; validated pure API, shared IPC estimate, explicit ordinary/booklet plans, selection, copies, mixed sides, manual duplex accounting and independent bulk rounding. |
| 3 Pricing | Core implements sheet/side/page/photo/booklet units, quantity tiers, setup, finishing, discounts, minimum and reasoned override. Studio exposes page/sheet/side basis using current shop rates. Separate paper/duplex pricing-rule catalogue and full settings UI remain pending. |
| 4 N-up | Real PDF raster composition for 1/2/4/6/8/9/16-up, portrait/landscape, margins, spacing, borders. Final-side preview and submission share composition. Custom grids, scaling modes, ordering, watermark and vector export remain pending. |
| 5 Booklets | Explicit saddle-stitch ordering, left/right binding, blank padding, duplex calculation and rendered preview/preparation implemented. Default is landscape short-edge duplex. Manual duplex submission, covers, creep and binding-margin editing remain pending; driver output needs physical verification. |
| 6 Colour analysis | Engine accepts explicit page classifications and handles uncertainty conservatively. PDF pixel analysis and per-page operator controls are not yet implemented. |
| 7 Bulk | Documents reads every selected PDF count before order creation. Same-customer selection, select all, independent per-file estimates and fresh-sheet boundaries are implemented. Global submission settings apply to every file; per-file editing, different printers, merge, reorder and queue pause remain pending. |
| 8 Photos | Existing source preview, guide, rotation, fit/fill and layouts preserved. Mixed-size photo packing, exact photo sheet preview and advanced editing remain pending. PDF imposition options on photos are explicitly rejected. |
| 9 Windows printing | Existing real discovery and submission retained; duplicate unresolved submissions blocked and interrupted submissions restored as Unconfirmed. Printer capabilities, tray selection and spooler observation remain pending. Paper choices currently use explicit physical dimensions and must be checked against the driver. |
| 10 WhatsApp/grouping | Existing persistent Web/Cloud adapters, reconnect recovery, stable intake IDs and ownership checks retained. No new live account verification, health polling or scheduled media retry in this slice. |
| 11 Notifications | Existing rule events and operator-confirmed completion retained. Dedicated stage template/log system remains pending. |
| 12 UI | Existing Studio extended with shared calculation summary, detailed file totals, final PDF side preview and collapsible layout/pricing controls. Full per-item order editor and advanced photo workspace pending. |
| 13 Verification | 32 automated tests pass; genuine generated PDF rendered in Electron and prepared without printer submission. See TEST_RESULTS.md for executed checks and exclusions. |
| 14 Windows build | 0.4.0 build/installer status recorded in TEST_RESULTS.md. |

### Persistence and compatibility

Database migration v2 to v3 adds print_calculations and print_order_config in one transaction. Original tables and records are retained. New manually created calculated orders store input/result snapshots; stored historical totals are not silently recalculated. Existing automation-created per-file estimates are preserved pending server-side PDF metadata integration. Price adjustments now require an audit reason. Backup validation accepts v1/v2/v3 and validates the new v3 tables. No production database was opened or reset during tests.

### Current execution limits

- 32 MB per attachment; 40 files per order.
- Print submission retains the existing 100 selected pages per PDF limit and enforces a maximum of 100 imposed sides for the complete submission.
- The pure calculation API supports up to 10,000 pages and copies for planning; the Windows submission UI retains its 100-copy limit.
- PDF composition is raster-based at approximately 152 dpi. Vector-preserving imposition and adjustable output quality remain future work.
- Mixed-colour calculations are tested, but the current print UI selects all mono or all colour; no automatic colour analysis is claimed.
- Manual duplex is a calculation mode only. It is deliberately absent from the submission schema until a safe operator-guided two-pass workflow exists.
- Preview matches prepared raster layout, not a guarantee of driver printable area, toner usage or physical output.

## Professional settings continuation

See PRINT_SETTINGS_IMPLEMENTATION.md for the current feature-by-feature matrix. The earlier 0.4.0 milestone is retained as history; new development extends it without a version bump, release or installer. Full manual-duplex workflow, advanced photo/poster UI and pricing, native tray/DPI routing, mixed-page controls, and the stage notification system remain outstanding. Do not interpret planner tests as a claim that these complete user workflows are finished.

## Bulk photo and notification upgrade audit (2026-11-19)

The existing application remains in place. Intake stays in packages/automation-engine/index.ts and the existing Web/Cloud adapters: stable message identifiers, account ownership checks, customer ownership, downloaded-file validation and original content-addressed storage are retained. JPG/JPEG, PNG and WEBP are accepted. HEIC is not claimed supported by the installed decoder (its HEIF input advertises AVIF); convert to a supported format before import.

The previous Studio selected a single new-order file and composed image documents separately. The old photo summary did not count the actual requested layout; its source/placeholder guide did not preview final photo sheets. Bulk Photo Studio now extends the existing shell through apps/renderer/photos.tsx, reuses thumbnails and the shared raster compositor, and packs selected customer images together in millimetres. PDFs retain their existing advanced Studio; mixed customer orders use independently configured PDF submissions and photo submissions.

Implemented: customer/date/recent/unprinted/search selection, Select All/Deselect, native file import and OS file dropping, stable reordering, per-photo dimensions/copies/fit/rotation/edits, automatic/grid/row/column/manual layout, cut guides, manual coordinates and canvas dragging, final-sheet navigation, bounded DPI, actual sheet pricing, per-photo/size pricing, billing media categories, combined PDF/photo subtotals, additive order editing with reasons, selected-file submissions, reprint snapshots and prepared exports. No original photo is overwritten by edits.

Automatic notifications reuse existing rules and reply transport. New intake/order/printing/collected triggers, editable English/Sinhala starters, persistent debounce batches and attempt history were added. Completion depends on confirmed coverage of all order files, not acceptance by Windows. Session/authentication protections and the 24-hour inbound safeguard remain active. Temporary disconnected-account retries are bounded; uncertain sends require verification rather than blind retries. Media import retries are bounded and stay tied to the original account.

Schema migrations 4 and 5 add notification outbox/attempt tracking; existing data is retained. Per-order photo layouts, quote snapshots and policies are stored using the existing transactional settings/configuration infrastructure. Backup validation accepts and checks the new tables. Existing queue selections are retained explicitly; old versions submitted every order file.

Remaining verification: physical printer behaviour (paper, feed, media, borderless, driver defaults), real WhatsApp delivery, real photo bursts/reconnects and installation on a separate Windows machine. Driver-only media and quality features remain in native preferences; the billing media category does not configure the driver.
