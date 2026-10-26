---
name: pnpm workspace manifest edits
description: Preserve intentional workspace YAML when adding dependencies through pnpm.
---

When installing a package with pnpm 10.26.1, `pnpm add` rewrote `pnpm-workspace.yaml` formatting, reordered overrides, and removed explanatory comments. Restore the prior workspace manifest and keep only intentional dependency and lockfile changes.

**Why:** The workspace manifest contains deliberate supply-chain guidance and platform-specific package overrides; accepting the installer's broad rewrite creates unrelated changes.

**How to apply:** After a package install, compare `pnpm-workspace.yaml` to its prior version before accepting it. Avoid another package command if it would repeat the normalization.
