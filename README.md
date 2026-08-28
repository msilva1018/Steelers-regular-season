# Sixth Street Pick 'Em

A private board for the Steelers 2026 regular season pick pool. Static site, no backend,
no build step. Scores update themselves from ESPN's public NFL feed.

## Files

| File | What it does |
|---|---|
| `index.html` | Page structure and all styles |
| `data.js` | **The only file you normally edit.** Picks, passphrase hash, schedule, manual results |
| `bridge.js` | The Roberto Clemente Bridge, built procedurally in three.js |
| `app.js` | Passphrase gate, live results, scoring, rendering |
| `test.js` | Node checks for the scoring logic. Not served to the browser |

## Deploy to GitHub Pages

1. Create a repo, for example `sixth-street-pickem`.
2. Drop `index.html`, `data.js`, `bridge.js`, and `app.js` in the root.
3. Settings → Pages → Build and deployment → Source: **Deploy from a branch**, branch `main`, folder `/ (root)`.
4. Wait a minute. The URL will be `https://<your-username>.github.io/sixth-street-pickem/`.

That is it. No Actions, no Jekyll config needed.

## Passphrase

Default is `sixburgh`. Case does not matter, the input is lowercased before hashing.

To change it, replace `PASS_HASH` in `data.js` with the SHA-256 of your new passphrase in
lowercase. Fastest way: open the deployed page, press F12, and paste this in the console:

```js
crypto.subtle.digest('SHA-256', new TextEncoder().encode('yournewpass'))
  .then(b => console.log([...new Uint8Array(b)].map(x => x.toString(16).padStart(2,'0')).join('')))
```

**Read this part.** The gate is a speed bump, not security. GitHub Pages serves static files,
so the picks and the hash both sit in a public repo where anyone who thinks to open dev tools
can read them. That is fine for keeping coworkers from casually clicking in. It is not fine for
anything you would actually mind a stranger seeing. If you want it genuinely private, make the
repo private, which needs a paid GitHub plan for Pages.

## Editing picks

`PREDICTIONS` in `data.js`. Keys are week numbers, values are `W` or `L` from the Steelers'
side. Week 9 is the bye and is not listed. Add or remove a person by adding or removing an
object. Everything else, standings, board columns, split-game detection, adjusts automatically.

## If the live feed breaks

The page tries ESPN, falls back to the last successful pull cached in the browser, then falls
back to `MANUAL_RESULTS` in `data.js`. The status line under the header always says which one
it is using. To take over manually:

```js
const MANUAL_RESULTS = { 1: 'W', 2: 'L', 3: 'W' };
```

## Running it locally

`crypto.subtle` needs a secure context, so `file://` will not check the passphrase. Serve it:

```bash
python3 -m http.server 8000
```

Then open `http://localhost:8000`.

## Testing the scoring

```bash
node test.js
```

Checks pick counts, predicted records, split-game detection, ranking with ties, ties in
games scoring nobody, and exact-record reachability.

## Notes

- The flyover plays once per browser session. "Replay flyover" in the header runs it again.
- `prefers-reduced-motion` skips the flyover and the ambient camera drift.
- If WebGL is unavailable the page drops the canvas and renders the board on a plain gradient.
