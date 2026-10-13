# Roslyn American Darts

Static mock splash site for the American darts group that plays at the Roslyn VFW in Roslyn, Pennsylvania.

After GitHub Pages is turned on, the site is served at:

`https://broderick122.github.io/american-darts/`

There is no build step. Paths are relative so the page works in that `/american-darts/` subpath.

## Files

| File | What it is |
| --- | --- |
| `index.html` | All of the page copy and sections |
| `css/styles.css` | Layout, type, and the dartboard colors |
| `js/main.js` | Mobile menu, which nav item is current, and the sample form |
| `img/board.svg` | Decorative dartboard in the hero |
| `favicon.svg` | Small bullseye icon |
| `.nojekyll` | Tells GitHub Pages to serve these files as-is |

## How to edit the content

Open `index.html` and replace the copy in place. Sections, in order:

1. Hero — the name and the line “Home of American darts at the Roslyn VFW”
2. About
3. Schedule / league nights (the table)
4. Standings (the table)
5. Teams and players (the cards)
6. Location — Roslyn VFW, with a Google Maps search for `Roslyn VFW Roslyn PA`
7. News and updates
8. Join / contact — a form that does not send anywhere

Every invented name, date, and number is marked **SAMPLE**. When you replace one with a real fact, delete that `SAMPLE` label. Paragraphs that start with “Placeholder” are filler for you to rewrite.

The meeting place on this mock is only “Roslyn VFW, Roslyn, Pennsylvania.” Do not add a street address unless you mean to publish one. The map button uses this search, and Google supplies the result:

`https://www.google.com/maps/search/?api=1&query=Roslyn+VFW+Roslyn+PA`

This mock does not list a phone number or an email. The join form shows a note and does not submit. To take real messages, replace the form in `index.html` and the handler at the bottom of `js/main.js` with the contact method you want.

Colors live at the top of `css/styles.css` if you want a different green, red, or brass.

To preview locally, open `index.html` in a browser, or from this folder run:

```bash
python3 -m http.server 8000
```

Then visit `http://localhost:8000/`.

## GitHub Pages

Merge this site to `main`, then in the repo:

**Settings → Pages → Build and deployment → Deploy from a branch → Branch: `main` / folder: `/ (root)` → Save.**
