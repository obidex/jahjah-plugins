import { VERSION, DEFAULT_REPOSITORIES, DEFAULT_TRUSTED_MERGE_ACTORS, EXTERNAL_CONTENT_BOUNDARY, trustedActorList, trustedMergeSource, repositoryList, repositoryFromRemote, absolutePath, within, protectedPath, shellCommands, simpleOperation } from './policy.js';

const fileTools = new Set(['Read', 'Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'Glob', 'Grep']);

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
      return path && await repoForFile($, path, repositories) ? 'file operation in an authorized repository' : null;
    }
    if (e.tool !== 'Bash') return null;
    const commands = shellCommands(input.command);
    if (!commands || commands.length > 12) return null;
    let directory = cwd;
    for (const argv of commands) {
      const op = simpleOperation(argv, repositories);
      if (!op) return null;
      if (op.kind === 'github') continue;
      if (op.kind === 'merge') {
        const pr = mergeSnapshots.get(`${op.repository}/${op.number}`);
        if (!pr) return null;
        // GitHub enforces branch rules again when the real merge request runs.
        // The supplied sha makes a later head change fail instead of merging untested code.
        if (pr.state !== 'open' || pr.draft || pr.head?.sha !== op.sha || pr.mergeable !== true || pr.mergeable_state !== 'clean') return null;
        continue;
      }
      if (op.kind === 'cd') {
        const candidate = absolutePath(op.directory, directory);
        if (!candidate || !await repoAt($, candidate, repositories)) return null;
        directory = candidate; continue;
      }
      const candidate = op.directory ? absolutePath(op.directory, directory) : directory;
      const repo = candidate ? await repoAt($, candidate, repositories) : null;
      if (!repo) return null;
      if (op.kind === 'script') {
        const scriptPath = absolutePath(op.path, repo.dir);
        const real = scriptPath && await existingPath($, scriptPath);
        if (!real || !within(real, repo.root) || protectedPath(real)) return null;
      }
      if (op.kind === 'git' && op.verb === 'push') {
        // get-url honors pushurl/insteadOf; never approve a redirected push.
        const push = await $.process.run(['git', '-C', repo.dir, 'remote', 'get-url', '--push', '--all', 'origin'], { timeoutMs: 3000 });
        const urls = push.stdout.trim().split(/\r?\n/);
        if (push.exitCode !== 0 || urls.length !== 1 || repositoryFromRemote(urls[0]) !== repo.name) return null;
      }
    }
    return 'recognized routine command in authorized repositories';
  }

export function register(on, options = {}) {
  const mode = options.approval_mode ?? 'routine';
  const repositories = repositoryList(options.repositories ?? DEFAULT_REPOSITORIES);
  const trustedActors = trustedActorList(options.trusted_merge_actors ?? DEFAULT_TRUSTED_MERGE_ACTORS);
  const counts = { approved: 0, inherited: 0, unmatched: 0, errors: 0, blockedMerges: 0 };
  let lastReason = 'No permission call inspected yet.';
  const report = () => ({
    plugin: 'jahjah-tools', version: VERSION, mod: 'loaded', mode,
    repositories: [...repositories], trustedMergeActors: Object.fromEntries(trustedActors), counts: { ...counts }, lastReason,
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
    const original = await next(e);
    // This is affirmative owner delegation, not a way to remove explicit controls.
    if (mode !== 'routine' || e.ceiling === 'ask' || original.decision === 'deny') {
      counts.inherited++; return original;
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
      return { decision: 'deny', reason: lastReason };
    }
    if (original.decision !== 'ask') { counts.inherited++; return original; }
    try {
      const reason = await eligible($, e, repositories, mergeSnapshots);
      if (!reason) { counts.unmatched++; lastReason = `${e.tool}: outside the routine policy; normal permissions apply.`; return original; }
      counts.approved++; lastReason = `${e.tool}: ${reason}.`;
      return { decision: 'allow', reason: `Jahjah owner delegation v${VERSION}: ${reason}.` };
    } catch {
      counts.errors++; lastReason = 'Policy inspection failed; normal permissions retained.';
      return original;
    }
  });

  // Suppress new automatic attribution only. Never rewrite commit history/authors.
  on('attribution.text', async () => ({ text: '' }));
}
