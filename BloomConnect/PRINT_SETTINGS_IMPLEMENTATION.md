# Professional print settings implementation

## Universal engine audit

| Area | Existing capability at audit |
|---|---|
| File intake | PDF/JPEG/PNG/WebP content detection. Ready files flow into order creation, preview and a shared raster compositor. |
| Office conversion | PowerPoint, Word and Excel 16 executables are installed on this Windows workstation. LibreOffice was not found at its conventional path. Installation alone does not verify unattended conversion. |
| Print path | Electron for ordinary confirmation; Windows native path for explicit tray/DPI. Only virtual printers were previously observable on this workstation. |
| Imposition and pricing | The calculator distinguishes logical pages, imposed sides, physical sheets and finishing. Actual poster tiles and photo packing already flow through the shared model. |
| Booklets and duplex | Binding, padding and automatic/manual duplex exist; signatures, per-printer feed profiles and a dedicated setup flow were gaps. |

The continuation uses additive settings only. Existing job snapshots, customer records, payments and messaging retention are preserved.

### Universal engine capability matrix

| Feature | Implementation and limits |
| --- | --- |
| Office intake | PPT/PPTX, DOC/DOCX, XLS/XLSX and UTF-8/UTF-16 text enter Documents as **Needs conversion**. The operator explicitly converts through installed Microsoft Office. The original remains in the same customer's library and backups. A repeated conversion reuses its prepared PDF. |
| Images | PDF, JPEG/PNG/WebP keep their existing paths. Single-frame TIFF and decodable HEIC become separate PNG assets on request. Multi-frame images and unavailable codecs report an error. |
| Office fidelity | Read-only source conversion. Macros are disabled through Office automation. Macro-bearing or externally linked OOXML packages are rejected. Protected, linked, or unsupported documents can be exported manually and imported as PDF. Compare fonts, layout and page count after conversion. |
| PowerPoint | Full slides, speaker notes and outline via PowerPoint PDF export. Optional hidden slide inclusion. Print Studio ranges reference the converted page numbers. Three-slide handouts draw a dedicated writing column, and the shared N-up path handles 1/2/3/4/6/8/9/12/16 and custom grids. |
| Word and Excel | Office PDF output enters the same page ranges, N-up, booklet, colour, copies, layout and pricing paths. Excel uses workbook print areas. Native Office dialogs are external to BloomConnect. |
| Booklet Wizard | Paper and finished-size choices, left/right binding, signature sizes, gutter and per-sheet creep, automatic/manual duplex, and fold or hand-staple instructions. The wizard applies real settings to the shared preview and estimate. Independent signature padding changes actual side and sheet counts. |
| Booklet finishing | Fold/staple instructions apply after printing. Method pricing supplies the configured finishing charge. Dedicated multi-stock cover and inside/outside cover controls, programmatic stapling, and separate signature collation beyond normal copy order are unavailable. |
| Manual duplex | Front- or back-first, second-pass reversal and 180-degree rotation. Profiles keyed by printer, orientation and flip edge require operator test confirmation. The runtime pauses after the first pass and uses the stored instructions. Real paper feed still requires device testing. |
| PDF marks | Optional text watermark, source-page labels and crop marks appear in the imposed preview and exported/printed sides. |
| Pricing, photos and notifications | Existing physical-sheet, side, page, photo and booklet rates remain available. Customer files, queue completion, and WhatsApp automation retain the existing workflow. No new messages are sent solely because a file is converted. |

