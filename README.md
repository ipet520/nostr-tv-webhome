# Nostr TV WebHome

TV-oriented Nostr/TMDB WebHome adapted for Android TV / TCL WebView.

## Current release

V1.4.0

## Stable entry

`index.html` is always the current official release.

## Development / Build

- Edit CSS under `src/css/` and application JavaScript under `src/js/` fragments; do not use the generated root `index.html` as the primary source.
- Run `node scripts/build.mjs` to generate the self-contained root `index.html`.
- Run `node scripts/verify-build.mjs` to verify the current root artifact against the source manifest.
- `tests/tv-diagnostics.js` is diagnostic-only and is loaded only in diagnostic mode.
- Runtime remains a single HTML file and does not load `src/` files.

## Version archive

`versions/` contains permanent snapshots of published releases.

## Future release process

For each new version, copy the unchanged release HTML to both `index.html` and a new `versions/vX.Y.Z.html`, verify that both files have the same SHA-256, then commit and push to `main`.
