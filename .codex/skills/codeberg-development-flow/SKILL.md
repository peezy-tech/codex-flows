---
name: codeberg-development-flow
description: Use when working in this repository on development flow, remotes, Codeberg or Forgejo CLI operations, Codeberg repo creation, branch tracking, commit signing, mirroring to GitHub, npm trusted publishing, release validation, or publishing @peezy.tech/codex-flows.
---

# Codeberg Development Flow

## Overview

Use Codeberg as the primary development forge. Keep GitHub as a mirror only for npm trusted publishing.

## Core Rules

- Treat `origin` as Codeberg: `git@codeberg.org:peezy-tech/codex-flows.git`.
- Treat `github` as the GitHub mirror: `https://github.com/peezy-tech/codex-flows.git`.
- Keep `main` tracking `origin/main`, not `github/main`.
- Push normal development to Codeberg.
- Push to GitHub only when the release workflow must publish to npm.
- Do not add npm tokens to the repo or GitHub secrets. GitHub publishes through trusted publishing.
- Use package name `@peezy.tech/codex-flows`, not `@peezy-tech/codex-flows`.

## Setup Checks

When asked to set up or verify the repo, check:

```bash
git remote -v
ssh -T git@codeberg.org
fj --host codeberg.org auth list
gpg --list-secret-keys --keyid-format=long
git status --short --branch
```

Expected local key files:

```text
~/.ssh/id_ed25519_codeberg.pub
~/.config/codeberg-keys/matamune-codeberg-gpg.asc
```

## Release Workflow

Normal development:

```bash
git pull
git push
```

Before release, run:

```bash
bun run --filter @peezy.tech/codex-flows release:check
bun run check:types
bun run test
git diff --check
```

Then:

1. Bump `packages/codex-client/package.json`.
2. Commit.
3. Push to Codeberg: `git push`.
4. Push to GitHub mirror: `git push github main`.
5. Run GitHub workflow `.github/workflows/publish-codex-flows.yml` with `confirm_package=@peezy.tech/codex-flows`.
6. Verify `npm dist-tag ls @peezy.tech/codex-flows`.

## References

- Read `references/development-flow.md` for exact setup and command details.