Office export references: [PowerPoint fixed-format export](https://learn.microsoft.com/en-us/office/vba/api/powerpoint.presentation.exportasfixedformat), [Word document opening](https://learn.microsoft.com/en-us/office/vba/api/word.documents.open), [Excel workbook opening](https://learn.microsoft.com/en-us/office/vba/api/excel.workbooks.open).

### Universal engine verification

- TypeScript passed and the isolated automated suite passed all 68 tests, including handout sheet counts, multiple signatures, TIFF preparation and original backup retention, printer feed profiles, queue recovery and existing WhatsApp fixtures.
- Actual Office test documents converted successfully for PPT, PPTX, DOC, DOCX, XLS, XLSX and TXT. The three-slide deck produced two full-slide pages excluding the hidden slide and three including it. Speaker notes and outline exported as separate PDFs.
- The isolated Electron run exercised the lined three-up preset and the Booklet Wizard. Its 10-page booklet prepared six imposed sides on three physical sheets, and the rendered preview matched the prepared first side.
- Windows listed OneNote and Microsoft Print to PDF. No hardware output, tray handling, paper reinsertion or physical finishing was verified. The installed application and its production database were not replaced.

## Bulk selection and photo editor

Select All includes the current customer's ready photos matching the library filters, even when an existing order is open. Save order and print/export first attaches the selected new files to the same order. The existing 40-file and same-customer checks remain in force. A wide modal shows the shared sheet preview, frame move/resize, and a reorder list. Reordering assigns every photo copy to a sheet position in reading order, and the resulting ordered file selection is sent with print/export.

## Customer photo and PDF continuation

The visible overflow came from the preview grid allowing a wide canvas to contribute its intrinsic width. The preview track, canvas viewport, and Studio panel now have bounded widths. Zooming scrolls within the canvas viewport. Orders that contain photos open Bulk Photo Studio, and the legacy Studio also displays actual composed sheets for image files.

| Area | Implemented | Remaining limits |
| --- | --- | --- |
| Photo sizes | Exact dimensions in mm/cm/in, portrait/landscape, A4/A3/A5 full-page presets, fractional printable-area presets and custom grids | Full paper coverage requires a borderless-capable form and explicit layout settings. The existing file, quantity and raster limits apply. |
| Photo editing | Auto packing, per-photo size/copies, duplicate, reorder and remove, drag and numeric placement, snap, left/center/right alignment, frame-proportion lock, undo/redo of position edits | The selected photo has a bottom-right resize handle with optional aspect-ratio lock. Keyboard-accessible millimetre frame inputs edit individual copies. Rulers and distribution remain unavailable. Manual duplicates start on their own side to avoid collisions. |
| Fit selected photos on A4 | Chooses an A4 grid from the requested print count and orientation; the direct editor converts the current layout into movable per-copy frames | Includes existing copy quantities. Larger requests can span multiple A4 sheets. Fit preserves the entire photo; Fill and crop fills each frame. |
| Photo colour and enhancement | Job-wide and per-photo ink, estimated automatic colour, sepia, auto contrast, exposure, warmth, shadows/highlights, denoise, sharpening and Original/Final sheet comparison | Adjustments affect rendered output only. No local AI upscaler or individual enhanced-image export. Prepared PDF saves the rendered layout separately. |
| Effective DPI | Calculated from source pixels, crop, rotation, scaling and final placement. Configurable warning threshold and operator confirmation in Bulk Photo Studio | A high effective DPI cannot detect detail already lost in the source. Raster output DPI is a separate setting. |
| PDF | Custom width/height frames, A5-sized half-A4 shortcut, aspect-preserving fit, fill/crop or explicit stretch, manual deskew angle, noise reduction and scan sharpening | Prepared PDF export uses the shared raster compositor. Vector-preserving imposition and independent PDF page crop coordinates are unavailable. |
| Pricing and combined orders | Physical-sheet paper charge, per-size rates, separate photo/PDF subtotals, extra charges and discount, and separate printer selection for the photo and PDF submissions | PDF files inside a combined order share their group settings. Per-file printer/layout and quality-specific price rules are unavailable. |
| WhatsApp | Editable English/Sinhala Price confirmed event from Orders, with deduplication for the same order total. Existing grouped intake rules and operator-confirmed physical completion retained | Enable a reply rule for the event when an automatic customer message is desired. Verification uses fixtures without sending live messages. |

Verification includes source type checks, a hidden Electron CSS containment fixture using the Studio styles, and 59 source-engine and planner tests. The existing distribution was not rebuilt. Physical output requires a connected printer.

## 2026-11-20 implementation and verification

The existing Studio composes raster sides through one PDF.js renderer for preview, prepared PDF export, and Windows submission. Ordinary jobs still use Electron. Selecting an advertised tray or driver DPI routes the same rendered sides through Windows System.Drawing.Printing. Preview, exported PDF and queue records retain the selected layout. Both physical submission paths validate the printer first. Mixed document orientations in one submission require separate jobs.

| Area | Current implementation | Limits and verification |
| --- | --- | --- |
| Printer | Windows printer list, default selection, status/error, driver and port, refresh, native preferences/properties and the selected driver's capability matrix | Driver name is used as the model label when Windows supplies no separate model. Virtual devices have no physical duplex, tray or resolution controls. |
| Paper and scaling | Standard and custom dimensions, preview/export, fit to paper, fit to advertised printable area, actual, shrink, fill, percentage, explicit stretch, centering, rotation, and per-edge margins/gutter | Physical jobs require an advertised Windows form. Fit to printable area requires a fixed orientation and the selected form's capability response. Device hard margins can clip content at zero layout margins. |
| Page selection and copies | Range/current page, odd/even, reversal, skip rendered blank pages, per-file quantities, collated/uncollated and duplex pair preservation | Separate whole-job multi-document print sets and reverse set ordering are unavailable. |
| Sides | Automatic long/short edge and manual two-pass with reinsertion prompt, optional reversed stack and 180° back rotation | Manual order and feed still need device-specific paper tests. An interrupted first pass is recorded without a successful complete submission. Arbitrary isolated front/back submission as a finished order is unavailable. |
| Layout | Custom N-up, rotation and cell ordering, booklet padding and binding, one-sided poster tiles with overlap/labels/marks, and photo grids | Separate booklet covers and booklet signature options are unavailable. Poster scaling is layout preprocessing and contributes actual tile counts to billing. |
| Colour | Full colour, black and white, grayscale, estimated detection, colour page ranges and uncertain-page confirmation | Per-page colour is raster preprocessing. A mixed job with any colour side requests colour mode from Windows. Driver accounting can bill that job differently. |
| Quality and native controls | Raster DPI/smoothing, brightness and contrast, photo sharpening, actual driver tray and DPI choices routed to native Windows submission | Physical tray and DPI submission has no hardware verification in this workspace. Vendor economy, toner/ink save, media, output tray, finishing, accounting and security remain in native Printer Preferences where supplied. |
| Photo | A4 landscape 2×2, custom grids, whole-image fit/crop, one-photo-per-side, front/back pairing, ordering and separate simplex/duplex mono/colour pricing | Physical sheet count comes from composed sides, including duplex padding. Paper charges use physical sheets regardless of whether printing is billed by sheet, side or photo. |
| Pricing | Paper, printing/setup and finishing are separate. Independent document method rates are keyed by paper and duplex, with shop rates as fallback | Existing rates continue to work. Optional paper cost defaults to zero. Historical orders keep their recorded total until the operator saves an estimate. |
| Interface and presets | Basic/Advanced controls, sticky Print and estimate, defaults for new document orders, custom preset update/duplicate/delete and optional saved printer | Bulk Photo Studio retains its own photo-specific controls. Driver capabilities are checked when a preset is used. |
| Preview, queue and notifications | Shared composer for preview/export/submission, configured print settings captured in the queue, and operator-confirmed completion | Save PDF creates a file without a print queue entry. Current source tests exercise WhatsApp with fixtures. No live messages were sent. |

### Capability observations for the available Windows devices

| Windows device | Paper forms | Driver DPI | Colour | Auto duplex | Trays | Borderless on queried form |
| --- | ---: | --- | --- | --- | --- | --- |
| OneNote (Desktop) | 10 | 600 × 600, 1200 × 1200 | Yes | No | None advertised | No |
| Microsoft Print to PDF | 10 | 600 × 600 | Yes | No | None advertised | Driver reports zero hard margins |

Both are virtual printers. Both reported Windows status 3 and error 0 when queried. Physical simplex, duplex, media, borderless, and tray/DPI output require a physical printer to verify. Source verification uses TypeScript checks and an isolated test-engine bundle. The installed application, workspace distribution files, customer database and release artifacts are untouched.

The 55-test automated suite passed with the current source engine. It covers physical-sheet photo pricing under per-photo billing, poster tile counts, manual duplex padding, colour, preview geometry, queue recovery, and existing notification and database fixtures. The revised desktop interaction and the new native submission route have no physical end-to-end verification.

## Historical implementation notes

## Audit before changes — 2026-11-19

The existing pipeline is Studio → validated Electron IPC → hidden PDF.js print window → Windows Electron printing → recorded queue entry. It already supports real installed printer discovery, PDF ranges, copies, mono/colour, basic duplex, N-up and saddle-stitch imposition, margins/spacing/borders, simple photo layouts, calculation snapshots and operator-confirmed completion. WhatsApp, customer records, billing, backups and existing print history must be retained.

Gaps found: paper sizes and duplex were offered without querying the driver; no native preferences/properties, tray controls, PDF export, page filtering, custom scaling, orientation policy, asymmetric margins, colour analysis, poster layout, final photo preview, manual duplex workflow or preset management. Preview and submission must share selection, placement and raster processing. All unknown capabilities must fail closed for physical printing. Native settings must be distinguished from document preprocessing.

## Architecture and acceptance

- Keep Electron submission for compatible ordinary jobs. Add Windows System.Drawing.Printing capabilities and an optional native raster submission path for explicit driver paper source/resolution.
- Obtain real device capabilities; never synthesize tray names, duplex, colour or DPI support. Expose vendor features through native preferences rather than pretending Electron supports them.
- Share validated settings, page selection, side plans, geometry, colour analysis and composition between preview, calculation, PDF export and physical preparation.
- Manual duplex must retain a prepared first-pass snapshot and require a reinsertion confirmation. No automatic retries after uncertain submission.
- Unsupported operations are disabled with a reason; no inert buttons.
- Test pure planning and capability gates, retain all existing regression tests, and exercise Electron rendering/export in isolated data. No release or installer will be created. Physical output and device-specific feed direction need hardware verification.

Implementation matrix and executed test results will be updated as work completes.

## Current implementation matrix - professional settings continuation

The complete requested upgrade is NOT finished. The following records the actual connected scope, including unfinished paths explicitly gated off.

| Option | Implementation | Validation / limitations |
| --- | --- | --- |
| Windows capability query | Connected IPC, System.Drawing.Printing and Win32_Printer | Queried actual Microsoft Print to PDF driver. Real paper forms, no trays, colour=true, duplex=false, 600x600 DPI. Physical hardware untested. |
| Paper/duplex/colour gate | Validated again before physical submission; unsupported paper and duplex choices disabled in Studio | Custom physical forms must be advertised by driver. PDF output supports renderer dimensions. |
| Native preferences/properties | Connected, installed-name validation, no shell interpolation | Interactive dialogs not opened in automated tests. |
| Save prepared PDF | Connected to active order, hidden shared renderer and Electron printToPDF | Uses CSS paper dimensions and zero export margins. User chooses destination. |
| Current/range/odd/even/reverse/blank filtering | Connected Studio and shared selection planner | Blank detection is conservative low-resolution rendered-content analysis; not a proof of empty original content. |
| Scaling/rotation/N-up order | Connected Studio, composition and output | Fit, actual, shrink, fill, percentage, stretch, centering and automatic rotation. |
| Mono/grayscale, brightness/contrast, raster DPI/smoothing | Connected Studio and compositor | Explicit memory limits reject oversized requests. No silent DPI downgrade. |
| Copy collation | Shared output sequence | Copies expanded in renderer; Electron receives copies=1 to prevent double multiplication. Duplex pairs preserved. |
| Presets | Default presets plus persistent save/update/duplicate/delete/default APIs and controls | Capability validation remains mandatory. Default selection application still needs integration. |
| Poster tiles | Planner and compositor implemented, pure tests pass | Studio controls and price integration remain unfinished; not exposed as a working operator setting. |
| Sized-photo packing | Planner and compositor implemented, pure tests pass | Uniform-size per-source packing; mixed-source packing and advanced photo controls/pricing unfinished. Legacy photo controls retained. |
| Mixed/automatic colour | Pixel analysis and planner implemented | Per-page override UI and final billing integration unfinished; not exposed as working mixed-print controls. |
| Native tray / driver DPI | Real discovery and native helper submission code exists | Direct submission not connected; controls disabled with explanation. Configure through native preferences. |
| Manual duplex | Planning and API schemas only | Physical submission explicitly rejected until retained snapshots and safe continuation are integrated. |
| Pricing rule catalogue | Validated persistent engine APIs | Rule editor, selection and final poster/photo pricing integration unfinished. Legacy configured shop rates retained. |
| Vendor media/finishing/security | Native preferences route | No synthetic tray/media/finishing capabilities or UI-only claims. |
| WhatsApp and notifications | Existing adapters and regression coverage preserved | Requested new stage-template/log system and further health/media-retry work still pending. |

## Real printer capability observation

Microsoft Print to PDF advertised Letter, Tabloid, Legal, Statement, Executive, A3, A4, A5, B4 (JIS), B5 (JIS); no trays; colour; no automatic duplex; 600x600 DPI. JIS B4/B5 are not silently treated as ISO B4/B5. Zero hard margins were reported by this virtual driver. This observation is not a physical printer test.

## Tests and delivery restriction

Development compilation passed. Automated suite: 41 tests passed, zero failures. Nine added planner/processing/capability tests cover page filters, custom grid geometry, scaling, duplex copy pairs, booklet backs, poster tile counts, photo dimensions/cut boundaries, pixel analysis and fail-closed printer capability validation. Existing WhatsApp, migration, payment, backup and print recovery tests remain included.

No version change, release, or installer was created for this continuation. The application remains version 0.4.0. No physical print job or live customer message was sent.

## Physical-sheet pricing and duplex selection fix

Studio now defaults to physical-sheet billing, including when opening an older order for a fresh estimate. Recorded historical totals remain unchanged until the operator explicitly applies the current estimate. Duplex selection is available for planning, preview and PDF export even when the selected driver does not advertise automatic duplex. Physical submission stays disabled until duplex capability is confirmed. Added the 24-page/4-up regression: simplex 6 sheets; duplex 3 sheets, with prices based on the configured sheet rate. No release or installer created.

## Bulk Photo Studio implementation matrix (2026-11-19; supersedes earlier photo-pending notes)

| Option | Implementation / capability status |
|---|---|
| Bulk selection and customer ownership | Implemented; backend checks ready files and identical customer; walk-in selection is explicit |
| Per-photo size/copies, custom mm/cm/in | Implemented; actual dimension-based packing, not area division |
| Auto/grid/rows/columns | Shared pure planner; grid rejects mixed frame sizes; maximum-per-sheet is a limit, not a promise of fit |
| Manual positions and drag | Implemented; validates copy identity, printable bounds, spacing and overlap; Auto Arrange resets positions |
| Crop, rotate, flip, fit/fill, zoom, backgrounds | Output-side editing; originals retained |
| Brightness/contrast/saturation, grayscale/mono | Shared output compositor; explicit operator settings |
| Sharpening / gentle enhancement | Bounded output raster operation; enhancement uses visible saved adjustment values |
| Preview and Save photo sheets PDF | Same packing/composition path as physical submission; no physical-output guarantee |
| A3/A4/A5/Letter/custom paper | PDF export supported within resource limits; physical submission requires actual driver forms |
| Printer printable area / borderless | Queried for chosen paper; layout respects hard margins; borderless checkbox requires advertised support |
| Media, trays and printer quality | Native Printer Preferences; direct driver control is not claimed |
| Billing media category | Price selection only; operator chooses matching real media in native preferences |
| Raster DPI and smoothing | Applied to output; distinct from printer DPI; unsafe combinations rejected |
| Photo pricing | Existing shop sheet rate fallback; saved paper/media policies support sheet/side/photo bases, size rates, setup/tier/minimum/discount/finishing policy fields; UI exposes base/size/setup editing |
| Combined PDF/photo orders | Separate subtotals; PDF copies/N-up/duplex/colour are independent; separate validated submissions within one order |
| Partial submissions | Explicit file selection persisted; completion/ready require latest confirmed coverage of every order file |
| Reprints | Original order retained; each submission keeps settings and selected files |
| HEIC | Unavailable in this verified workflow; installed decoder did not advertise HEIC support |
| Large batches | Existing 40-file order limit; 1000 requested photo prints, 200 sides and bounded raster memory limits apply |
| Hardware and live WhatsApp | Not physically/live tested in this upgrade |

Notification templates must be explicitly saved/enabled by the operator. A batch quiet period coalesces matching events for one rule/customer/account. Accepted is provider acceptance, not delivery; delivery state is shown where the connected integration reports it. Uncertain/restarted sends are retained for verification. Automatic replies obey the existing 24-hour inbound safeguard and account/conversation checks. Unofficial WhatsApp Web reliability/account restrictions still apply.

## Document Scanner

Open a ready image in WhatsApp Inbox or select one or more ready images in Documents, then choose **Auto Scan & Clean**. A batch uses images from one customer and supports up to 40 pages. Review the crop and ink in the comparison viewer. Set the corners manually if automatic edge detection is uncertain. Use Enhanced Color when stamps, signatures or colored annotations matter.

Save a processed PNG separately, export a combined PDF, or send the reviewed pages to Print Studio as one PDF order. The scanner retains page order and preserves aspect ratio when fitting to A4. Print Studio handles printer capabilities, duplex, copies, page range, and pricing. The scanner retains the original attachment and tracks the sources of processed copies.

Preview processing runs in a cancellable worker. Preview dimensions are capped at 1,400 pixels on the longest edge. Full output is capped at 5,600 pixels on the longest edge and 18 megapixels. Large batches can be split if they encounter the combined PDF limits. Review faint marks before using Clean Black & White. Cleanup can improve contrast and lighting, while severe blur and missing detail remain limitations.

Automated coverage uses generated document images with perspective distortion, uneven lighting and colored ink. Physical printing and real customer photographs require separate validation.
