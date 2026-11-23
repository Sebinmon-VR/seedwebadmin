# SEED Web Admin — Website Control Panel

A standalone control panel for managing a website's content and admission enquiries.
The website itself lives elsewhere. It reads content from this panel's **public API** and
posts its admission form here.

## Features

| Section | What admins can do |
|---|---|
| **Dashboard** | New enquiries, live and upcoming events, content counts, a 14-day enquiry chart and quick actions |
| **Posts** | News and articles with a rich-text editor (headings, lists, links, inline images), cover image, category, draft/published status and scheduled publishing |
| **Photo gallery** | Drag and drop up to 50 photos at a time, sort them into albums, feature or hide photos, bulk delete or move to another album |
| **Videos** | Upload video files (MP4/WEBM/MOV) with a progress bar, or paste YouTube / Vimeo / Facebook links (embed URL and thumbnail are worked out automatically) |
| **Events & live** | Events with start and end times, venue, cover image and live-stream link. A **Go live / End live** button. An event also counts as live automatically between its start and end times |
| **Notices** | Circulars and announcements with a priority (normal, important, urgent), pin to top, scrolling-ticker flag, "show from" and "hide after" dates, and a PDF/Word/Excel attachment |
| **Admission enquiries** | An inbox filled by the website form. Status tabs (New, Contacted, Visited, Enrolled, Closed), search, date filters, internal notes, Call/WhatsApp/Email buttons, CSV export (opens in Excel), and manual entry for walk-ins and phone calls |
| **Website settings** | Institution name, logo, contact details, address, map link, social links, and an "admissions open" switch with a message |
| **Website API** | Built-in developer page listing every endpoint, plus a copy-paste admission form snippet |
| **Admins** | Several admin accounts. Each admin can change their own profile and password |

The panel is responsive and works on phones.

## Tech

