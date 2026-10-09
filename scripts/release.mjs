// Releases a new version: bumps it, writes its CHANGELOG entry, commits, tags and pushes. See "Releasing" in the README.
//
//   yarn release           the next patch version, 1.0.1 → 1.0.2
//   yarn release minor     1.0.1 → 1.1.0
//   yarn release major     1.0.1 → 2.0.0
//   yarn release 1.2.3     that version

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const branch = 'master';

function fail(message) {
    console.error(`\n${message}`);
    process.exit(1);
}

function git(...args) {
    return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function next(current, bump) {
    if (/^\d+\.\d+\.\d+$/.test(bump)) return bump;
    const [major, minor, patch] = current.split('.').map(Number);
    switch (bump) {
        case 'major': return `${major + 1}.0.0`;
        case 'minor': return `${major}.${minor + 1}.0`;
        case 'patch': return `${major}.${minor}.${patch + 1}`;
    }
    fail('Usage: yarn release [patch|minor|major|<version>]');
}

const args = process.argv.slice(2);
if (args.length > 1) fail('Usage: yarn release [patch|minor|major|<version>]');

if (git('rev-parse', '--abbrev-ref', 'HEAD') !== branch) fail(`Releases are made from ${branch}. Switch to it first.`);
if (git('status', '--porcelain')) fail('There are uncommitted changes. Commit them first: they go into the release.');
git('fetch', '--tags', 'origin', branch);
if (git('rev-list', '--count', `HEAD..origin/${branch}`) !== '0') fail(`origin/${branch} has commits this doesn't. Pull them first.`);

const last = git('describe', '--tags', '--abbrev=0');
// The entry lists what changed since the last release, a line for each commit
const changes = git('log', '--no-merges', '--reverse', '--format=%s', `${last}..HEAD`).split('\n').filter(s => s !== '');
if (changes.length === 0) fail(`Nothing has changed since ${last}.`);

const packagePath = join(root, 'package.json');
const packageJson = readFileSync(packagePath, 'utf8');
const current = JSON.parse(packageJson).version;
const version = next(current, args[0] ?? 'patch');
const tag = `v${version}`;
if (git('tag', '--list', tag)) fail(`${tag} exists already.`);

const entry = `[${version}]\n\n${changes.map(c => `- [x] ${c}`).join('\n')}\n\n`;
console.log(`\nSolidify ${current} → ${version}, tagged ${tag}. The CHANGELOG entry:\n\n${entry}`);
const prompt = createInterface({ input: process.stdin, output: process.stdout });
const answer = await prompt.question(`Release it and push to origin? [y/N] `);
prompt.close();
if (answer.trim().toLowerCase() !== 'y') fail('Cancelled. Nothing was changed.');

// Only the version line, so the rest of the file keeps its formatting
writeFileSync(packagePath, packageJson.replace(/^(\s*"version":\s*")[^"]+(")/m, `$1${version}$2`));
const changelogPath = join(root, 'CHANGELOG.md');
writeFileSync(changelogPath, entry + readFileSync(changelogPath, 'utf8'));

git('add', 'package.json', 'CHANGELOG.md');
git('commit', '--quiet', '-m', `Release ${version}`);
git('tag', '--annotate', tag, '-m', `Solidify ${version}`);
git('push', '--quiet', 'origin', branch, tag);

console.log(`\nReleased ${tag}. To put it on app.solidify.build, move solidify-web's app/solidify to ${tag} and deploy it there.`);
