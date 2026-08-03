# Litwalls Studio

A local-only dashboard that turns a folder of poster artwork into published
Shopify products: crop to four print sizes, render room mockups, draft a title
matching the store's naming convention, file print-ready files to Google Drive,
and create the product with four priced size variants.

Sibling project to the `litwalls` storefront. **This is never deployed** — it
runs on one machine, on demand.

## Why it is a separate project

Studio needs an Admin token with `write_products`; the storefront deliberately
has one scoped to `write_files` only. Keeping them apart means the storefront
ships nothing it does not need, and no pipeline code, `sharp` binary, or
credential ever reaches production.

The cost is two constants that must agree across repos — the print size table
and the Admin API version. `npm run check:drift` reads them straight out of
`../litwalls` and fails the dev server if they diverge. See
`scripts/check-drift.mjs`.

## Setup

```bash
npm install
cp .env.example .env.local   # then fill it in
npm run dev
```

### 1. Shopify

Settings → Apps and sales channels → Develop apps → your app → Configuration →
Admin API scopes. Add `write_products` and `read_products` to the existing
`write_files`, save, then **reinstall** the app to issue a token.

> Reinstalling invalidates the previous token. The storefront uses it for
> custom-poster uploads, so paste the new value into **both**
> `litwalls/.env.local` and `litwalls-studio/.env.local` before moving on.

Copy `SHOPIFY_STORE_DOMAIN` and `SHOPIFY_STOREFRONT_ACCESS_TOKEN` from the
storefront's `.env.local` unchanged.

### 2. Gemini

[aistudio.google.com](https://aistudio.google.com) → Get API key. The free tier
is ample at this volume.

Studio runs without it: jobs fall back to a filename-derived subject and a
centre crop, badged in the review UI so you know what still needs a look.

### 3. Google Drive

[console.cloud.google.com](https://console.cloud.google.com) → new project →
enable the **Google Drive API** → OAuth consent screen (External; add yourself
as a test user) → Credentials → Create OAuth client ID → **Web application** →
authorised redirect URI:

```
http://localhost:3000/api/drive/callback
```

Studio authenticates **as you** rather than with a service account, because a
service account has no Drive storage quota of its own — its uploads either fail
or produce files owned by a robot that nobody can find in their own Drive.

Scope is `drive.file`, so Studio can only ever touch files it created.

## Layout

```
src/lib/print/      pure, shared with the browser — sizes, titles, split geometry
src/lib/pipeline/   server-only — the stage runner and job store
src/lib/image/      cropping, compositing, the perspective warp
src/lib/shopify/    Admin + Storefront clients, publishing, numbering
mockup-templates/   your room backgrounds (committed)
product-images/     reusable gallery images: size guide, quality info (committed)
workspace/          job state and rendered files (gitignored)
```

`workspace/` holds original artwork and the Google Drive refresh token. It is
gitignored and must stay that way.

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Drift check, then the dashboard on :3000 |
| `npm test` | Pure-logic tests, run against a snapshot of the real catalogue |
| `npm run check:drift` | Verify mirrored constants still match `../litwalls` |
| `node scripts/refresh-titles.mjs` | Re-snapshot live product titles for the tests |

## Notes

**Do not add `proxy.ts`.** With one present, Next buffers the whole request body
in memory (10MB default) and **silently truncates** anything larger — the
request does not fail. A 25MB poster posted to `/api/ingest` would arrive as a
corrupt 10MB file with only a console warning. There is no auth to enforce here,
so there is no reason to add one.

**Do not add `--hostname 0.0.0.0` to the dev script.** It is the only thing that
would make this reachable from the LAN, and there is no authentication behind it.
