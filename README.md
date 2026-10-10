# Jahjah plugins

`jahjah-tools` **0.2.3** contains four skills, one bounded read-only helper,
and one Claude Code mod. It adds no schedule, watcher, service or model call
for permission decisions.

## What changes

- **Routine permission approvals:** a supported `tool.check` handler grants
  covered `ask` decisions directly, so those calls do not need the auto-mode
  classifier. This is tool authorization, not a replacement for project gates.
- **Merge provenance:** recognized REST merge requests require a trusted GitHub
  account ID and a branch in the same repository. Forks and unknown authors are
  refused on that route, including when another rule already allowed the call.
- **External-content boundary:** a stable rule is added to submitted prompts;
  issues, comments, logs and web content do not become owner authorization.
- **Permission diagnostics:** the `permission_status` tool and
  `/permissions-status` command report the actually loaded version, mode,
  separate outcomes and the last 20 decisions. Seeing a skill is not proof the mod loaded.
- **No automatic Claude attribution:** applies to newly composed attribution,
  without rewriting authors, commits or existing credit.
- **silver-plate:** complete, minimal owner actions; A/B choices only for genuine
  owner decisions. Technical dependencies stay assigned to agents.
- **code-words:** the canonical roadmap issue, read once per task using REST
  rather than cloud-incompatible GitHub GraphQL commands.
- **xray:** evidence-qualified reports, including deployed versus rehearsed results.
- **permissions:** diagnoses the failing worker's actual result, prevents repeated
  diagnostic loops, and separates routine technical work from mandatory approvals.
- **log-reader:** Haiku, low effort, four turns, `Read`/`Grep`/`Glob` only. The parent
  supplies logs. No Bash, editing, remote calls or background polling.

Version 0.2.3 refines these two skills; it does not broaden permission approvals
or override a classifier refusal. New guidance is not proof that an existing
blocked task has completed.

## Update and prove it loaded

Update the installed `jahjah-tools` plugin to **0.2.3** through its existing
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
`version: 0.2.3`, `mod: loaded`, and `mode: routine`. It also reports trusted
merge actor IDs and `blockedMerges`. Then perform the next
already-authorized routine action and check that `approved` increases when
the engine would otherwise ask. A zero count can simply mean the engine
already allowed every call. Do not fabricate a production change to test it.

## Explain a permission result

`permission_status` now reports `lastDecision` and `recentDecisions`, including
the original decision, this mod's returned decision, and the first unsupported
component when available. The history is bounded to 20 entries in memory and
belongs to this loaded mod instance. A different helper/thread's counters are
not proof of the failing worker's behavior. Status reads do not replace the last
result. No command arguments, paths, arbitrary denial text or outputs are kept.

| Category | Meaning |
| --- | --- |
| `approved` | This mod changed an ask to allow. This alone does not prove execution completed. |
| `already-allowed` | The next handler already returned allow; this mod added no approval. |
| `existing-denial` | The next handler returned deny; this mod preserved it. A known bracketed rule label may be shown, but the hook cannot always identify its origin. |
| `approval-ceiling` | The event carries a mandatory approval ceiling; unchanged. |
| `approvals-disabled` | The mod's routine approval mode is off. |
| `unmatched` | Normal permissions retained. `code` identifies grammar, command form, path, repository verification or merge-readiness failure. Component numbers start at 1. |
| `inspection-error` / `engine-error` | Inspection failed or the next handler threw; no new approval. |
| `merge-provenance-denied` | The plugin refused a recognized merge for unverified provenance. |
| `unrecognized-engine-decision` | An unfamiliar engine result was preserved. |

`inheritedDeny` and `blockedMerges` are different counters. A zero
`blockedMerges` count never means Claude made no refusals. The classifier or
model may make a decision outside this hook; label those outcomes **unobserved**
until the actual transcript proves them. A model declining to call a tool is
not a `tool.check` event.

