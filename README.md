# PO Tracker

Mobile (iOS, Android) and web front end for the SharePoint list **PO Tracking 2026 JRS INC**
on `jrsllc1.sharepoint.com/sites/jrsllc`. It works offline, syncs both ways, and uploads
documents into per-PO folders in a SharePoint document library.

**SharePoint is the only backend.** The list is the database and a document library is the
file store. The app talks only to Microsoft Graph. On the device there is a local SQLite cache
plus queues for changes and uploads. There is no other server, API or cloud storage.

---

## Contents

1. [How it works](#how-it-works)
2. [What the app found in the real list](#what-the-app-found-in-the-real-list)
3. [Before you start: create the document library](#before-you-start-create-the-document-library)
4. [Entra ID app registration](#entra-id-app-registration)
5. [Environment setup](#environment-setup)
6. [Run a development build (iOS / Android)](#run-a-development-build-ios--android)
7. [Run and host the web app](#run-and-host-the-web-app)
8. [Release builds with EAS](#release-builds-with-eas)
9. [Notifications](#notifications)
10. [Tests and checks](#tests-and-checks)
11. [Project structure](#project-structure)
12. [Known limitations](#known-limitations)

---

## How it works

```
 Phone / browser                                         Microsoft 365
┌──────────────────────────────────────────┐            ┌──────────────────────────────┐
│ Screens (expo-router)                    │            │ SharePoint list              │
│   reads ONLY from the local database      │            │  "PO Tracking 2026 JRS INC"  │
│                                          │  Graph v1  │                              │
│ SyncEngine ── outbox (create/update/del) ├──────────▶ │  POST / PATCH (If-Match) /   │
│            ◀─ delta (changes, deletes)   │ ◀──────────┤  DELETE, items/delta         │
│                                          │            │                              │
│ UploadEngine ── upload queue ────────────┼──────────▶ │ Document library             │
│   ≤4 MB PUT · >4 MB resumable session    │            │  {base}/{FOLDER #}/…         │
│                                          │            └──────────────────────────────┘
│ SQLite: items · columns · outbox ·       │
│ uploads · doc_cache · sync_state · …     │
└──────────────────────────────────────────┘
```

- **Reads** always come from SQLite, so the app works offline.
- **Downstream:** the first sync is a full paged load. Later syncs use the list-items **delta**
  endpoint with the stored delta link. Deletions are applied. If the delta token has expired
  (HTTP 410), the app falls back to a full reload.
- **Upstream:** queued changes are sent in order. Updates use `PATCH …/fields` with an
  `If-Match` eTag. On **HTTP 412** the app fetches the server version and opens a conflict
  screen: field-by-field comparison, keep mine, keep SharePoint, or mix per field. Nothing is
  overwritten silently. A PO deleted in SharePoint while you had unsynced edits also becomes
  a conflict: re-create it, or accept the deletion.
- **Offline-created POs** get a temporary id (`tmp_…`). After upload it is replaced everywhere
  with the SharePoint id, including in queued edits and queued documents.
- **Sync triggers:** app start, regaining connectivity, returning to the app, pull to refresh,
  "Sync now", shortly after each local save, a background task on mobile, and every 5 minutes
  while the web app is open. Retries use exponential backoff and honour `Retry-After` on
  429 and 503.
- **Schema:** at runtime the app reads `GET /sites/{id}/lists/{id}/columns` and treats it as
  authoritative. Display names are mapped to internal names. Types, choices and the required
  flag come from SharePoint. Columns that `src/config/schemaGroups.ts` does not know appear
  under **Other**. Hidden and system columns are skipped. **Internal names are never
  hard-coded.**

## What the app found in the real list

I read the live list (read-only) while building this. It differs from the original
spreadsheet in ways the app handles:

| Finding | How the app handles it |
|---|---|
| ~1,536 items | Full first load in pages of 500, then delta. Search, filter and sort run on the device. |
| "FOLDER #" is the list's **Title** column (shown as "Folder") | Mapped by display name and labelled "Folder #". Used to name document folders. |
| **Account Manager** is a **Person** column | Read and written through `AccountManagerLookupId`. Names come from the site's User Information List. |
| Two columns are both titled **Product Source Country** | Both are kept, labelled "Product Source Country" and "Product Source Country (2)". |
| Receiving uses **Carrier / Quantity Received / AWB**; dispatch uses **Carrier through / Qty / AWB#** | Mapped to the Receiving and Dispatch groups (dispatch fields labelled "Carrier", "Qty dispatched", "AWB #"). |
| **Expiry Date** is free text (`12/2026`, `Sep-27`, `31 JAN 2027`, `NA` …) | Kept as text. A tolerant parser powers "expiring soon" alerts. |
| **Ready To Ship- Days** is a calculated column | Shown read-only. |
| **Payment Status** is plain text | The filter offers the values actually present. |
| Site time zone is **Pacific**; date-only values are stored as Pacific midnight | Dates are read and written in the site time zone (`EXPO_PUBLIC_SP_TIME_ZONE`), so they never shift by a day. |
| Extra columns (Fedex costs, Account Manager Update, Remarks) | Shown in the right groups. Any future column appears under **Other** automatically. |

## Before you start: create the document library

You chose a **new, separate library**. In SharePoint (site **Settings › Site contents › New ›
Document library**) create a library, for example **PO Documents 2026**, and put its exact
name in `EXPO_PUBLIC_SP_LIBRARY_NAME`. The app creates one folder per PO inside it, named
from the PO's Folder # value. Set `EXPO_PUBLIC_SP_BASE_FOLDER` if you want the PO folders
inside a sub-folder.

If the library does not exist, the Documents screen says so and lists the libraries it can see.

## Entra ID app registration

Do this once, as someone who can register apps and grant admin consent in the tenant
(tenant ID `e98f8ec2-bb19-4dfc-a89a-e07adee53b2a`).

1. Go to **Entra admin center › App registrations › New registration**.
   - Name: `PO Tracker`
   - Supported account types: **Accounts in this organizational directory only**
   - Leave Redirect URI empty for now, then select **Register**.
2. Copy the **Application (client) ID** into `EXPO_PUBLIC_CLIENT_ID`.
3. Go to **Authentication › Add a platform**:
   - **Mobile and desktop applications**: add the custom redirect URI `potracker://auth`.
     It must match the app scheme `potracker` in `app.config.ts`.
   - **Single-page application** (for the web app): add `http://localhost:8081/auth` for
     development and `https://<your-web-host>/auth` for production.
   - The app is a **public client** using authorization code + PKCE. **Do not create a client
     secret.**
4. Go to **API permissions › Add a permission › Microsoft Graph › Delegated** and add:
   - `User.Read`
   - `Sites.ReadWrite.All`
   - `Files.ReadWrite.All`
   - `offline_access` (also `openid` and `profile`, which are usually present)
5. Select **Grant admin consent for JRS LLC**. `Sites.ReadWrite.All` and `Files.ReadWrite.All`
   need admin consent.

> These are delegated permissions: the app only does what the signed-in user can already do
> in SharePoint. To restrict the app to this one site, an administrator can use `Sites.Selected`
> instead and grant the app access to `/sites/jrsllc` only. That needs a one-off admin grant
> and is not required for the app to work.

## Environment setup

Requirements: Node 20+ (tested with Node 26), npm, and for native builds Android Studio,
Xcode (macOS only) or an [Expo account](https://expo.dev) for cloud builds.

```bash
npm install
```

```bash
cp .env.example .env
```

Edit `.env` (it is git-ignored and never committed):

| Variable | Value |
|---|---|
| `EXPO_PUBLIC_TENANT_ID` | `e98f8ec2-bb19-4dfc-a89a-e07adee53b2a` |
| `EXPO_PUBLIC_CLIENT_ID` | Application (client) ID from the registration |
| `EXPO_PUBLIC_SP_HOST` | `jrsllc1.sharepoint.com` |
| `EXPO_PUBLIC_SP_SITE_PATH` | `/sites/jrsllc` |
| `EXPO_PUBLIC_SP_LIST_NAME` | `PO Tracking 2026 JRS INC` |
| `EXPO_PUBLIC_SP_LIBRARY_NAME` | your document library, for example `PO Documents 2026` |
| `EXPO_PUBLIC_SP_BASE_FOLDER` | optional sub-folder for the PO folders (empty = library root) |
| `EXPO_PUBLIC_SP_TIME_ZONE` | `America/Los_Angeles` (the site's regional setting) |

None of these values are secret: there is no client secret. Missing values are reported on
the app's start screen.

## Run a development build (iOS / Android)

The app uses native modules (secure storage, SQLite, background tasks, notifications), so it
needs a **development build**. Expo Go will not work.

Local build (Android Studio, or Xcode on a Mac):

```bash
npx expo run:android
```

```bash
npx expo run:ios
```

Cloud build with EAS (no local Android Studio or Xcode needed):

```bash
npx eas-cli@latest build --profile development --platform android
```

Install the build on the device, then start the JS server:

```bash
npx expo start
```

## Run and host the web app

The web app is the same code base. Run it locally:

```bash
npm run web
```

It opens at `http://localhost:8081`. Register `http://localhost:8081/auth` as an SPA redirect
URI (see above).

Build static files for hosting:

```bash
npm run export:web
```

This writes a static site to `dist/`. Host it on any static web host, for example
**Azure Static Web Apps** (in the same Microsoft tenant), or **EAS Hosting**:

```bash
npx eas-cli@latest deploy --prod
```

Requirements for the host:

- Serve `index.html` for unknown paths (single-page app fallback), so `/auth` and deep links work.
- Serve over **HTTPS**. Microsoft sign-in requires it outside `localhost`.
- Register `https://<host>/auth` as an SPA redirect URI in the app registration.

The host only serves static files. It stores no data and runs no code: all data stays in
SharePoint. SharePoint itself cannot host this kind of app (it blocks custom script pages).

How the web version differs from mobile:

| | Mobile | Web |
|---|---|---|
| Local database | expo-sqlite | sql.js (SQLite in WebAssembly), saved in IndexedDB |
| Token storage | Keychain / Keystore (expo-secure-store) | browser localStorage (SPA refresh tokens expire after 24 h) |
| Queued files | app document directory | IndexedDB |
| Camera | yes | no (photos and files only) |
| Opening documents | downloads and opens a preview (works offline once downloaded) | opens the file in SharePoint's viewer in a new tab |
| Alerts | background checks (~30 min) and local notifications | browser notifications while the tab is open; checks every 5 min |

## Release builds with EAS

1. Create the EAS project and store the environment values on the server:

   ```bash
   npx eas-cli@latest init
   ```

   ```bash
   npx eas-cli@latest env:create --environment production --name EXPO_PUBLIC_CLIENT_ID --value <client-id> --visibility plaintext
   ```

   Repeat for each `EXPO_PUBLIC_*` variable (and for the `preview` / `development`
   environments if you use them).

2. Build:

   ```bash
   npx eas-cli@latest build --profile production --platform android
   ```

   ```bash
   npx eas-cli@latest build --profile production --platform ios
   ```

3. Submit to the stores, or distribute internally (`preview` profile):

   ```bash
   npx eas-cli@latest submit --platform android
   ```

The bundle identifier and package name default to `com.jrsllc.potracker`. Override them
with `APP_BUNDLE_ID` at build time if needed. Profiles are defined in `eas.json`.

## Notifications

SharePoint cannot push to phones without a server, so alerts are generated **on the device**
from the changes each sync brings in.

- Configure them in **Settings › Notifications**:
  - new PO
  - status changed (optionally only for chosen statuses)
  - remarks on status changed
  - PO assigned to me
  - only POs where I'm the Account Manager
  - product expiring within 30, 60 or 90 days
  - received but not dispatched for 3, 7 or 14 days
  - sync problems
- Your own changes do not alert you. Repeats are suppressed. Bursts are summarised in a
  single notification. Tapping an alert opens the PO.
- On mobile the OS runs the background check about every 30 minutes (often less often on
  iOS), so alerts are **not instant**. On web, alerts work only while the tab is open.

For **instant email alerts**, add SharePoint's built-in list rules (this changes list
settings, so the app does not do it). In the list in a browser: **Automate › Rules › Create
a rule**, then "A column changes" (for example Status) or "A new item is created", and choose
who to notify.

## Tests and checks

```bash
npm test
```

```bash
npm run typecheck
```

```bash
npx eslint .
```

The unit tests (Jest) run the real SQL against Node's built-in SQLite (`node:sqlite`) and
in-memory fakes of the SharePoint list and document library. The sync and upload engines are
pure TypeScript with no UI or Expo imports. Coverage includes:

- **Record sync:** full load (paging, eTags, delta link, `token=latest` fallback), delta apply
  (create, update, delete, change events), outbox ordering and per-item blocking, merging of
  queued edits, temp-id remapping (items, edits, uploads), conflict detection (412 and
  deleted-on-server) with keep mine / keep server / field merge, delta-token expiry, backoff
  and `Retry-After`, and discarding a rejected change.
- **Uploads:** folder creation (once, including the base folder), simple upload, chunked
  upload in 320 KiB multiples, resume after interruption and app restart, new session when
  the old one expired, offline queueing, rename instead of overwrite, blocking when Folder #
  is missing, and uploads queued for offline-created POs.
- Schema mapping, value conversion and validation, site-time-zone dates, expiry parsing,
  notification rules and configuration parsing.

## Project structure

```
app/                     routes (expo-router)
  _layout.tsx            providers, auth guard, sync triggers
  sign-in.tsx, auth.tsx  Microsoft sign-in and its redirect target
  (app)/index.tsx        PO list: search, filters, sort, pull to refresh
  (app)/sync.tsx         sync status, pending / failed items, retry
  (app)/settings.tsx     account, notifications, sign out
  po/new.tsx, po/[id]/   detail, edit, documents
  conflict/[outboxId]    field-by-field conflict resolution
src/
  auth/                  PKCE sign-in, token manager, secure / web token stores
  config/                env.ts (configuration), schemaGroups.ts (display-name groups)
  graph/                 typed Graph client (retry, backoff), sites / lists / drive APIs
  db/                    SQL driver (expo-sqlite native, sql.js web), migrations, repositories
  schema/                column mapping, value conversion, validation, dates, search index
  sync/                  SyncEngine: downstream, upstream, mutations, conflicts, temp ids
  documents/             UploadEngine, file-name rules, file storage and viewer adapters
  notifications/         alert rules (pure) and notifier adapters
  services/              composition root, sync triggers, background task
  components/            UI kit, schema-driven form, pickers, theme (light / dark)
  testing/               fakes used by the tests (never shipped)
```

Files ending in `.web.ts(x)` replace their native counterpart in the web build.

## Known limitations

- The first sync needs a connection (about 1,536 items). After that the app works offline.
- **Web:** use the app in one tab at a time. Two tabs each keep their own copy of the local
  database and can overwrite each other's queue.
- Multi-select Person, lookup, and hyperlink columns are shown read-only. The list currently
  has none.
- List-item attachments are not used. Documents go to the document library, as specified.
- Background sync timing is controlled by iOS and Android.
- Signing out deletes all local data, including changes that have not synced. The app warns
  first and shows how many.
