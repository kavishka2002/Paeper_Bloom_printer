# BloomConnect

## Install on another Windows PC

Download the Windows x64 setup executable from [GitHub Releases](https://github.com/kavishka2002/Paeper_Bloom_printer/releases) and run it under the Windows account that will use BloomConnect. The installer bundles Electron and the app dependencies. The destination PC can install the downloaded file without a development setup.

For physical printing, install the printer's Windows driver and verify that Windows can print a test page. For WhatsApp, use an internet connection, install Microsoft Edge or Google Chrome if needed, and link the destination PC by QR. Use the backup and recovery procedure below if you also need to move existing customer records and files.


BloomConnect is a local-first Windows desktop workspace for stationery shops. It combines a WhatsApp Business inbox with customers, document intake, print orders, payments and receipts. Local records live in the app's data directory and remain available offline.

## Install and set up

1. Run the Windows x64 NSIS installer in `release`, available after packaging. Run the installer from a source you trust. This development build is unsigned.
2. Open BloomConnect from the Start menu. The seven-step wizard asks for your shop name, navigation language, WhatsApp connection, Windows printer and prices in LKR.
3. Install your printer using Windows first. In BloomConnect, import a PDF or image from **Documents**, create an order in **Print Studio**, and select your printer.
4. After submission, check the physical pages. Use **Print Queue → Confirm printed** to record completion. Manage or cancel Windows spooler jobs in Windows.
5. Record part or all of a payment from **Payments**. Use **Save PDF** to generate a printable receipt.

## Link WhatsApp with QR

In setup, or in **Settings → WhatsApp connection**, choose **Link with QR code**. On your phone, open **WhatsApp → Linked devices → Link a device** and scan the code. This path uses Microsoft Edge or Google Chrome installed on Windows and requires no Meta access token or public webhook. Once it shows **Connected**, BloomConnect loads recent messages from up to 30 individual chats, with up to 20 messages per chat. In **WhatsApp**, use **Sync recent chats** to refresh. For a specific customer, search by name or number, open the conversation and choose **Chat documents → Load chat documents**. This searches up to 200 messages WhatsApp Web can load for that chat. New direct messages and supported PDF/image attachments feed the inbox and active automation rules. Historical messages are imported for display. Messages you send from your phone also appear while BloomConnect is connected. Click an older PDF or image in the chat to download and preview it if WhatsApp still makes the file available. Downloads of historical or sent files do not run automation. Turn on a PDF rule in **Automation** to create orders as files arrive. Keep BloomConnect running for live intake.

The QR adapter uses the unofficial `whatsapp-web.js` library. WhatsApp updates can break compatibility, and automated use can result in restrictions under WhatsApp's terms. The Windows profile stores the linked browser session locally; it is excluded from backups. Unlink the device from the phone if local removal cannot reach WhatsApp. Group chats and complete history are outside this mode's scope. If WhatsApp keeps a customer phone number private, BloomConnect can still show the chat using its linked account identity. Manual replies can use the verified phone number or saved direct-chat identity for an existing conversation on the linked account. Automatic replies in BloomConnect require a recent customer message.

## Connect Meta Cloud API

BloomConnect also supports the official WhatsApp Business Platform Cloud API. A Meta Business account, WhatsApp Business Account, an API phone number, a Meta app with WhatsApp configured, and a valid access token with messaging permissions are required. Use the Graph API version enabled for your Meta app. Select **Settings → WhatsApp connection → Meta Cloud API connection → Configure connection** and enter the phone number ID, access token, Meta app secret and a unique webhook verification token of at least 16 characters. BloomConnect stores these credentials using Windows DPAPI for the current user.

Meta requires a public HTTPS webhook. Configure your existing HTTPS reverse proxy or tunnel to forward **only** `/whatsapp/webhook` to `http://127.0.0.1:47832/whatsapp/webhook` and preserve the raw POST body and `X-Hub-Signature-256` header. Keep the desktop app running. In Meta, set the callback URL and the same verification token, subscribe to the WhatsApp `messages` field and ensure the app is subscribed to the correct WhatsApp Business Account. The shop must provide and operate the public endpoint. Meta's account, usage and delivery rules apply.

**API reachable** means the API credential probe succeeded. Webhook verification is shown separately and does not prove continuing public endpoint availability. Test your setup from an actual WhatsApp account using a text, PDF and image, and verify they appear under the sender's conversation. Create and enable a **PDF imported → Create print order** automation before testing automatic order creation. Free-form replies are restricted to the active 24-hour customer-service window. Local rule tests never send messages. The Cloud API adapter has no chat history synchronization.

[Meta WhatsApp documentation](https://developers.facebook.com/documentation/business-messaging/whatsapp/overview/)

## Backup and recovery

Use **Settings → Save backup** and select a destination outside the application data directory. Backups contain customer data. Store them in an access-controlled location. Credentials remain on the Windows account that configured them and are excluded from backups.

To validate a backup on a development machine, run `node scripts/validate-backup.cjs "<backup folder>"` after `npm ci`. The validator checks SQLite integrity, required tables, referential integrity and document checksums. For manual recovery, close BloomConnect, preserve the current `%APPDATA%\BloomConnect` directory with its SQLite sidecar files, and copy the validated `bloomconnect.sqlite` and `documents` into a fresh BloomConnect data directory. Launch the application and configure the appropriate WhatsApp connection again. Store the previous data directory until you verify recovery.

## Trial and license purchases

BloomConnect locks the workspace after its 48-hour trial or when a paid license expires. The license screen stays available for copying the Device ID, opening the purchase chat, and activating a signed code. Customers send the prefilled WhatsApp message themselves.

Run the owner issuer from the Windows account where it was initialized. After confirming payment, issue a code for the customer's Device ID and purchased duration, then send the resulting code to the customer.

```powershell
node scripts/issue-license.mjs issue "<Device ID>" 365 "<Customer name>"
```

The customer pastes it into **License Key** and selects **Activate License**. The issuer accepts durations from 1 to 365 days. The private key is protected by Windows DPAPI at `%LOCALAPPDATA%\BloomConnectIssuer\signing-key.dpapi`. Keep the signing key and access to its Windows account for future renewals. Customer builds use the public key in `packages/licensing/public-keys.json`.

### Mobile License Generator

1. The desktop build includes the website public JWK from the existing owner vault. See [Desktop license integration](license-integration/README.md) for provenance, exported artifacts, and verification steps. Future key additions belong in **packages/licensing/website-public-keys.json**. Preserve existing trusted entries and the Ed25519 keys in **packages/licensing/public-keys.json**. The encrypted backup and passphrase stay with the owner.
2. Build BloomConnect. In the customer's updated Windows app, open **View License** or the activation screen and select **Copy Device ID**. In the generator, paste that ID exactly and generate the license with the start date and duration. Website licenses start at midnight UTC on the issue date.
3. On the customer PC, select **Enter New License** if needed, then **Paste License** and **Activate License**. The same process renews an existing license. Internet access is needed only if the customer chooses to contact support through WhatsApp.
4. If a Windows reinstall or hardware change produces a different Device ID, the owner should check the purchase and reissue the license for the new ID and remaining entitlement. Keep the customer's existing workspace data and backups. The old code remains bound to its original device and expires on its signed date.

The desktop checks the signed expiry and persists a recent clock checkpoint in its DPAPI-protected application data. Clock movements of up to two minutes use the saved or monotonic time floor. Larger rollbacks block access until Windows time is corrected. An offline machine has no trusted remote clock or revocation channel. A local administrator can manipulate the OS clock, restore old system or storage snapshots, or alter the application. Offline expiry mitigates ordinary clock rollback and cannot provide server-grade enforcement.

Run **node --test tests/offline-license.test.cjs** for the checked-in Web Crypto interoperability vector. To test issuing and activating directly from a generator checkout on Windows, run **node scripts/test-license-store.cjs "<generator checkout>/shared/license.ts"**. The test uses an ephemeral signing key and an isolated Windows license store.

## Build from source

Use Node.js 22.14 or later on Windows x64.

```powershell
npm.cmd ci
npm.cmd run build
npm.cmd test
npm.cmd run dev
npm.cmd run installer
```

The desktop main process owns privileged Windows operations and validates renderer IPC. A separate Node.js child process owns SQLite, incoming webhooks, media and automation. The React renderer has context isolation, a sandbox, a limited preload bridge and a local app protocol. PDF.js prepares printable pages and Sharp validates supported raster files. The NSIS configuration preserves application data during updates and uninstall.

See [DEVELOPMENT_STATUS.md](DEVELOPMENT_STATUS.md) for verification and limitations.
