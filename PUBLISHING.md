# Publishing mimo2codex to npm

Maintainer's runbook. If you're a user, you don't need this — just `npm install -g mimo2codex`.

---

## One-time setup

### 1. Confirm the package name is free

```bash
npm view mimo2codex
```

- If output ends with `404 Not Found` → the name is available
- If you see real package metadata → someone else owns it; rename the package in `package.json` (e.g. to a scoped name like `@7as0nch/mimo2codex`) before publishing

### 2. Log into npm

```bash
npm login                # opens browser for the new device-flow login
npm whoami               # should print your username (e.g. 7as0nch)
```

> **Strongly recommended**: enable 2FA at <https://www.npmjs.com/settings/~/profile> → Security. Pick **"Authorization and writes"** so it's required for `npm publish` too. Without 2FA, anyone who steals your npm token can push malware as you.

### 3. (Optional) Generate an npm automation token for CI

If you'll publish from GitHub Actions later: <https://www.npmjs.com/settings/~/tokens> → "Generate New Token" → **Automation** type. Add it as the `NPM_TOKEN` secret on the repo.

---

## Pre-flight check before every publish

Run from the repo root:

```bash
# 1. Make sure working tree is clean and on main
git status                 # should be clean
git pull --ff-only

# 2. Build + test (prepublishOnly will also do this, but fail fast here)
npm install
npm run build
npm test

# 3. See exactly what npm will ship — no surprises
npm pack --dry-run
```

The dry-run output should list **only**:

```
mimo2codex/dist/...                # compiled JS + sourcemaps
mimo2codex/codex_pet_generate/...  # SKILL.md, scripts, references, assets
mimo2codex/AGENTS.md
mimo2codex/README.md
mimo2codex/README.zh.md
mimo2codex/LICENSE
mimo2codex/package.json
```

It should **NOT** include:

