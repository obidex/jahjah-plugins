# Jahjah plugins

`jahjah-tools` **0.2.0** contains four skills, one bounded read-only helper,
and one Claude Code mod. It adds no schedule, watcher, service or model call
for permission decisions.

## What changes

- **Routine permission approvals:** a supported `tool.check` handler grants
  covered `ask` decisions directly, so those calls do not need the auto-mode
  classifier. This is tool authorization, not a replacement for project gates.
- **Permission diagnostics:** the `permission_status` tool and
  `/permissions-status` command report the actually loaded version, mode,
  approval counts and last policy result. Seeing a skill is not proof the mod loaded.
- **No automatic Claude attribution:** applies to newly composed attribution,
  without rewriting authors, commits or existing credit.
- **silver-plate:** complete, minimal owner actions; no unnecessary confirmation.
- **code-words:** the canonical roadmap issue, read once per task using REST
  rather than cloud-incompatible GitHub GraphQL commands.
- **xray:** evidence-qualified reports, including deployed versus rehearsed results.
- **permissions:** distinguishes unnecessary prompts from real access or policy
  failures and checks the loaded mod before claiming success.
- **log-reader:** Haiku, low effort, four turns, `Read`/`Grep`/`Glob` only. The parent
  supplies logs. No Bash, editing, remote calls or background polling.

## Update and prove it loaded

Update the installed `jahjah-tools` plugin to **0.2.0** through its existing
source. In Claude Code Projects, select it in **Project settings → Plugins**
and use a **new cloud thread**. Project settings changes do not update running
threads. A repository's `enabledPlugins` entry is not cloud installation.

For an interactive local CLI installation from this marketplace:

```text
/plugin marketplace update jahjah
/plugin update jahjah-tools@jahjah
/reload-plugins
```

In the fresh cloud thread, ask:

```text
Call the jahjah-tools permission_status tool and show the loaded version,
mode and approval counts. Do not infer that the mod loaded from its skills.
```

The real tool is `mcp__jahjah-tools__permission_status`. It must return
`version: 0.2.0`, `mod: loaded`, and `mode: routine`. Then perform the next
already-authorized routine action and check that `approved` increases when
the engine would otherwise ask. A zero count can simply mean the engine
already allowed every call. Do not fabricate a production change to test it.

Hooks require a compatible Claude Code runtime; development was validated on
**2.1.296**. The account's hosted runtime and installation must still be checked
in that fresh cloud thread. Ordinary Claude chat loads skills, not these hooks.

## Approval scope

The plugin settings expose `approval_mode` (`routine` or `off`) and a
comma-separated `repositories` list. Defaults cover Obada's ERP, website,
infra, roadmap, harness-kit, harness-hands and this plugin repository.
The hook reads these settings at load time; use a reload/new thread after changing them.

| Covered operation | Conditions |
| --- | --- |
| File reads/edits/writes/searches | A real path in a configured GitHub checkout; new files resolve through their real parent. Git internals and credential-file paths are not added to the approval scope. |
| Normal Git work | Recognized commands, including commits and bringing main into a task branch. |
| Task-branch push | Explicit `origin` and destination, no force/default-branch push, and the actual push URL matches the authorized repository. |
| Project scripts and checks | Existing scripts under `scripts/`, `tools/` or `.harness/tools/`; package installs and named build/test/lint/check scripts inside the checkout. |
| GitHub REST work | Reads and selected issue, PR, comment, label and CI-rerun operations in configured repositories. |
| REST PR merge | The request includes the exact head SHA; GitHub reports that same head open, non-draft, mergeable and clean. GitHub enforces its branch rules again at merge time. Project review requirements still apply. |

Multi-repo cloud sessions work with an explicit checkout path (`cd ... && ...`
or `git -C ...`) or an explicit authorized REST repository. Repository identity
is read from Git, never guessed from a folder name. An unknown/proxied origin
that cannot be verified keeps normal permissions; do not relabel it as approved.

This version recognizes POSIX paths and Bash command forms. It does not add
PowerShell or native Windows-path approvals. Those retain existing behavior.

The parser intentionally leaves substitutions, shell variables, pipes,
redirections, inline interpreter programs and unknown command forms to normal
permissions. Existing repository scripts and package lifecycle scripts are
trusted to execute with the session's access; this policy does not inspect
their implementation or act as an operating-system sandbox.

**All existing deny decisions remain denied.** Organization connector ceilings,
managed hooks, branch protections, cloud network/GitHub access controls, and
the model's own refusals are not removed. No owner messages are forged, no
permissions file is edited by the mod, and no command is executed in place of
a refused tool. The mod itself only performs filesystem inspection, read-only
Git metadata commands and a read-only PR lookup for merge verification.

To stop granting these extra approvals while retaining the skills, set
`approval_mode` to `off` and reload/start a new thread. To roll back the whole
plugin, select the previous version through its installation source. Neither
action rewrites existing work or erases evidence.

## Validate

```bash
npm test
claude plugin validate ./plugins/jahjah-tools --strict
cd plugins/jahjah-tools
claude plugin test
```

The Node tests cover shell shapes, repository boundaries, symlinks, push
destinations, explicit denials, off mode, merge freshness and failure handling.
The native tests exercise the actual Claude Code mod loader and permission
event chain, including headless startup and status-tool registration, with
stubbed host calls. They do not claim the owner's cloud installation was updated.

## References

- [Permission extension and classifier behavior](https://code.claude.com/docs/en/permissions#extend-permissions-with-hooks)
- [Mods and supported surfaces](https://code.claude.com/docs/en/plugins/mods/overview)
- [Projects plugin loading](https://code.claude.com/docs/en/claude-projects)
- [Native mod testing](https://code.claude.com/docs/en/plugins/mods/test)
- [Canonical owner definitions](https://github.com/obidex/roadmap/issues/42)
