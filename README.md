# Roslyn American Darts

Static site for the American darts group at Roslyn VFW Post 3498, 1140 Easton Rd, Abington, PA 19001. It is meant to be hosted at `https://broderick122.github.io/american-darts/`.

There is no build step. Edit the files and refresh. Paths are relative (`images/bar.jpg`, `css/styles.css`) so the site works under the `/american-darts/` subpath. Don’t start those paths with `/`.

`.nojekyll` is included so GitHub Pages serves the files as they are.

## What’s on the page

| Section | What to edit |
| --- | --- |
| Home, About, Schedule, News, Join | Copy in `index.html` |
| Standings, Teams, Score sheet | Don’t hard-code these. They come from the data module. |
| Upload score sheet | `upload.html`. Experimental photo reading. |
| Photos | Files in `images/`. Captions in `index.html`. |
| Admin | `admin.html` |

**SAMPLE** means an invented name, number, or date. The starter teams, players, matches, the schedule table, and the news posts are SAMPLE.

**PLACEHOLDER** means the slot is empty on purpose: the group’s story, post hours, the contact note, an exterior photo, and darts photos.

The VFW phone, `(215) 576-9349`, is the post’s public number and belongs in Location. Don’t put a personal email or a personal phone in Join / Contact.

## Photos

`images/bar.jpg` is the bar photo and is used in the hero and the gallery. The three flyers (`flyer-sunday-football.jpg`, `flyer-eagles.jpg`, `flyer-pool-night.jpg`) are the “Life at the VFW” strip. They are VFW events, not the darts schedule.

The dashed frames are for an exterior shot and for darts photos. Drop a file in `images/` and replace the dashed `shot-missing` block with a real `<img>`.

## Standings

A confirmed score sheet updates the standings on the page immediately. No one retypes the table.

Points = games won, plus 2 for a match win, plus 1 for a tie.
Rank is by points, then wins, then games won. Teams level on all three share a rank.

The same math is in `js/data.js` (`calculateStandings`) and `apps-script/Code.gs` (`rebuildStandings_`). If you change one, change the other.

## Where the data lives

`js/data.js` is the only data layer.

- **Not set up yet.** `config.js` still has `YOUR_GOOGLE_SHEET_ID` and `YOUR_APPS_SCRIPT_WEB_APP_URL`. Everything stays in this browser’s `localStorage`. Another phone will not see it. The page starts with SAMPLE teams so the layout isn’t empty.
- **Sheet connected.** Reads come from the published spreadsheet (Teams, Players, Matches) through the gviz endpoint. Writes from the score sheet and the admin page go to the Apps Script web app (`doPost`). The page still recalculates standings locally the moment you save, then sends the same change to the sheet. If the published sheet is a minute behind, this browser keeps the new row and shows it anyway.

The spreadsheet also has a Standings tab. The script rewrites that tab on every save so a person looking at the sheet sees the same numbers. The website does not read that tab. It calculates from Teams and Matches so a save can show up before Google’s published copy refreshes.

`data/sample-backup.json` is the SAMPLE starter in the backup format.

## Admin

Open `admin.html`. From there you can view, add, edit, and delete teams, players, and matches. Every save recalculates standings.

Export downloads a JSON backup. Import replaces the whole set, then standings recalculate. “Restore SAMPLE starter” does that with the mock rosters.

### This lock is not real security

GitHub Pages is a pile of files. There is no private server.

- Until Apps Script is connected, the passcode is `fallbackAdminPasscode` in `config.js`. Anyone can read that file. The mock value is `CHANGE_ME`.
- After Apps Script is connected, admin saves must include the `ADMIN_SECRET` stored in the script properties. The browser sends that secret. Someone using the admin page can see the request.
- Public score sheets do not need the secret, so a visitor can record a match. That’s deliberate. Don’t put private phone numbers, emails, or anything sensitive in the sheet.

## Connect Google Sheets

