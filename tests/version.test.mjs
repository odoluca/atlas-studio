import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { APP_VERSION } from '../src/version.js';

test('version.json, package.json and src/version.js agree', () => {
  const vj = JSON.parse(readFileSync(new URL('../version.json', import.meta.url), 'utf8')).version;
  const pj = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
  assert.equal(vj, APP_VERSION);
  assert.equal(pj, APP_VERSION);
});
