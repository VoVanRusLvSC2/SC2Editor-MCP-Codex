import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectSurfaceCatalog } from '../../dist/modules/terrain/surface/core/catalog.js';
// SYNTHETIC fixtures: filename discovery only; no native catalog field semantics claimed.
function collect(values) {
  const xml = '<Catalog><Test id="SyntheticProbe">'
    + values.map(value => `<Asset value="${value}"/>`).join('')
    + '</Test></Catalog>';
  return inspectSurfaceCatalog(xml).entries[0].assetReferences;
}
test('recognizes hardTile.bin under POSIX directories', () => {
  const v = 'Assets/HardTiles/Test/hardTile.bin'; assert.deepEqual(collect([v]), [v]);
});
test('recognizes hardTile.bin under Windows directories', () => {
  const v = String.raw`Assets\HardTiles\Test\hardTile.bin`; assert.deepEqual(collect([v]), [v]);
});
test('recognizes hardTile.bin as basename', () => {
  assert.deepEqual(collect(['hardTile.bin']), ['hardTile.bin']);
});
test('matches hardTile.bin case-insensitively, preserving original value', () => {
  const v = 'ASSETS/HARDTILES/TEST/HARDTILE.BIN'; assert.deepEqual(collect([v]), [v]);
});
test('does not turn any BIN or suffix match into a recognized asset', () => {
  assert.deepEqual(collect(['foo.bin','x/not-hardTile.bin','hardTile.bin.bak','x/hardTile.bin/child']), []);
});
test('preserves existing recognized extensions and deduplication', () => {
  const values = ['x/a.dds','x/a.m3','x/a.m3a','x/a.tga','x/a.png','x/a.hardtile.bin'];
  assert.deepEqual(collect([...values,...values]), values);
});
test('finds nested hard-tile references and deduplicates paths', () => {
  const xml = '<Catalog><Test id="SyntheticProbe"><Nested><Asset value="x/hardTile.bin"/></Nested><Asset value="x/hardTile.bin"/></Test></Catalog>';
  assert.deepEqual(inspectSurfaceCatalog(xml).entries[0].assetReferences, ['x/hardTile.bin']);
});
