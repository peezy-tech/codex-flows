# Development Flow

This monorepo is developed on Codeberg and mirrored to GitHub only for npm trusted publishing.

## Remotes

Use Codeberg as the normal development remote:

```bash
git remote -v
# origin  git@codeberg.org:peezy-tech/codex-flows.git
# github  https://github.com/peezy-tech/codex-flows.git
```

Push ordinary development to Codeberg:

```bash
git push origin main
```

Push to GitHub only when a release needs the trusted publishing workflow:

```bash
git push github main
```

## Machine Keys

This machine uses a dedicated Codeberg SSH key:

```text
~/.ssh/id_ed25519_codeberg.pub
```

The public GPG key for commit verification is exported here:

```text
~/.config/codeberg-keys/matamune-codeberg-gpg.asc
```

Upload both public keys to the Codeberg account before pushing over SSH or expecting verified commits.

## Forgejo CLI

`forgejo-cli` is installed as `fj`.

Authenticate with Codeberg after creating an application token:

```bash
fj auth add-key <codeberg-username> <token>
fj auth use-ssh true
fj auth list
```

If browser login is available, this may also work:

```bash
fj auth login
fj auth use-ssh true
```

## Releases

Release package: `@peezy.tech/codex-flows`

Before publishing:

```bash
bun run --filter @peezy.tech/codex-flows release:check
bun run check:types
bun run test
git diff --check
```

To publish through GitHub trusted publishing:

1. Bump `packages/codex-client/package.json`.
2. Commit and push to Codeberg.
3. Push the same commit to GitHub.
4. Run `.github/workflows/publish-codex-flows.yml` on GitHub with confirmation input `@peezy.tech/codex-flows`.
5. Verify npm:

```bash
npm dist-tag ls @peezy.tech/codex-flows
```
