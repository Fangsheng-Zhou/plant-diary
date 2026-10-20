# Plant Diary

A private plant care log for iPhone, built as a web app you add to your Home Screen.
**New here? Start with the [setup guide](docs/SETUP.md).**

Track watering schedules, feeding and repotting, plant types, cover and progress photos,
and care notes. Share a space (for example Home) with your partner and keep another
(for example Work) to yourself. Colors are customizable in Settings.

Everything personal (plant names, notes, dates, photos and member names) is encrypted
on the phone with AES-256 before it is uploaded. The database only stores scrambled data.

## How it fits together

| Part | What it does | Cost |
| --- | --- | --- |
| GitHub Pages | Hosts the app files | Free |
| Supabase | Stores the encrypted data, logins and photo files | Free plan |
| Cloudflare Worker | Pings the database daily so it never pauses | Free plan |
| iCloud Drive / Google Drive | Where you save encrypted backups | Your existing storage |

## Setup

**Follow the step-by-step [setup guide](docs/SETUP.md).** It covers the one-time setup,
installing on iPhone, creating spaces, inviting someone, backups, keeping the free
database awake, and troubleshooting.

<p>
<img src="docs/images/05-home.png" width="230" alt="Home screen">
<img src="docs/images/06-plant-page.png" width="230" alt="Plant page">
<img src="docs/images/10-home-dark.png" width="230" alt="Dark appearance">
</p>

## Backups

Settings > **Export backup** creates one encrypted file of all unlocked spaces, including
photos. On iPhone, choose **Save to Files** and pick iCloud Drive or Google Drive.
**Restore from backup** brings a backup back as a new space. It needs the passphrase each
space had at the time of the backup.

## Updating the app

Change the files, bump `VERSION` in `sw.js`, and push to `main`. Phones pick up the new
version the next time the app is opened (it reloads itself once). If you add data fields,
add them inside the encrypted JSON in `js/data.js`; no database change is needed.

## Files

| Path | Purpose |
| --- | --- |
| `index.html`, `css/style.css` | App page and styles |
| `js/ui.js` | Screens and interactions |
| `js/data.js` | Sign-in, syncing, offline queue, photos |
| `js/crypto.js` | Encryption (AES-256-GCM, PBKDF2 passphrase keys) |
| `js/model.js` | Watering schedule logic |
| `js/backup.js`, `js/backup-core.js` | Encrypted backup export and restore |
| `js/theme.js` | Color themes |
| `sw.js`, `manifest.webmanifest` | Offline support and Home Screen install |
| `supabase/setup.sql` | Database tables and security rules |
| `keepalive/worker.js` | Daily ping for Cloudflare |
| `vendor/supabase.js` | Supabase JavaScript client (MIT, see `vendor/LICENSE-supabase-js.txt`) |

## License

MIT. See `LICENSE`. The app icon and interface icons are original drawings made for this project.
