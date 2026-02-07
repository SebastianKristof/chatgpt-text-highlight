#!/usr/bin/env node

import { spawnSync } from 'child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'fs';
import path from 'path';

const ROOT = process.cwd();
const PACKAGE_PATH = path.join(ROOT, 'package.json');
const MANIFEST_PATH = path.join(ROOT, 'manifest.json');
const LOCK_PATH = path.join(ROOT, 'package-lock.json');
const DIST_DIR = path.join(ROOT, 'dist');
const RELEASE_DIR = path.join(ROOT, 'release');
const DIST_ZIP_PATH = path.join(ROOT, 'dist.zip');

function fail(message) {
  console.error(`Error: ${message}`);
  process.exit(1);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    ...options,
  });

  if (result.error) {
    fail(result.error.message);
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function runCapture(command, args, options = {}) {
  const result = spawnSync(command, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8',
    ...options,
  });

  if (result.error) {
    fail(result.error.message);
  }

  if (result.status !== 0) {
    const stderr = (result.stderr || '').trim();
    fail(stderr || `${command} ${args.join(' ')} failed`);
  }

  return (result.stdout || '').trim();
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, data) {
  writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`);
}

function parseSemver(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) {
    fail(`Version "${version}" is not valid semver (x.y.z).`);
  }
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
}

function bump(version, type) {
  const parts = parseSemver(version);
  if (type === 'patch') return `${parts.major}.${parts.minor}.${parts.patch + 1}`;
  if (type === 'minor') return `${parts.major}.${parts.minor + 1}.0`;
  if (type === 'major') return `${parts.major + 1}.0.0`;
  fail(`Unsupported bump type: ${type}`);
}

function normalizeName(name) {
  const value = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return value || 'extension';
}

function syncVersions(nextVersion = null) {
  const pkg = readJson(PACKAGE_PATH);
  const manifest = readJson(MANIFEST_PATH);

  if (nextVersion === null && pkg.version !== manifest.version) {
    fail(`Version mismatch: package.json=${pkg.version}, manifest.json=${manifest.version}`);
  }

  if (nextVersion !== null) {
    parseSemver(nextVersion);
    pkg.version = nextVersion;
    manifest.version = nextVersion;
    writeJson(PACKAGE_PATH, pkg);
    writeJson(MANIFEST_PATH, manifest);

    if (existsSync(LOCK_PATH)) {
      const lock = readJson(LOCK_PATH);
      lock.version = nextVersion;
      if (lock.packages && lock.packages['']) {
        lock.packages[''].version = nextVersion;
      }
      writeJson(LOCK_PATH, lock);
    }
  }

  return {
    packageJson: pkg,
    manifest,
  };
}

function createReleaseZip(version, extensionName) {
  if (!existsSync(DIST_DIR)) {
    fail('dist/ does not exist. Build failed or was skipped.');
  }

  if (!existsSync(RELEASE_DIR)) {
    mkdirSync(RELEASE_DIR, { recursive: true });
  }

  const safeName = normalizeName(extensionName);
  const artifactName = `${safeName}-v${version}.zip`;
  const artifactPath = path.join(RELEASE_DIR, artifactName);
  rmSync(artifactPath, { force: true });

  run('zip', ['-r', '-q', artifactPath, '.'], { cwd: DIST_DIR });
  copyFileSync(artifactPath, DIST_ZIP_PATH);

  console.log(`\nRelease artifact: ${path.relative(ROOT, artifactPath)}`);
  console.log(`Updated latest artifact: ${path.relative(ROOT, DIST_ZIP_PATH)}`);
}

function usage() {
  console.log('Usage: node scripts/release.js <zip|patch|minor|major|set <x.y.z>>');
}

function assertGitReadyForRelease() {
  const insideRepo = runCapture('git', ['rev-parse', '--is-inside-work-tree']);
  if (insideRepo !== 'true') {
    fail('Release tagging requires a git repository.');
  }

  const dirty = runCapture('git', ['status', '--porcelain']);
  if (dirty) {
    fail('Working tree must be clean before version-bump release.');
  }
}

function createReleaseCommitAndTag(version) {
  const tagName = `v${version}`;
  const existingTag = runCapture('git', ['tag', '--list', tagName]);
  if (existingTag === tagName) {
    fail(`Tag ${tagName} already exists.`);
  }

  const filesToAdd = ['package.json', 'manifest.json', 'dist.zip'];
  if (existsSync(LOCK_PATH)) {
    filesToAdd.push('package-lock.json');
  }

  run('git', ['add', ...filesToAdd]);

  const staged = runCapture('git', ['diff', '--cached', '--name-only']);
  if (!staged) {
    fail('No staged release changes found for commit/tag.');
  }

  run('git', ['commit', '-m', `chore(release): v${version}`]);
  run('git', ['tag', '-a', tagName, '-m', `Release ${tagName}`]);
  console.log(`Created git commit and tag: ${tagName}`);
}

function main() {
  const action = process.argv[2];
  if (!action) {
    usage();
    process.exit(1);
  }

  let nextVersion = null;
  const current = syncVersions();
  let shouldTag = false;

  if (action === 'patch' || action === 'minor' || action === 'major') {
    nextVersion = bump(current.packageJson.version, action);
    shouldTag = true;
  } else if (action === 'set') {
    nextVersion = process.argv[3];
    if (!nextVersion) {
      fail('Missing explicit version for "set" action.');
    }
    parseSemver(nextVersion);
    shouldTag = true;
  } else if (action !== 'zip') {
    usage();
    process.exit(1);
  }

  if (shouldTag) {
    assertGitReadyForRelease();
  }

  let finalState = current;
  if (nextVersion !== null) {
    console.log(`Bumping version: ${current.packageJson.version} -> ${nextVersion}`);
    finalState = syncVersions(nextVersion);
  } else {
    console.log(`Using current version: ${current.packageJson.version}`);
  }

  run('npm', ['run', 'test']);
  run('npm', ['run', 'build']);
  createReleaseZip(finalState.packageJson.version, finalState.manifest.name);

  if (shouldTag) {
    createReleaseCommitAndTag(finalState.packageJson.version);
  }
}

main();
