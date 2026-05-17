---
title: Thread transplant
description: Move Codex thread rollout files between CODEX_HOME roots.
---

# Thread transplant

Thread transplant copies a raw Codex rollout JSONL file from one `CODEX_HOME`
to another. It is intentionally file-based in v1: it preserves the original
thread id, filename, relative `sessions/...` path, bytes, and checksum so the
target Codex home can resume the same thread id from disk.

```bash
codex-flows threads locate <thread-id> --codex-home ~/.codex
codex-flows threads export <thread-id> --codex-home ~/.codex --output ./thread-bundle
codex-flows threads inspect ./thread-bundle
codex-flows threads import ./thread-bundle --codex-home ./workspace/.codex
```

## Bundle Format

A thread bundle is a directory, not an archive:

```text
manifest.json
sessions/<YYYY>/<MM>/<DD>/<rollout-file>.jsonl
```

`manifest.json` records:

- schema version and bundle kind
- thread id
- creation timestamp
- original rollout relative path
- source cwd when the rollout metadata exposes it
- rollout byte length and sha256 checksum

The rollout JSONL is copied byte-for-byte. The command does not reconstruct
history from `thread/read`, rewrite ids, or modify rollout records.

## Export

```bash
codex-flows threads export <thread-id> --codex-home <source> --output <bundle-dir>
```

Export scans `CODEX_HOME/sessions/**/rollout-*.jsonl`. It identifies the target
rollout from parsed `session_meta.payload.id` first, then falls back to the
thread id embedded in the filename when session metadata is not available.

The output directory must be missing or empty. Export writes the copied rollout
under its original `sessions/...` relative path and writes `manifest.json` with
the checksum and byte count.

## Inspect

```bash
codex-flows threads inspect <bundle-dir>
```

Inspect validates the manifest, rejects unsafe relative paths, verifies the
rollout byte length, and verifies the sha256 checksum before printing bundle
details. Use `--json` for machine-readable output.

## Import

```bash
codex-flows threads import <bundle-dir> --codex-home <target>
```

Import validates the bundle before writing and copies the rollout to the same
relative path under the target `CODEX_HOME`. If the target rollout already
exists, import fails by default.

To replace an existing rollout, opt in explicitly:

```bash
codex-flows threads import <bundle-dir> --codex-home <target> --replace
```

`--replace` writes a timestamped backup beside the existing rollout before
copying the imported file.

## Scope

Thread transplant is for local or backend environments that can resume threads
from Codex rollout files. It is not app-server-native import, not a general
Codex home sync, and not a fork/id-rewrite tool. Cross-home resume or fork is
done by exporting from one `CODEX_HOME`, importing into another, then using the
existing Codex/app-server thread resume or fork behavior with the preserved
thread id.
