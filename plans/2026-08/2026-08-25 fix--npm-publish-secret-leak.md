# Fix: npm publish shipped .env to the registry

## Summary

`.npmignore` was a denylist that never listed `.env`, and npm ignores `.gitignore` entirely once `.npmignore` exists. `.env` is gitignored, so git was always clean — but `npm publish` picked it up. **`typed-bridge@4.1.0` on the public registry contains `.env` with a live `OPENAI_API_KEY`.** Found while previewing the 4.2.0 publish.

`4.0.0` and `4.0.4` are clean; the file first appears in `4.1.0`, the release that added `tool_script` and the LLM demo.

Replaced the denylist with a `files` allowlist in `package.json`. A denylist ships whatever nobody remembered to exclude; an allowlist ships only what is named. The tarball goes from 44 files (including `.env`, `.tmp/`, `plans/`) to 25 — `dist` minus the demo, plus `readme.md`, `license.txt`, `package.json`.

## Changes

- Added `files: ["dist", "!dist/demo", "readme.md", "license.txt"]` to `package.json`
- Deleted `.npmignore`

## Follow-ups (owner: Neil)

- **Rotate the leaked `OPENAI_API_KEY`.** It has been publicly downloadable since 4.1.0 shipped; assume it is compromised
- Decide whether to `npm unpublish typed-bridge@4.1.0` — rotation is the real fix, unpublishing only reduces further exposure
- 27 Dependabot advisories reported on push (11 high) — unrelated to this, but open

## Files

| Project | Files | Change |
| --- | --- | --- |
| typed-bridge | `package.json` | `files` allowlist added |
| typed-bridge | `.npmignore` | deleted |
