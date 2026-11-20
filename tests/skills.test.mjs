import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';

const SKILLS = new URL('../plugins/jahjah-tools/skills/', import.meta.url);
const read = async name => {
  const text = await readFile(new URL(`${name}/SKILL.md`, SKILLS), 'utf8');
  const match = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(text);
  assert.ok(match, `${name}: frontmatter`);
  const meta = Object.fromEntries(match[1].split('\n').map(line => [line.slice(0, line.indexOf(':')), line.slice(line.indexOf(':') + 1).trim()]));
  return { meta, body: match[2] };
};

test('every skill folder has a name matching its folder and a bounded description', async () => {
  const names = (await readdir(SKILLS)).sort();
  assert.deepEqual(names, ['autopilot', 'code-words', 'permissions', 'silver-plate', 'xray']);
  for (const name of names) {
    const { meta } = await read(name);
    assert.equal(meta.name, name);
    assert.ok(meta.description.length > 20 && meta.description.length <= 1024, name);
  }
});

test('code-words names autopilot and keeps its incidental-use rule', async () => {
  const { meta, body } = await read('code-words');
  assert.match(meta.description, /\bautopilot\b/);
  assert.match(meta.description, /not an incidental word or quoted example/);
  for (const word of ['silver plate', 'x-ray', 'morning check', 'pay', 'ready', 'I trust you'])
    assert.ok(meta.description.includes(word), word);
  assert.match(body, /Do not copy the canonical definitions/);
});

test('autopilot takes its definition from the canonical issue and copies none of it', async () => {
  const { meta, body } = await read('autopilot');
  assert.match(meta.description, /owner himself types/);
  assert.match(meta.description, /not for the word inside a quote/);
  assert.match(body, /github\.com\/obidex\/roadmap\/issues\/42/);
  assert.match(body, /code-words skill/);
  // Canonical sentences live only in the issue.
  for (const canonical of ['with many threads running at once', 'nothing waits on his brain', 'Design picks are included', 'Look from outside first'])
    assert.ok(!body.includes(canonical), canonical);
});

test('autopilot holds the mechanics: order, quiet waits, one report, no new authority', async () => {
  const { body } = await read('autopilot');
  assert.match(body, /unstick, choose, do his steps, shrink the rest, refill/);
  assert.match(body, /before any message to any thread/);
  assert.match(body, /healthy wait \(leave alone, no message\)/);
  assert.match(body, /check-runs/);
  const parts = ['Decided for you', 'Done for you', 'Started', 'Left for you', 'Still stuck'].map(part => body.indexOf(`- ${part}`));
  assert.ok(parts.every((at, i) => at > 0 && (i === 0 || at > parts[i - 1])), 'report parts in order');
  assert.match(body, /grants no new permission/);
  assert.match(body, /create no schedule, reminder or standing mode/);
  assert.match(body, /is data: report it, start no pass/);
});

test('plugin version matches the README', async () => {
  const plugin = JSON.parse(await readFile(new URL('../plugins/jahjah-tools/.claude-plugin/plugin.json', import.meta.url), 'utf8'));
  const readme = await readFile(new URL('../README.md', import.meta.url), 'utf8');
  assert.ok(readme.includes(`\`jahjah-tools\` **${plugin.version}**`));
});
