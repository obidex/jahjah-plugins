import { VERSION, DEFAULT_REPOSITORIES, DEFAULT_TRUSTED_MERGE_ACTORS, EXTERNAL_CONTENT_BOUNDARY, trustedActorList, trustedMergeSource, repositoryList, repositoryFromRemote, absolutePath, within, protectedPath, shellCommands, simpleOperation } from './policy.js';

const fileTools = new Set(['Read', 'Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'Glob', 'Grep']);
const statusTool = 'mcp__jahjah-tools__permission_status';
const diagnosticCommands = new Set(['cd', 'git', 'gh', 'bash', 'sh', 'node', 'python', 'python3', 'npm', 'pnpm', 'yarn', 'bun', 'sed', 'cat', 'head', 'tail', 'wc']);
const diagnosticRules = new Set(['Self-Modification', 'Auto-Mode Bypass', 'Data Exfiltration', 'Production Deploy', 'Git Destructive', 'Self-Approval']);
const failure = (code, component = {}) => ({ ok: false, code, ...component });
const success = reason => ({ ok: true, reason });

  async function existingPath($, path) {
    let stat;
    try { stat = await $.fs.stat(path, { resolve: true }); }
    catch { return null; }
    if (stat.isLink && !stat.realPath) throw new Error('Unresolved symbolic link');
    return stat.realPath || null;
  }

  async function resolvePath($, path) {
    const real = await existingPath($, path);
    if (real) return real;
    // A new file is allowed only through its nearest real, existing parent.
    let parent = path, suffix = [];
    for (let n = 0; n < 32; n++) {
      const slash = parent.lastIndexOf('/');
      if (slash < 0 || parent === '/') return null;
      suffix.unshift(parent.slice(slash + 1)); parent = parent.slice(0, slash) || '/';
      const found = await existingPath($, parent);
      if (found) return absolutePath(suffix.join('/'), found);
    }
    return null;
  }

  async function repoAt($, directory, repositories) {
    const dir = await existingPath($, directory);
    if (!dir) return null;
    const top = await $.process.run(['git', '-C', dir, 'rev-parse', '--show-toplevel'], { timeoutMs: 3000 });
    if (top.exitCode !== 0) return null;
    const root = await existingPath($, top.stdout.trim());
    if (!root || !within(dir, root)) return null;
    const remote = await $.process.run(['git', '-C', root, 'config', '--get', 'remote.origin.url'], { timeoutMs: 3000 });
    const name = remote.exitCode === 0 ? repositoryFromRemote(remote.stdout) : null;
    return name && repositories.has(name) ? { root, name, dir } : null;
  }

  async function repoForFile($, path, repositories) {
    const resolved = await resolvePath($, path);
    if (!resolved || protectedPath(resolved)) return null;
    let parent = resolved;
    try { if ((await $.fs.stat(resolved)).kind !== 'dir') parent = resolved.slice(0, resolved.lastIndexOf('/')) || '/'; }
    catch { parent = resolved.slice(0, resolved.lastIndexOf('/')) || '/'; }
    // New nested directories may not exist yet.
    for (let n = 0; n < 32; n++) {
      if (await existingPath($, parent)) break;
      parent = parent.slice(0, parent.lastIndexOf('/')) || '/';
    }
    const repo = await repoAt($, parent, repositories);
    return repo && within(resolved, repo.root) ? { ...repo, resolved } : null;
  }

  async function eligible($, e, repositories, mergeSnapshots) {
    const cwd = await $.session.cwd();
    const input = e.input || {};
    if (fileTools.has(e.tool)) {
      const path = absolutePath(input.file_path ?? input.notebook_path ?? input.path ?? cwd, cwd);
      return path && await repoForFile($, path, repositories)
        ? success('file operation in an authorized repository') : failure('file-not-eligible');
    }
    if (e.tool !== 'Bash') return failure('unsupported-tool');
    const commands = shellCommands(input.command);
    if (!commands) return failure('unsupported-shell-grammar');
    if (commands.length > 12) return failure('too-many-components');
    let directory = cwd;
    for (const [index, argv] of commands.entries()) {
      // Never retain shell arguments, paths, output or arbitrary executable names.
      const component = { commandIndex: index + 1, command: diagnosticCommands.has(argv[0]) ? argv[0] : 'other' };
      const op = simpleOperation(argv, repositories);
      if (!op) return failure('unsupported-command-form', component);
      if (op.kind === 'github') continue;
      if (op.kind === 'merge') {
        const pr = mergeSnapshots.get(`${op.repository}/${op.number}`);
        if (!pr) return failure('merge-metadata-unavailable', component);
        // GitHub enforces branch rules again when the real merge request runs.
        // The supplied sha makes a later head change fail instead of merging untested code.
        if (pr.state !== 'open' || pr.draft || pr.head?.sha !== op.sha || pr.mergeable !== true || pr.mergeable_state !== 'clean') return failure('merge-not-ready', component);
        continue;
      }
      if (op.kind === 'cd') {
        const candidate = absolutePath(op.directory, directory);
        if (!candidate || !await repoAt($, candidate, repositories)) return failure('repository-not-verified', component);
        directory = candidate; continue;
      }
      const candidate = op.directory ? absolutePath(op.directory, directory) : directory;
      const repo = candidate ? await repoAt($, candidate, repositories) : null;
      if (!repo) return failure('repository-not-verified', component);
      if (op.kind === 'inspect') {
        for (const path of op.paths) {
          const target = absolutePath(path, repo.dir);
          if (!target || protectedPath(target)) return failure('inspection-file-not-eligible', component);
          const real = await existingPath($, target);
          if (!real || !within(real, repo.root) || protectedPath(real) ||
              (await $.fs.stat(real)).kind !== 'file') return failure('inspection-file-not-eligible', component);
        }
      }
      if (op.kind === 'script') {
        const scriptPath = absolutePath(op.path, repo.dir);
        const real = scriptPath && await existingPath($, scriptPath);
        if (!real || !within(real, repo.root) || protectedPath(real)) return failure('script-not-eligible', component);
      }
      if (op.kind === 'git' && op.verb === 'push') {
        // get-url honors pushurl/insteadOf; never approve a redirected push.
        const push = await $.process.run(['git', '-C', repo.dir, 'remote', 'get-url', '--push', '--all', 'origin'], { timeoutMs: 3000 });
        const urls = push.stdout.trim().split(/\r?\n/);
        if (push.exitCode !== 0 || urls.length !== 1 || repositoryFromRemote(urls[0]) !== repo.name) return failure('push-destination-not-verified', component);
      }
    }
    return success('recognized routine command in authorized repositories');
  }

export function register(on, options = {}) {
  const mode = options.approval_mode ?? 'routine';
  const repositories = repositoryList(options.repositories ?? DEFAULT_REPOSITORIES);
  const trustedActors = trustedActorList(options.trusted_merge_actors ?? DEFAULT_TRUSTED_MERGE_ACTORS);
  const counts = { approved: 0, inherited: 0, unmatched: 0, errors: 0, blockedMerges: 0,
    inheritedAllow: 0, inheritedDeny: 0, approvalCeilings: 0, disabled: 0 };
  let sequence = 0;
  const recentDecisions = [];
  let lastReason = 'No permission call inspected yet.';
  const record = (e, original, result, category, detail = {}) => {
    const label = /\[([^\]]+)\]/.exec(typeof original?.reason === 'string' ? original.reason : '')?.[1];
    const decision = value => ['allow', 'ask', 'deny'].includes(value) ? value : 'unknown';
    const tool = fileTools.has(e.tool) || ['Bash', 'Agent', 'Task'].includes(e.tool) ? e.tool : 'other';
    const entry = { sequence: ++sequence, tool, category,
      originalDecision: decision(original?.decision), finalDecision: decision(result?.decision),
      ...detail, ruleLabel: diagnosticRules.has(label) ? label : null };
    recentDecisions.push(entry);
    if (recentDecisions.length > 20) recentDecisions.shift();
    lastReason = `${tool}: ${category}${detail.code ? ` (${detail.code})` : ''}${detail.commandIndex ? ` at component ${detail.commandIndex} (${detail.command})` : ''}.`;
    return result;
  };
  const report = () => ({
    plugin: 'jahjah-tools', version: VERSION, mod: 'loaded', mode,
    repositories: [...repositories], trustedMergeActors: Object.fromEntries(trustedActors), counts: { ...counts }, lastReason,
    lastDecision: recentDecisions.length ? { ...recentDecisions.at(-1) } : null,
    recentDecisions: recentDecisions.map(entry => ({ ...entry })),
    diagnosticScope: 'This loaded mod instance only; last 20 decisions, no persistence. Downstream classifier/model outcomes may be outside this hook. blockedMerges is not the count of all Claude refusals.',
    modelCalls: 0, timers: 0,
    limits: 'Existing deny decisions, connector approval ceilings, GitHub gates and cloud access restrictions remain. Unmatched operations keep normal permissions.',
  });

  on('session.start', async ($, e, next) => {
    await $.tool.register({ name: 'permission_status', description: 'Report the actually loaded Jahjah permission mod version, mode, counters and remaining limits. Read-only; no model call.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } });
    await $.command.register({ name: 'permissions-status', description: 'Show the loaded Jahjah permission policy and decisions' });
    return next(e);
  });
  on('command.run', { command: 'permissions-status' }, async () => ({ text: JSON.stringify(report(), null, 2) }));
  on('tool.call', { tool: 'mcp__jahjah-tools__permission_status' }, async () => ({ result: JSON.stringify(report(), null, 2) }));

  // Reach normal threads as well as users who explicitly load a diagnostic skill.
  // Preserve the owner's text and prior context; no model call or background work.
  on('prompt.submit', async ($, e, next) => next({ ...e, context: [...(e.context ?? []), EXTERNAL_CONTENT_BOUNDARY] }));

  on('tool.check', async ($, e, next) => {
    // Reading status must not erase the result being diagnosed.
    if (e.tool === statusTool) return next(e);
    let original;
    try { original = await next(e); }
    catch (error) {
      counts.errors++;
      record(e, null, null, 'engine-error');
      throw error;
    }
    // This is affirmative owner delegation, not a way to remove explicit controls.
    if (original.decision === 'deny') {
      counts.inherited++; counts.inheritedDeny++;
      return record(e, original, original, 'existing-denial');
    }
    if (e.ceiling === 'ask') {
      counts.inherited++; counts.approvalCeilings++;
      return record(e, original, original, 'approval-ceiling');
    }
    if (mode !== 'routine') {
      counts.inherited++; counts.disabled++;
      return record(e, original, original, 'approvals-disabled');
    }
    const mergeSnapshots = new Map();
    const mergeOperations = e.tool === 'Bash' ? (shellCommands(e.input?.command) ?? [])
      .map(argv => simpleOperation(argv, repositories)).filter(op => op?.kind === 'merge') : [];
    // Inspect recognized merge requests even when another rule already allowed
    // them. A broad Bash allow must not undo this provenance restriction.
    for (const op of mergeOperations) {
      try {
        const result = await $.process.run(['gh', 'api', `repos/${op.repository}/pulls/${op.number}`], { timeoutMs: 8000 });
        const pr = result.exitCode === 0 ? JSON.parse(result.stdout) : null;
        if (trustedMergeSource(pr, op.repository, trustedActors)) {
          mergeSnapshots.set(`${op.repository}/${op.number}`, pr); continue;
        }
        lastReason = 'Merge refused: PR must have a trusted GitHub author ID and a branch in the same repository. External content is not owner authorization.';
      } catch {
        counts.errors++; lastReason = 'Merge refused: GitHub provenance could not be verified. Retry after the lookup works; do not route around this check.';
      }
      counts.blockedMerges++;
      return record(e, original, { decision: 'deny', reason: lastReason }, 'merge-provenance-denied');
    }
    if (original.decision !== 'ask') {
      counts.inherited++;
      if (original.decision === 'allow') counts.inheritedAllow++;
      return record(e, original, original, original.decision === 'allow' ? 'already-allowed' : 'unrecognized-engine-decision');
    }
    try {
      const result = await eligible($, e, repositories, mergeSnapshots);
      if (!result.ok) {
        counts.unmatched++;
        const { ok, ...detail } = result;
        return record(e, original, original, 'unmatched', detail);
      }
      counts.approved++;
      return record(e, original, { decision: 'allow', reason: `Jahjah owner delegation v${VERSION}: ${result.reason}.` }, 'approved');
    } catch {
      counts.errors++;
      return record(e, original, original, 'inspection-error');
    }
  });

  // Suppress new automatic attribution only. Never rewrite commit history/authors.
  on('attribution.text', async () => ({ text: '' }));
}
