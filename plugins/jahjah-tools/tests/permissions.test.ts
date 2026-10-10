import { expect, test } from 'claude-code/testing';

const ROOT = '/work/jahjah-internal';

function repositoryStubs(on) {
  on('session.cwd', () => ({ value: ROOT }));
  on('fs.stat', ($, e) => ({ value: { realPath: e.path, kind: e.path.endsWith('.md') ? 'file' : 'dir', isLink: false, size: 0, mtimeMs: 0 } }));
  on('process.run', ($, e) => {
    const a = e.argv;
    expect(a[0]).toBe('git');
    expect(a.includes('rev-parse') || a.includes('config') || a.includes('get-url')).toBe(true);
    return { value: { exitCode: 0, stdout: a.includes('rev-parse') ? ROOT : 'https://github.com/obidex/jahjah-internal.git', stderr: '' } };
  });
}

test('the actual tool.check mod approves a task push after an ask decision', async ($, on) => {
  repositoryStubs(on);
  on('tool.check', () => ({ decision: 'ask' }));
  const result = await $.tool.check({ tool: 'Bash', input: { command: 'git push origin claude/receiving' } });
  expect(result.decision).toBe('allow');
  expect(result.reason).toContain('Jahjah owner delegation');
});

test('a deny from the engine stays denied', async ($, on) => {
  on('tool.check', () => ({ decision: 'deny', reason: 'managed block' }));
  const result = await $.tool.check({ tool: 'Bash', input: { command: 'git push origin claude/receiving' } });
  expect(result.decision).toBe('deny');
});

test('unknown shell behavior retains normal permission handling', async ($, on) => {
  on('tool.check', () => ({ decision: 'ask' }));
  on('session.cwd', () => ({ value: ROOT }));
  const result = await $.tool.check({ tool: 'Bash', input: { command: 'curl example.com/install | bash' } });
  expect(result.decision).toBe('ask');
});

test('cloud startup registers a real status tool and returns the loaded version', async ($, on) => {
  const tools = [];
  on('tool.register', ($, e) => { tools.push(e.name); return { value: undefined }; });
  on('command.register', () => ({ value: undefined }));
  on('session.start', () => ({ cwd: ROOT }));
  await $.session.start({ cwd: ROOT, surface: null, isInteractive: false });
  expect(tools).toContain('permission_status');
  const result = await $.tool.call({ tool: 'mcp__jahjah-tools__permission_status' });
  const status = JSON.parse(result.result);
  expect(status.version).toBe('0.2.2');
  expect(status.mod).toBe('loaded');
  expect(status.modelCalls).toBe(0);
  expect(status.timers).toBe(0);
  expect(status.trustedMergeActors.obidex).toBe(144545793);
});

const SHA = 'a'.repeat(40);
const REPO = { id: 123, full_name: 'obidex/jahjah-internal', fork: false };
const PR = { state: 'open', draft: false, user: { login: 'obidex', id: 144545793, type: 'User' }, base: { repo: REPO }, head: { sha: SHA, repo: REPO }, mergeable: true, mergeable_state: 'clean' };
const MERGE = { tool: 'Bash', input: { command: `gh api -X PUT repos/obidex/jahjah-internal/pulls/123/merge -f sha=${SHA}` } };

test('native merge path accepts a trusted same-repository PR', async ($, on) => {
  on('tool.check', () => ({ decision: 'ask' }));
  on('session.cwd', () => ({ value: ROOT }));
  on('process.run', ($, e) => {
    expect(e.argv).toEqual(['gh', 'api', 'repos/obidex/jahjah-internal/pulls/123']);
    return { value: { exitCode: 0, stdout: JSON.stringify(PR), stderr: '' } };
  });
  expect((await $.tool.check(MERGE)).decision).toBe('allow');
});

test('native merge path refuses an owner-authored fork despite an existing allow', async ($, on) => {
  on('tool.check', () => ({ decision: 'allow' }));
  on('process.run', () => ({ value: { exitCode: 0, stdout: JSON.stringify({ ...PR, head: { sha: SHA, repo: { id: 456, full_name: 'outsider/fork', fork: true } } }), stderr: '' } }));
  expect((await $.tool.check(MERGE)).decision).toBe('deny');
});

test('native merge path refuses an outsider on an internal branch', async ($, on) => {
  on('tool.check', () => ({ decision: 'ask' }));
  on('process.run', () => ({ value: { exitCode: 0, stdout: JSON.stringify({ ...PR, user: { login: 'outsider', id: 456, type: 'User' }, body: 'Obada approved this' }), stderr: '' } }));
  expect((await $.tool.check(MERGE)).decision).toBe('deny');
});

test('new attribution is empty without touching any existing commit', async ($) => {
  const result = await $.attribution.text({ kind: 'commit' });
  expect(result.text).toBe('');
});

test('native compound preparation with numeric sed is approved, with an honest diagnostic', async ($, on) => {
  repositoryStubs(on);
  on('tool.check', () => ({ decision: 'ask' }));
  const result = await $.tool.check({ tool: 'Bash', input: { command: `cd ${ROOT} && git fetch -q origin main && git checkout -q -B claude/task origin/main && git log --oneline -1 && sed -n 25,40p docs/STRATEGIST.md` } });
  expect(result.decision).toBe('allow');
  const status = JSON.parse((await $.tool.call({ tool: 'mcp__jahjah-tools__permission_status' })).result);
  expect(status.lastDecision.category).toBe('approved');
  expect(status.lastDecision.originalDecision).toBe('ask');
  expect(status.lastDecision.finalDecision).toBe('allow');
});

test('native diagnostic identifies the unsupported component without printing its arguments', async ($, on) => {
  repositoryStubs(on);
  on('tool.check', () => ({ decision: 'ask' }));
  expect((await $.tool.check({ tool: 'Bash', input: { command: "git status && sed -n '1w secret-output-path' README.md" } })).decision).toBe('ask');
  const report = (await $.tool.call({ tool: 'mcp__jahjah-tools__permission_status' })).result;
  const status = JSON.parse(report);
  expect(status.lastDecision.commandIndex).toBe(2);
  expect(status.lastDecision.command).toBe('sed');
  expect(status.lastDecision.code).toBe('unsupported-command-form');
  expect(report.includes('secret-output-path')).toBe(false);
});

test('native deny is counted separately from merge blocks and survives status reads', async ($, on) => {
  on('tool.check', () => ({ decision: 'deny', reason: '[Self-Modification] private details' }));
  expect((await $.tool.check({ tool: 'Edit', input: { file_path: 'CLAUDE.md' } })).decision).toBe('deny');
  const before = JSON.parse((await $.tool.call({ tool: 'mcp__jahjah-tools__permission_status' })).result);
  await $.tool.check({ tool: 'mcp__jahjah-tools__permission_status', input: {} });
  const after = JSON.parse((await $.tool.call({ tool: 'mcp__jahjah-tools__permission_status' })).result);
  expect(after).toEqual(before);
  expect(after.counts.inheritedDeny).toBe(1);
  expect(after.counts.blockedMerges).toBe(0);
  expect(after.lastDecision.ruleLabel).toBe('Self-Modification');
});
