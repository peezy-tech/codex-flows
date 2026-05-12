# Codeberg Development Flow Reference

## Remotes

```bash
git remote -v
# origin  git@codeberg.org:peezy-tech/codex-flows.git
# github  https://github.com/peezy-tech/codex-flows.git
```

Use Codeberg for day-to-day pushes:

```bash
git push origin main
```

Use GitHub only to run npm trusted publishing:

```bash
git push github main
gh workflow run publish-codex-flows.yml --repo peezy-tech/codex-flows --ref main -f confirm_package='@peezy.tech/codex-flows'
```

## Keys

SSH public key:

```text
~/.ssh/id_ed25519_codeberg.pub
```

GPG public key:

```text
~/.config/codeberg-keys/matamune-codeberg-gpg.asc
```

Git signing is expected:

```bash
git config --global commit.gpgsign true
git config --global user.signingkey E3B0D5FB2E5CF11FAFB2EA113BB8E7D3B968A324
```

## Forgejo CLI

`forgejo-cli` is installed as `fj`.

After a Codeberg application token exists:

```bash
fj auth add-key <codeberg-username> <token>
fj auth use-ssh true
fj auth list
```

## Package Release Gate

```bash
bun run --filter @peezy.tech/codex-flows release:check
bun run check:types
bun run test
git diff --check
```

Verify npm after GitHub Actions publishing:

```bash
npm dist-tag ls @peezy.tech/codex-flows
npm view @peezy.tech/codex-flows version repository --json
```