- ❌ `src/` (TypeScript source — only ship compiled output)
- ❌ `test/` (developer artifacts)
- ❌ `node_modules/`
- ❌ `.git*`, `tsconfig.json`, `vitest.config.ts` (npm hides these by default)
- ❌ `scripts/install.sh` / `install.ps1` (those are for git-clone bootstrapping; the npm consumer doesn't need them)

If you see something unexpected, fix the `files` array in `package.json`.

### 4. Smoke-test the tarball locally

Don't trust dry-run; install and run the actual tarball:

```bash
# Pack into a tarball
npm pack
# → produces mimo2codex-X.Y.Z.tgz

# Install it globally from the tarball (in a separate shell or scratch dir)
npm install -g ./mimo2codex-0.1.0.tgz

# Verify the binary works
mimo2codex --version
mimo2codex --help
mimo2codex print-config

# Clean up the global install before real publishing
npm rm -g mimo2codex
```

If anything goes sideways here it's MUCH less embarrassing than fixing it post-publish.

---

## First publish (0.1.0)

```bash
# Already at version 0.1.0 in package.json. If you want to bump first, do:
#   npm version patch       # 0.1.0 → 0.1.1
#   npm version minor       # 0.1.0 → 0.2.0
#   npm version major       # 0.1.0 → 1.0.0
# (these auto-commit + git tag)

npm publish
```

For an unscoped public package, that's it. If you renamed to a scoped package (`@7as0nch/mimo2codex`), you must add `--access public`:

```bash
npm publish --access public
```

If 2FA is on, npm will prompt for the OTP code.

After it lands:

- `npm view mimo2codex` should show your package
- `https://www.npmjs.com/package/mimo2codex` is live
- A fresh shell can run `npm install -g mimo2codex && mimo2codex --version`

---

## Subsequent releases

The `release:*` npm scripts in `package.json` chain version bump + publish + git push:

```bash
# Bug fix release
npm run release:patch       # 0.1.0 → 0.1.1, publish, push tag

# New feature, backwards-compatible
npm run release:minor       # 0.1.1 → 0.2.0

# Breaking change
npm run release:major       # 0.2.0 → 1.0.0
```

Each script does:
1. `npm version <patch|minor|major>` — bumps the version and creates a git tag
2. `npm publish` — `prepublishOnly` runs `npm run build && npm test` first (this will abort the publish if tests fail, which is what you want)
3. `git push --follow-tags` — sends the commit + tag to GitHub

> ⚠️ **Don't manually edit `version` in package.json.** Always use `npm version` so the git tag matches.

---

## Releasing a fix to an already-published version

You can't republish the same version — npm rejects it. Always bump:

```bash
# Pull, fix, commit
git pull
# ... edit code ...
git add -A && git commit -m "fix: stream-end edge case"

# Then bump-and-publish in one go
npm run release:patch
```

If you accidentally publish a broken version:

- **Within 72 hours**: `npm unpublish mimo2codex@X.Y.Z` (npm allows this for new packages)
- **After 72 hours**: `npm deprecate mimo2codex@X.Y.Z "reason"` — the version stays installable but new users see a warning. Then publish a fix as a higher version.

Avoid republishing the same version — npm intentionally won't let you (it would break anyone who already has X.Y.Z installed by changing what they get on `npm install`).

---

## Tagging beta / next releases

For pre-release versions:

```bash
# Tag a 0.2.0-beta.1 release without making it the default install
npm version 0.2.0-beta.1
npm publish --tag beta

# Users who want the beta:
npm install -g mimo2codex@beta

# Promote later by retagging:
npm dist-tag add mimo2codex@0.2.0-beta.1 latest
```

---

## Troubleshooting

**`npm publish` says "402 Payment Required"**
You're trying to publish a scoped package without `--access public`. Either:
- Add `"publishConfig": { "access": "public" }` to package.json, or
- Run `npm publish --access public`

**`npm publish` says "403 Forbidden — you do not have permission"**
- `npm whoami` to confirm you're logged in as the right user
- `npm view mimo2codex` to see who currently owns the name (might be different)
- If it's your old account, `npm logout && npm login` to switch

**`npm publish` says "EOTP — One-time password required"**
You have 2FA enabled. Pass `--otp=XXXXXX` or it'll prompt interactively.

**The published package is missing files**
- `npm pack --dry-run` to see what was included
- Update the `files` array in `package.json`
- Bump version and republish (you can't change a published version)

**The published package has way too many files**
Same fix path. By default npm includes everything not in `.gitignore` / `.npmignore` if `files` isn't set. Always set `files`.

**`bin` script doesn't run on macOS / Linux after install**
- Verify `dist/cli.js` has the shebang `#!/usr/bin/env node` as line 1 (`src/cli.ts` already does, tsc preserves it)
- Verify the `bin` field in package.json: `"mimo2codex": "dist/cli.js"`
- npm sets the +x bit automatically on install — if it didn't, the package was built incorrectly

**`bin` script doesn't run on Windows after install**
- npm creates a `mimo2codex.cmd` shim automatically; works in both PowerShell and CMD
- If `mimo2codex` isn't found: confirm `%APPDATA%\npm\` is in your PATH (it is by default after Node.js install)

---

## What gets shipped (current `files` list)

| Path | Why it's included |
|---|---|
| `dist/` | Compiled JS the binary actually runs |
| `codex_pet_generate/` | Pet generation scripts (e.g. `python3 $(npm root -g)/mimo2codex/codex_pet_generate/scripts/generate_pet.py`) |
| `AGENTS.md` | Codex-agent instructions; useful if user copies into their own repo |
| `README.md` | Shown on npmjs.com |
| `README.zh.md` | Chinese docs |
| `LICENSE` | Required for permissive use |
| `package.json` | Always shipped automatically |

If you decide `codex_pet_generate/` shouldn't ship via npm (e.g. it grows large), remove it from `files`. Users who installed via git clone will still have it.

---

## Useful commands cheat sheet

```bash
npm view mimo2codex                  # see published metadata
npm view mimo2codex versions         # list all published versions
npm view mimo2codex@latest           # latest tagged version
npm view mimo2codex dist-tags        # show all dist-tags

npm unpublish mimo2codex@X.Y.Z       # within 72 hours of publish
npm deprecate mimo2codex@X.Y.Z "msg" # mark deprecated forever

npm pack                             # produce tarball without publishing
npm pack --dry-run                   # list what would ship

npm version patch                    # 0.1.0 → 0.1.1 + git tag
npm version minor                    # 0.1.0 → 0.2.0 + git tag
npm version major                    # 0.1.0 → 1.0.0 + git tag

npm dist-tag ls mimo2codex           # list dist-tags
npm dist-tag add mimo2codex@X.Y.Z latest    # promote a beta to latest
```