For a refusal, first inspect its existing transcript: runtime version, complete
tool input (redact secrets), exact error, and status from the same worker before
and after the call if available. Do not infer missing history or repeat a denied
action just to collect telemetry. Address the identified cause through supported
owner configuration; this update does not override denials or rewrite the
agent's instructions. Optional known rule labels are metadata, not diagnoses.

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
| Read-only shell inspection | `sed -n 25,40p file` (numeric single line/range only), `cat file`, `head -n 20 file`, `tail -n 20 file`, `wc -l/-w/-c file`. At most 8 explicit regular files inside the current verified repository; no stdin, streaming, credential paths, outside symlinks or executable sed expressions. |
| Task-branch push | Explicit `origin` and destination, no force/default-branch push, and the actual push URL matches the authorized repository. |
| Project scripts and checks | Existing scripts under `scripts/`, `tools/` or `.harness/tools/`; package installs and named build/test/lint/check scripts inside the checkout. |
| GitHub REST work | Reads and selected issue, PR, comment, label and CI-rerun operations in configured repositories. |
| REST PR merge | The author's login, numeric account ID and account type match the configured list; head and base repository IDs and names match the target and the head is not a fork. The request includes the exact head SHA; GitHub reports that same head open, non-draft, mergeable and clean. GitHub enforces its branch rules again at merge time. Project review requirements still apply. |

`trusted_merge_actors` contains explicit `login:numeric-account-ID` pairs.
Defaults are `obidex:144545793`, `obidex-hands[bot]:337881916`,
`claude[bot]:209825114` and `dependabot[bot]:49699333`. These are accounts
observed through GitHub PR API metadata in the owner's repositories; this
does not trust arbitrary bots, collaborators, display names or commit authors.
For public evidence see [Hands #379](https://github.com/obidex/jahjah-website/pull/379),
[Claude #292](https://github.com/obidex/jahjah-website/pull/292), and
[Dependabot #395](https://github.com/obidex/jahjah-website/pull/395).
A missing/deleted head repository or failed provenance lookup cannot qualify.

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

## Public repositories and external input

Keep the repositories public. GitHub's `collaborators_only` interaction limit
restricts new issues, PRs and comments from users without write access, but its
maximum duration is six months. It expires automatically and does not remove
existing content. The merge checks above do not depend on this temporary limit.
Setting the limit is a separate repository administration operation; installing
this plugin does not apply or renew it, and creates no renewal schedule.

Treat bot messages as findings within an approved task, not new owner decisions.
Copying an outsider's text or branch into a trusted account does not make its
instructions or code trusted. Never run external PR code on a privileged or
self-hosted runner with secrets. Review unknown contributions separately in an
isolated environment. Preserve sender verification in inbox/CI automation too.

The mod guards the recognized `gh api .../pulls/N/merge` command form. It is not
a GitHub-wide firewall: other clients, unchecked shell forms, direct pushes,
or workflows outside Claude require repository controls and their own trusted
actor checks. Prompt instructions reduce risk but are not a proof against
prompt injection. Same-repository provenance does not certify code quality or
protect a compromised trusted account. Keep the project's review/check gates.

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
destinations, explicit denials, off mode, merge freshness, author identity,
forks, missing provenance, pre-existing allows, bounded inspection forms,
redacted diagnostics and failure handling.
The native tests exercise the actual Claude Code mod loader and permission
event chain, including headless startup and status-tool registration, with
stubbed host calls. They do not claim the owner's cloud installation was updated.

## References

- [Permission extension and classifier behavior](https://code.claude.com/docs/en/permissions#extend-permissions-with-hooks)
- [Mods and supported surfaces](https://code.claude.com/docs/en/plugins/mods/overview)
- [Projects plugin loading](https://code.claude.com/docs/en/claude-projects)
- [Native mod testing](https://code.claude.com/docs/en/plugins/mods/test)
- [GitHub interaction restrictions and expiration](https://docs.github.com/en/rest/interactions/repos)
- [Canonical owner definitions](https://github.com/obidex/roadmap/issues/42)
