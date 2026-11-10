# CLAUDE.md — jahjah-plugins

The owner's Claude Code plugin marketplace: one plugin, `jahjah-tools` (`README.md`). Public:
generic tools and sanitized text only; no project's hosts, people or secrets.
Before working here, read obidex/harness-kit `.harness/core.md` and `.harness/owner-defaults.md`:
this repository has no copy of them, and they bind every thread.
- The permission mod (`plugins/jahjah-tools/hooks/`) is never broadened or changed by the agents it
  governs; a change to it is the owner's own card. A plugin change is a new version in `plugin.json`.
- Checks: `npm test` (`node --test tests/*.test.mjs`). Decisions: the kit's `DECISIONS.md` (K…).
- Cloud threads load no settings: set `git config user.name` and `user.email` before the first commit.
