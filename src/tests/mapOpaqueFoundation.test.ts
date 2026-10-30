import test from 'node:test';
import assert from 'node:assert/strict';
import { preserveOpaqueFoundation } from '../modules/map/opaqueFoundation.js';

const files = ['MapInfo', 't3Terrain.xml', 't3HeightMap', 'Terrain.version', 'Triggers'].map((file, i) => ({file, size: 10, sha256: String(i).repeat(64)}));
const components = Object.fromEntries(files.filter(file => file.file !== 'Triggers').map(file => [file.file, file.sha256]));
const issues = [
  {severity: 'error', code: 'MAPINFO_INVALID', message: 'Error: UNSUPPORTED_MAPINFO_VERSION: 34; preserve only'},
  {severity: 'error', code: 'TERRAIN_INVALID', message: 'UNSUPPORTED_RTXT_VERSION: 100'},
];
const request = {reason: 'Preserve the imported legacy foundation while editing Data and GUI.', componentSha256: components};

test('legacy export pins the complete opaque foundation and retains unverified status', () => {
  const result = preserveOpaqueFoundation(files, issues, request);
  assert.equal(result.parsed, false);
  assert.equal(result.nativeValidation, 'NOT_EXECUTED');
  assert.equal(result.components.length, 4);
  assert.throws(() => preserveOpaqueFoundation(files, issues, {...request, componentSha256: {...components, t3HeightMap: 'f'.repeat(64)}}), /HASH_MISMATCH/);
  assert.throws(() => preserveOpaqueFoundation([...files, {file: 't3Water', size: 3, sha256: 'f'.repeat(64)}], issues, request), /HASH_MISMATCH/);
  assert.throws(() => preserveOpaqueFoundation(files.filter(file => file.file !== 't3HeightMap'), issues, request), /HASH_MISMATCH/);
});

test('legacy preservation rejects malformed foundations and other validation errors', () => {
  for (const message of ['Error: INVALID_MAPINFO_MAGIC', 'Error: TRUNCATED_MAPINFO'])
    assert.throws(() => preserveOpaqueFoundation(files, [{...issues[0], message}], request), /ONLY_UNSUPPORTED/);
  assert.throws(() => preserveOpaqueFoundation(files, [...issues, {severity: 'error', code: 'DECLARED_COMPONENT_MISSING', message: 'terr'}], request), /ONLY_UNSUPPORTED/);
  assert.throws(() => preserveOpaqueFoundation(files, [], request), /ONLY_UNSUPPORTED/);
});
