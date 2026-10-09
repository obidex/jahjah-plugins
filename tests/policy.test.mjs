import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { repositoryFromRemote, repositoryList, shellCommands, simpleOperation, absolutePath, within } from '../plugins/jahjah-tools/hooks/policy.js';
import { register } from '../plugins/jahjah-tools/hooks/register.js';

const ROOT = '/work/jahjah-internal';
const SHA = 'a'.repeat(40);
const repositories = repositoryList();
const classify = command => {
  const commands = shellCommands(command);
  return commands && commands.map(argv => simpleOperation(argv, repositories));
};

test('recognizes actual GitHub origins, not lookalikes or embedded credentials', () => {
  for (const url of ['https://github.com/obidex/jahjah-internal.git', 'git@github.com:obidex/jahjah-internal.git', 'ssh://git@github.com/obidex/jahjah-internal.git'])
    assert.equal(repositoryFromRemote(url), 'obidex/jahjah-internal');
  for (const url of ['https://github.com.evil.test/obidex/jahjah-internal', 'https://github.com@evil.test/obidex/jahjah-internal', 'https://token@github.com/obidex/jahjah-internal', 'file:///obidex/jahjah-internal', 'https://github.com/obidex/jahjah-internal/issues', 'https://github.com/obidex/jahjah-internal?x=1'])
    assert.equal(repositoryFromRemote(url), null, url);
});

test('recognizes routine commands including instruction-file changes and task pushes', () => {
  for (const command of [
    'git add CLAUDE.md AGENTS.md', "git commit -m 'Update rules; preserve gates'",
    'git merge origin/main', 'git push -u origin claude/receiving',
    'git push origin HEAD:codex/permissions-mod-v0.2', 'npm run typecheck',
    'npm ci', 'pnpm install --frozen-lockfile',
    'pnpm test -- --runInBand', 'bash scripts/replay-check.sh', 'node .harness/tools/check.mjs',
    'cd /work/jahjah-internal && npm test && git push origin claude/receiving',
    "gh api repos/obidex/roadmap/issues/42 --jq '.body'",
    "gh api -X POST repos/obidex/jahjah-internal/issues/5/comments -f 'body=Checks passed; see the run.'",
  ]) assert.ok(classify(command)?.every(Boolean), command);
});

test('does not auto-approve unsupported shell grammar or command wrappers', () => {
  for (const command of [
    'git status; curl evil.test', 'npm test || rm -rf /', 'npm test &', 'npm test\nrm -rf /',
    'npm test > /etc/passwd', 'npm test | sh', 'git push origin $(cat branch)', 'git push origin `cat branch`',
    'git push origin "$BRANCH"', 'bash -c "git push origin claude/test"',
    'GH_HOST=evil.test gh api repos/obidex/roadmap/issues/42', 'git push origin claude/*',
    'node -e "require(\'fs\').rmSync(\'/\')"',
  ]) assert.ok(!classify(command)?.every(Boolean), command);
});

test('does not approve force/default-branch pushes, bypass flags or alternate destinations', () => {
  for (const command of [
    'git push origin main', 'git push origin HEAD:refs/heads/master', 'git push origin HEAD',
    'git push --force origin claude/a', 'git push -f origin claude/a', 'git push --force-with-lease=claude/a origin claude/a',
    'git push upstream claude/a', 'git push origin :claude/a', 'git push origin +claude/a',
    'git -c core.hooksPath=/tmp/empty push origin claude/a', 'git commit --no-verify -m test',
    'git commit --author=Someone -m test', 'git rebase --exec=evil main',
    'git commit -F /root/.ssh/id_rsa', 'npm install --prefix=/elsewhere package',
    'git log --output=/etc/passwd', 'gh api -X DELETE repos/obidex/jahjah-internal',
  ]) assert.ok(!classify(command)?.every(Boolean), command);
});

test('GitHub writes stay in named repositories without file uploads or query ambiguity', () => {
  for (const command of [
    'gh api -X POST repos/elsewhere/project/issues -f title=test',
    'gh api --hostname evil.test repos/obidex/roadmap/issues/42',
    'gh api -X POST repos/obidex/roadmap/issues/42/comments -F body=@/home/key',
    'gh api repos/obidex/infra/actions/secrets',
    'gh api -X POST repos/obidex/infra/actions/workflows/ops.yml/dispatches -f ref=main',
    `gh api -X PUT 'repos/obidex/infra/pulls/1/merge?sha=${'b'.repeat(40)}' -f sha=${SHA}`,
    `gh api -X PUT repos/obidex/infra/pulls/1/merge -f sha=${SHA} -f sha=${'b'.repeat(40)}`,
  ]) assert.ok(!classify(command)?.every(Boolean), command);
  assert.equal(classify(`gh api -X PUT repos/obidex/infra/pulls/1/merge -f sha=${SHA}`)[0].kind, 'merge');
});

