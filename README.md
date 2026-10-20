# Plant Diary

A private plant care log for iPhone, built as a web app you add to your Home Screen.
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

## One-time setup

1. **Database.** In Supabase, open **SQL Editor**, paste all of `supabase/setup.sql`,
   and click **Run**. You should see "Success. No rows returned".
2. **Login links.** In Supabase, open **Authentication > URL Configuration**. Set
   **Site URL** to the app address (for example `https://fangsheng-zhou.github.io/plant-diary/`)
   and add the same address under **Redirect URLs**.
3. **Publish.** In this GitHub repository, open **Settings > Pages**. Under
   **Build and deployment**, choose **Deploy from a branch**, branch `main`, folder `/ (root)`,
   then Save. The app appears at the address above within a minute or two.
4. **Keep-alive.** Follow the steps at the top of `keepalive/worker.js`.

## Using it on iPhone

1. Open the app address in Safari, tap **Share**, then **Add to Home Screen**.
2. Open Plant Diary from the Home Screen and create an account. Confirm the email
   (the link may open in Safari, which is fine), then sign in from the Home Screen icon.
   iPhone keeps Home Screen apps separate from Safari, so always use the icon.
3. Create a space such as **Home**, with a passphrase you both know. Save the passphrase
   in a password manager. If everyone forgets it, the data cannot be recovered.
4. To share: open the space in Settings, tap **Invite someone**, and send the code.
   Tell the passphrase in person. The other person creates their own account, chooses
   **Enter invite code**, and unlocks with the passphrase.

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