- **Node.js 22.13+** (uses the built-in `node:sqlite`, so there's no database server to install)
- Express 5, Multer (uploads), Helmet (security headers), sanitize-html
- The admin UI is plain HTML/CSS/JS ES modules with **no build step**
- Data is stored in `data/cms.sqlite` and files in `uploads/`

## Getting started

```bash
npm install
cp .env.example .env      # then edit it (see below)
npm start                 # or: npm run dev  (auto-restarts on changes)
```

Open http://localhost:4000 and sign in.

On first start, an admin account is created from `ADMIN_EMAIL` / `ADMIN_PASSWORD`. If no
password is set, a random one is printed in the console. To add an admin or reset a
password from the command line:

```bash
npm run admin:create -- someone@example.com '<new-password>' "Their Name"
```

### Configuration (`.env`)

| Variable | Purpose |
|---|---|
| `PORT` | Port to listen on (default `4000`) |
| `PUBLIC_BASE_URL` | Public URL of this panel, e.g. `https://admin.example.com`. Used to build absolute image/video URLs in the API |
| `ALLOWED_ORIGINS` | Comma-separated website origins allowed to call the API from the browser, e.g. `https://www.example.com,https://example.com`. `*` allows any origin |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | First admin account (used only when no admin exists yet) |
| `COOKIE_SECURE` | Set to `true` when served over HTTPS |
| `TRUST_PROXY` | Number of reverse proxies in front of the app (e.g. `1` behind nginx), so rate limits see real visitor IPs |
| `MAX_IMAGE_MB`, `MAX_VIDEO_MB`, `MAX_FILE_MB` | Upload size limits |
| `DATA_DIR`, `UPLOAD_DIR` | Where the database and uploads are stored (default `./data`, `./uploads`; on Azure `/home/data/seedwebadmin`) |

## Connecting your website

Base URL: `PUBLIC_BASE_URL/api/public`. Everything below only returns published, currently
visible content, with absolute file URLs. The **Website API** page inside the panel has
copy buttons and a ready-made form snippet.

| Method | Endpoint | Returns |
|---|---|---|
| GET | `/home` | Everything a homepage needs: settings, ticker, notices, live & upcoming events, latest posts, featured photos & videos |
| GET | `/settings` | Name, logo, contacts, social links, `admissions_open`, `admission_message` |
| GET | `/notices?category=&ticker=1&page=&limit=` | Visible notices, with pinned and urgent ones first |
| GET | `/notices/:id` | One notice |
| GET | `/events?when=upcoming\|live\|past` | Events with `state` (`upcoming`, `live`, `past`, `cancelled`) and `live_embed_url` |
| GET | `/events/:id` | One event |
| GET | `/posts?category=&q=&page=&limit=` | Published posts (summary fields) |
| GET | `/posts/:slug` | One post including `content` (sanitised HTML) |
| GET | `/gallery?album=&featured=1` | Photos |
| GET | `/gallery/albums` | Albums with photo counts and cover image |
| GET | `/videos?category=&featured=1` | Videos with `video_url`, `embed_url`, `thumbnail_url` |
| POST | `/enquiries` | Submits an admission enquiry |

List endpoints return `{ items, total, page, limit, pages }`.

### Admission form

`POST /api/public/enquiries` accepts JSON or a normal form post.

- **Required:** `student_name`, `phone`
- **Optional:** `parent_name`, `email`, `class_applying`, `date_of_birth` (YYYY-MM-DD), `previous_school`, `message`, `source`

Spam protection:
- Each visitor is limited to 5 submissions per 10 minutes.
- Add a hidden `website` field to the form as a honeypot. Bots fill it in, and those submissions are silently dropped.

A plain HTML form with no JavaScript also works. Add a hidden `_redirect` field with the page
to return to. The visitor is sent back with `?enquiry=sent` or `?enquiry=error`. The
`_redirect` URL must be on one of the `ALLOWED_ORIGINS`.

```js
const res = await fetch('https://admin.example.com/api/public/enquiries', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ student_name: 'Riya', phone: '+91 98765 43210', class_applying: 'Grade 3' }),
});
const data = await res.json(); // { ok: true, message } or { error, fields }
```

## Deploying to Azure App Service

Every push to `main` runs [.github/workflows/azure-deploy.yml](.github/workflows/azure-deploy.yml).
The workflow installs dependencies, starts the server and smoke-tests it, then deploys to Azure.

**Storage:** the app uses App Service's built-in persistent storage, so there's no separate storage account or database to create.
On Azure the app detects the platform and keeps the database and uploads in `/home/data/seedwebadmin`.
That folder survives restarts and redeploys. The site URL, HTTPS cookies and proxy settings are also detected automatically.

### One-time setup

1. **Create the Web App.** In the Azure portal, go to **Create a resource → Web App** and choose:
   - **Name:** `seedwebadmin` (or another name). The panel will be at `https://<name>.azurewebsites.net`.
   - **Publish:** Code. **Runtime stack:** Node 24 LTS. **Operating system:** Linux.
   - **Pricing plan:** Basic B1, which includes 10 GB of storage and Always On. Free F1 works for a trial, but it has 1 GB of storage and sleeps when idle.
2. **Configure it.** In the Web App:
   - **Settings → Environment variables.** Add:
     | Name | Value |
     |---|---|
     | `ADMIN_EMAIL` | the first admin's email |
     | `ADMIN_PASSWORD` | a strong password, used only to create the first admin |
     | `ALLOWED_ORIGINS` | your website's address, e.g. `https://www.yourschool.com,https://yourschool.com` |
   - **Settings → Configuration → General settings.** Set:
     - **Startup Command:** `npm start`
     - **SCM Basic Auth Publishing Credentials:** On (needed for the publish profile)
     - **Always On:** On (B1 and higher)
   - Keep **Scale out** at **1 instance**. The app uses a single SQLite file.
3. **Connect GitHub.** Go to **Overview → Download publish profile**. Then, in the GitHub repo, go to **Settings → Secrets and variables → Actions**:
   - New **secret** `AZURE_WEBAPP_PUBLISH_PROFILE`, with the whole contents of the downloaded file as its value.
   - If the Web App isn't named `seedwebadmin`, also add a **variable** `AZURE_WEBAPP_NAME` set to its name.
4. **Deploy.** In GitHub go to **Actions → Build and deploy to Azure App Service → Run workflow**, or push to `main`.
   Then open `https://<name>.azurewebsites.net` and sign in.

Until the secret exists, the workflow still builds and tests, but skips deployment with a warning.

### Good to know

- **Custom domain** (e.g. `admin.yourschool.com`): add it under **Custom domains**, then set `PUBLIC_BASE_URL=https://admin.yourschool.com`.
- **Backups:** everything lives in `/home/data/seedwebadmin` (`cms.sqlite` plus `uploads/`). You can download it from **Advanced Tools (Kudu) → Debug console**.
- **Large videos:** Azure cuts off any request that runs longer than about 4 minutes. On slow connections, upload long videos to YouTube and add them as links.
- **Logs:** **Monitoring → Log stream** shows the server output. That includes the generated admin password if `ADMIN_PASSWORD` was left empty.

### Other hosts

On any Node 22.13+ server, run `npm start` behind nginx or Caddy with HTTPS. Set
`PUBLIC_BASE_URL`, `COOKIE_SECURE=true` and `TRUST_PROXY=1`, and back up `data/` and `uploads/`.

## Security notes

- Passwords are hashed with scrypt.
- Sessions are httpOnly, SameSite=Strict cookies that last 7 days. Changing your password signs out your other devices.
- Admin API write requests must send an `X-Requested-With` header, which blocks cross-site request forgery.
- Login is rate-limited to 10 failed attempts per 15 minutes.
- Uploads are checked by both file extension and MIME type. SVG and HTML files are rejected, and stored files get random names.
- Post HTML is sanitised on the server.
- The CSV export escapes values that could run as spreadsheet formulas.

## Project layout

```
server/
  index.js          app setup, security headers, routing
  config.js db.js   configuration and SQLite schema
  auth.js           password hashing, sessions, admin guard
  upload.js         file upload rules and cleanup
  crud.js           shared list/create/update/delete logic
  routes/           content, enquiries, account/settings/dashboard, public API
admin/              the control panel UI (static files)
scripts/            command-line helpers
```