function setup({ options = {}, remote = 'https://github.com/obidex/jahjah-internal.git', pushRemote = remote, cwd = ROOT, mergeable = 'clean', sha = SHA, broken = false, links = {} } = {}) {
  const handlers = [], inspected = [], files = new Set([ROOT, ROOT + '/src', ROOT + '/scripts', ROOT + '/scripts/replay-check.sh', ROOT + '/package.json', '/work/other', '/work/other/src']);
  register((event, matcher, fn) => { if (typeof matcher === 'function') { fn = matcher; matcher = {}; } handlers.push({ event, matcher, fn }); return { catch() {} }; }, options);
  const api = {
    session: { cwd: async () => cwd },
    fs: { stat: async path => {
      if (links[path]) return links[path];
      if (!files.has(path)) throw new Error('ENOENT');
      return { realPath: path, kind: /\.(?:json|sh)$/.test(path) ? 'file' : 'dir', isLink: false };
    } },
    process: { run: async argv => {
      inspected.push(argv); if (broken) throw new Error('unavailable');
      if (argv[0] === 'gh') return { exitCode: 0, stdout: JSON.stringify({ state: 'open', draft: false, head: { sha }, mergeable: true, mergeable_state: mergeable }) };
      if (argv.includes('rev-parse')) return { exitCode: 0, stdout: argv[2].startsWith('/work/other') ? '/work/other' : ROOT };
      if (argv.includes('config')) return { exitCode: 0, stdout: argv[2].startsWith('/work/other') ? 'https://github.com/other/project.git' : remote };
      if (argv.includes('get-url')) return { exitCode: 0, stdout: pushRemote };
      throw new Error('Unexpected inspection');
    } },
    tool: { register: async () => {} }, command: { register: async () => {} },
  };
  const check = (input, original = { decision: 'ask' }) => handlers.find(h => h.event === 'tool.check').fn(api, input, async () => original);
  const status = async () => JSON.parse((await handlers.find(h => h.event === 'command.run').fn(api, {})).text);
  return { check, status, inspected, handlers };
}

test('approves real routine permission requests without executing requested commands', async () => {
  const h = setup();
  for (const command of ['git push origin claude/test', 'git merge origin/main', 'npm run build', 'bash scripts/replay-check.sh'])
    assert.equal((await h.check({ tool: 'Bash', input: { command } })).decision, 'allow');
  assert.equal((await h.status()).counts.approved, 4);
  assert.ok(h.inspected.every(argv => argv.includes('rev-parse') || argv.includes('config') || argv.includes('get-url')));
});

test('approves new source and canon files but not credentials, git internals or another repo', async () => {
  const h = setup();
  for (const path of ['src/new.ts', 'CLAUDE.md', '.claude/rules/new.md'])
    assert.equal((await h.check({ tool: 'Write', input: { file_path: path } })).decision, 'allow', path);
  for (const path of ['/root/.ssh/key', '/work/other/src/new.ts', '.git/config', '.env', 'server.key'])
    assert.equal((await h.check({ tool: 'Write', input: { file_path: path } })).decision, 'ask', path);
});

test('symlink and redirected-push targets do not inherit the checkout approval', async () => {
  const h = setup({ links: { [ROOT + '/src/link']: { isLink: true, realPath: '/root/.ssh', kind: 'dir' }, [ROOT + '/src/dangling']: { isLink: true, kind: 'other' } } });
  for (const path of ['src/link/key', 'src/dangling'])
    assert.equal((await h.check({ tool: 'Write', input: { file_path: path } })).decision, 'ask');
  const redirected = setup({ pushRemote: 'https://github.com/other/project.git' });
  assert.equal((await redirected.check({ tool: 'Bash', input: { command: 'git push origin claude/test' } })).decision, 'ask');
});

test('preserves explicit denial, connector ceiling, off mode, unknown tools and inspection failure', async () => {
  const e = { tool: 'Bash', input: { command: 'npm test' } };
  const deny = { decision: 'deny', rule: 'Bash(npm test)', reason: 'existing gate' };
  const h = setup(); assert.deepEqual(await h.check(e, deny), deny); assert.equal(h.inspected.length, 0);
  assert.equal((await h.check({ ...e, ceiling: 'ask' })).decision, 'ask');
  assert.equal((await setup({ options: { approval_mode: 'off' } }).check(e)).decision, 'ask');
  assert.equal((await h.check({ tool: 'mcp__billing__buy', input: {} })).decision, 'ask');
  const broken = setup({ broken: true }); assert.equal((await broken.check(e)).decision, 'ask');
  assert.equal((await broken.status()).counts.errors, 1);
});

test('multi-repo parent works with explicit cd or git -C, not directory-name guessing', async () => {
  const h = setup({ cwd: '/work' });
  assert.equal((await h.check({ tool: 'Bash', input: { command: `cd ${ROOT} && npm test` } })).decision, 'allow');
  assert.equal((await h.check({ tool: 'Bash', input: { command: `git -C ${ROOT} push origin claude/test` } })).decision, 'allow');
  assert.equal((await setup({ remote: 'https://github.com/other/jahjah-internal.git' }).check({ tool: 'Bash', input: { command: 'npm test' } })).decision, 'ask');
});

test('merge authorization is tied to the exact head and clean server merge state', async () => {
  const e = { tool: 'Bash', input: { command: `gh api -X PUT repos/obidex/jahjah-internal/pulls/123/merge -f sha=${SHA} -f merge_method=squash` } };
  assert.equal((await setup().check(e)).decision, 'allow');
  assert.equal((await setup({ sha: 'b'.repeat(40) }).check(e)).decision, 'ask');
  for (const mergeable of ['blocked', 'behind', 'dirty', 'unknown', 'unstable'])
    assert.equal((await setup({ mergeable }).check(e)).decision, 'ask', mergeable);
});

test('path normalization respects directory boundaries', () => {
  assert.equal(absolutePath('../other/a', ROOT), '/work/other/a');
  assert.equal(within(ROOT + '-evil/a', ROOT), false);
});

test('package version and agent capabilities match the shipped feature', async () => {
  const manifest = JSON.parse(await readFile(new URL('../plugins/jahjah-tools/.claude-plugin/plugin.json', import.meta.url), 'utf8'));
  assert.equal(manifest.version, (await setup().status()).version);
  const agent = await readFile(new URL('../plugins/jahjah-tools/agents/log-reader.md', import.meta.url), 'utf8');
  assert.match(agent, /^tools: Read, Grep, Glob$/m);
  assert.match(agent, /^maxTurns: 4$/m);
});
