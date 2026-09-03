#!/usr/bin/env node

import { run } from '@tauri-apps/cli';
import { chmodSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import process from 'node:process';

const [runtime, command, ...rawArgs] = process.argv.slice(2);

if (!['wry', 'cef'].includes(runtime) || !['dev', 'build'].includes(command)) {
  console.error('Usage: node scripts/tauri-runtime.mjs <wry|cef> <dev|build> [tauri args]');
  process.exit(2);
}
if (runtime === 'cef' && process.platform !== 'linux') {
  console.error('The CEF runtime is supported on Linux only.');
  process.exit(2);
}

const args = [command, '--features', runtime, ...rawArgs];
if (runtime === 'cef' && command === 'build' && !rawArgs.includes('--no-bundle')) {
  args.splice(1, 0, '--no-bundle');
}
if (!rawArgs.includes('--')) {
  args.push('--');
}
args.push('--no-default-features');

if (runtime === 'cef') {
  const targetDir = process.env.CARGO_TARGET_DIR
    ? resolve(process.env.CARGO_TARGET_DIR)
    : join(process.cwd(), 'src-tauri', 'target');
  makeExistingCefRuntimeWritable(targetDir);
}

try {
  await run(args, 'tauri');
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}

function makeExistingCefRuntimeWritable(targetDir) {
  if (!existsSync(targetDir)) return;

  const profileDirs = ['debug', 'release'].map((profile) => join(targetDir, profile));
  for (const entry of readdirSync(targetDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || ['debug', 'release'].includes(entry.name)) continue;
    for (const profile of ['debug', 'release']) {
      profileDirs.push(join(targetDir, entry.name, profile));
    }
  }

  for (const profileDir of profileDirs) {
    if (!existsSync(profileDir)) continue;
    for (const entry of readdirSync(profileDir, { withFileTypes: true })) {
      const path = join(profileDir, entry.name);
      if (entry.isFile() && isCefRuntimeFile(entry.name)) {
        makeWritable(path);
      } else if (entry.isDirectory() && entry.name === 'locales') {
        makeWritable(path);
        for (const locale of readdirSync(path, { withFileTypes: true })) {
          if (locale.isFile()) makeWritable(join(path, locale.name));
        }
      }
    }
  }
}

function makeWritable(path) {
  chmodSync(path, (statSync(path).mode & 0o777) | 0o200);
}

function isCefRuntimeFile(name) {
  return name === 'chrome-sandbox' || name === 'chrome_crashpad_handler' ||
    name.endsWith('.so') || name.includes('.so.') || /\.(pak|dat|bin|json)$/.test(name);
}
