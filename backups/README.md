# Backups

Full copies of the site at known-good points. To restore one, unzip it over the repo (keep `backend-config.json` from the live repo) and commit.

| File | What it is | Git commit |
|---|---|---|
| `youtube-blue-before-comic-restore-2026-10-08.zip` | Oct 8 afternoon, with Comic to Video auto-sync and panel reading (since removed: Comic to Video went back to manual panel times) | `44812dd` |
| `youtube-blue-before-camera-styles-2026-10-07.zip` | Before camera styles, templates, faster export and mic recording | `98014e4` |
| `youtube-blue-before-subtitles-2026-10-07.zip` | Working Comic to Video page, before subtitles and translation | `6fe1c6b` |
| `youtube-blue-before-grammar-2026-10-06.zip` | Before the story grammar tidy-up | `1d82a91` |

With git: `git checkout 6fe1c6b -- . ':!backend-config.json'` then commit.
