# Roslyn American Darts

Static site for the American darts group at Roslyn VFW Post 3498, 1140 Easton Rd, Abington, PA 19001. It is meant to be hosted at `https://broderick122.github.io/american-darts/`.

There is no build step. Edit the files and refresh. Paths are relative (`images/bar.jpg`, `css/styles.css`) so the site works under the `/american-darts/` subpath. Don’t start those paths with `/`.

`.nojekyll` is included so GitHub Pages serves the files as they are.

## What’s on the page

| Section | What to edit |
| --- | --- |
| Home, About, Schedule, News, Join | Copy in `index.html` |
| Standings, Teams, Score sheet | Don’t hard-code these. They come from the data module. |
| Upload scan sheet | `upload.html`. Photo of the v8 legal keypad sheet or the v7 letter bubble sheet. |
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

## Upload a photo of the scan sheet

`upload.html` is for the end of the night. The current printable sheet is `scoresheet/roslyn_scansheet_v8.pdf` (landscape legal, 14×8.5 in, one page). HOME is the left block and AWAY is the right block, with Games 1–3 inside each block. Each two-digit score is two phone keypads (TENS and ONES): 1-2-3 / 4-5-6 / 7-8-9, and 0 centered below. TEAM TOTAL adds a 100 key to the left of the TENS 0. The older letter sheet is still `scoresheet/roslyn_scansheet_v7.pdf`. Both files are linked from the home page and the upload page. `scoresheet/scansheet_v8_layout_spec.json` and `scoresheet/scansheet_v7_layout_spec.json` are the maps: every key or bubble center is normalized from 0 to 1 between the corner-marker centers.

There is no server and no handwriting recognition. `js/sheet-ocr.js` runs in the browser:

1. Large photos are scaled so the long side is at most 1600 pixels before the corners are measured, and phone EXIF orientation is applied. It finds the solid black corner squares with a local contrast mask, so warm light and uneven shadows still separate a square from the paper, and tries the photo at 0°, 90°, 180°, and 270°. The white notch in the top-left square is the sheet’s top-left whether the photo is upright, sideways, or upside down. The header line and the QR pattern (used as a dark-and-light patch, not decoded) also pick the rotation. The corner-marker rectangle is wider on legal paper than on letter paper, and that aspect ratio chooses v8 or v7. If one corner is cut off, that corner is estimated from the other three and then nudged so the filled marks line up. If the corners still cannot be found, the page shows an error and leaves the form empty instead of guessing a score.
2. A perspective warp straightens the page so those four centers sit on a rectangle.
3. On the v7 letter sheet, each bubble is sampled in a ring inside the printed circle, and for pen ink that is darker than the paper beside it, so a scribble counts as well as a solid fill. On a row of 0–9, the bubble that is clearly darker than the others in that same row is the mark. On the v8 legal sheet the digits are printed darker, so each keypad is judged by how much of the key is covered compared with the other keys in that same pad. The small handwritten score boxes between the two 0 keys are human-only and are not read; their outlines are left out of the coverage sample. No mark means the row is blank, and the box is left empty — it is not stored as 0. Two marks, or a mark too close to call, is flagged for the captain to fix.
4. The team-total “100+” bubble is a flag, not a digit row. Blank means +0. Filled means +100. Shooter totals are two digits (0–99). Team totals can reach 199.
5. Winners are one Home or Away bubble for Game 1, Game 2, Game 3, Beer frame, and Total points. A blank beer frame is allowed. The other winner groups are flagged when they are blank or doubled.

Names, the captain line, and the date are handwritten and are not scanned. The captain types those on the review form.

The review form shows, for home and away, S1–S4 and the team total for each game, plus the winner marks. If the four shooter totals are all filled and they do not add up to the team total, that game gets a warning. The captain can edit any box. Saving uses the same `submitMatch` path as the typed score sheet: Games 1–3 become the match, and standings update immediately (localStorage until Google Sheets is connected). Beer frame and total points are kept on the local upload receipt (`rad.uploads.v1`) and are not league games. The photo is not stored. The confirmed shooter lines are on that receipt too; the match row itself stays `homeGamesWon`, `awayGamesWon`, and `gamesJson`, which is what standings read.

Limits: at least three corner squares have to be in the frame, on a fairly flat sheet. If they are missed, the page shows an error and leaves the form empty. A heavy glare, a crease through a square, or a very blurry photo can still miss a corner or a bubble, and the page then asks for a retake. A very light scribble can be flagged instead of accepted. The reader does not decode the small QR code (it is placeholder text) and does not read handwriting. A blank digit row must be filled in by hand on the form if that shooter did throw.

Check the reader with `node test/read-v7.mjs`. That renders the v7 and v8 PDFs, fills known marks, adds a small rotation, perspective shift, and blur, then checks that the browser reader recovers the values. The v7 photo is also turned 180°. The v8 photo is turned through 0°, 90°, 180°, and 270°, and both photos are read again with the two specs loaded together so the aspect ratio has to pick the version. It also reads `test/fixtures/phone-sheet.jpg`, a real portrait photo of the v7 landscape sheet turned sideways, at 0°, 90°, 180°, and 270°. It needs Python packages `pillow`, `pymupdf`, and `numpy`, plus Chrome. `puppeteer-core` is installed locally for the test (`npm install`) and is not part of the site.

## GitHub Pages

In the repo: **Settings → Pages → Build and deployment → Deploy from a branch**.

- Branch: **main**
- Folder: **/ (root)**

Save. The site is served from `https://broderick122.github.io/american-darts/`.

Merge to `main` before expecting Pages to show this version. Pages reads the branch you select, not an open pull request.

## Colors

The dart palette is the variables at the top of `css/styles.css`.