Cost for a league this size: **$0** on a normal free Google account. You do not need Google Workspace. The sheet counts toward the 15 GB that comes with the account; match rows will not fill that. Apps Script’s free quota is far above a weekly league. Quota details: [developers.google.com/apps-script/guides/services/quotas](https://developers.google.com/apps-script/guides/services/quotas).

Leave the placeholders in `config.js` until you have real values. Don’t invent an ID.

1. Create a blank Google spreadsheet. Name it Roslyn American Darts.
2. Copy the spreadsheet ID from the address bar. In `https://docs.google.com/spreadsheets/d/SPREADSHEET_ID/edit` the ID is the middle piece. That becomes `sheetId`.
3. In the spreadsheet: **Extensions → Apps Script**. Delete the sample function. Paste the full contents of `apps-script/Code.gs`. Save.
4. Choose the function `setupSheets` and **Run**. Approve the permission prompt. The script only edits this spreadsheet.
5. Confirm the tabs **Teams**, **Players**, **Matches**, and **Standings** exist, with a bold header row frozen at the top.
6. In the Apps Script editor open **Project Settings** (the gear). Under **Script properties** add a property:
   - Property: `ADMIN_SECRET`
   - Value: a passcode you make up
   Do not put that passcode in `config.js` or in git.
7. **Deploy → New deployment**. Click the gear and choose **Web app**.
   - Execute as: **Me**
   - Who has access: **Anyone**
   Deploy, and copy the web app URL. It looks like `https://script.google.com/macros/s/DEPLOYMENT_ID/exec`. That becomes `scriptUrl`.
   “Anyone” is required. “Anyone with a Google account” will block the public score sheet.
8. If you change `Code.gs` later: **Deploy → Manage deployments → Edit → Version: New version → Deploy**. The URL stays the same.
9. Share the spreadsheet: **Share → General access → Anyone with the link → Viewer**. Visitors’ phones read it directly, so it cannot be private.
10. **File → Share → Publish to web → Entire document → Publish.** The site reads each tab by name through gviz, using the spreadsheet ID, not the publish-to-web link. Publishing is what makes that read reliable.
11. In `config.js`, replace `YOUR_GOOGLE_SHEET_ID` and `YOUR_APPS_SCRIPT_WEB_APP_URL`. Leave them untouched until you have the real values from steps 2 and 7. Do not commit `ADMIN_SECRET`.

12. Open the web app URL in a browser. You should see JSON like `{"ok":true,"service":"roslyn-american-darts","adminSecretSet":true}`. If `adminSecretSet` is false, step 6 was skipped.
13. Reload the site, submit a score sheet, and check the Matches tab. The standings on the page change as soon as you confirm. Another phone may take a minute while Google refreshes the published copy.

Practice scores saved in `localStorage` before you connect the sheet are not uploaded automatically. Export JSON from Admin first if you want to keep them, then Import after the sheet is connected.

### Sheet columns

`setupSheets` writes these headers. Don’t rename the tabs or the headers.

**Teams:** `id`, `name`, `active`, `sample`, `updatedAt`

**Players:** `id`, `teamId`, `name`, `active`, `sample`, `updatedAt`

**Matches:** `id`, `date`, `homeTeamId`, `awayTeamId`, `homeGamesWon`, `awayGamesWon`, `gamesJson`, `submittedAt`, `updatedAt`, `sample`

**Standings** (written by the script, not typed by hand): `rank`, `teamId`, `teamName`, `wins`, `losses`, `ties`, `gamesWon`, `points`, `updatedAt`

`active` and `sample` are the text `true` or `false`. `gamesJson` is a JSON list of games (`winner` is `home` or `away`).

### What the script accepts

Public, no secret: `submitMatch` (adds a match; sending the same id again does not duplicate it).

Admin, secret required: `saveTeam`, `deleteTeam`, `savePlayer`, `deletePlayer`, `saveMatch`, `deleteMatch`, `importData`.

`verifyAdmin` is a `doGet` so the admin page can check the secret and read the answer. Data reads for the public page stay on the gviz endpoint, not on `doGet`.

A team that is on a match cannot be deleted. Delete the matches first, or rename the team. Deleting a team also removes its players.

## Upload a photo of the paper sheet (experimental)

`upload.html` is for the end of the night: a captain photographs the filled v2 score sheet and the browser tries to read it. There is no server. [Tesseract.js 5.1.1](https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js) runs in the phone, and `scoresheet/layout_spec.json` is the map of the printed boxes (the same spec the sheet generator writes).

The page looks for the four black corner squares, straightens the photo, and crops known fields. Filled winner bubbles are counted as ink. Blank digit boxes are skipped so they are not read as 0. Inning digits and the team names then go through Tesseract. Games 1–3 (innings 1–18) become the match score. The beer frame is shown and is not a league game. Extra innings 19–20 count only toward the sheet’s point total.

The reading lands in an editable form: team names, games won, and the final score. The captain fixes mistakes and saves. The save uses the same data module as the typed score sheet, so standings update immediately. Until Google Sheets is connected, that save stays in `localStorage`. A short receipt is also kept under `rad.uploads.v1`. The photo itself is not stored.

Handwriting OCR on a static page is rough. The typed score sheet on the home page is the reliable path. A later version could send the photo to a hosted vision API (Google Cloud Vision document text is about $1.50 per 1,000 images, with the first 1,000 a month free, so a small league stays at $0) or to Amazon Textract (about $1.50 per 1,000 pages for plain detection). That needs a small backend, because a browser should not hold a cloud API key. The typed form remains the $0 option that does not depend on a vendor.

## GitHub Pages

In the repo: **Settings → Pages → Build and deployment → Deploy from a branch**.

- Branch: **main**
- Folder: **/ (root)**

Save. The site is served from `https://broderick122.github.io/american-darts/`.

Merge to `main` before expecting Pages to show this version. Pages reads the branch you select, not an open pull request.

## Colors

The dart palette is the variables at the top of `css/styles.css`.
