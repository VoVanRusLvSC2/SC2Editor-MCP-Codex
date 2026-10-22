import test from 'node:test';
import assert from 'node:assert/strict';
import { createFlatTerrain } from '../modules/document/codecs/flatTerrainFactory.js';
import { parseState } from '../modules/terrain/operations.js';

const set = { id: 'Test', textures: ['Dirt'], cliffs: ['Cliff'], sourcePaths: [] };
test('fine-height range endpoints round trip without changing the coarse channel', () => {
  for (const initial of [0, 4, 8, 12]) {
    const state = parseState(createFlatTerrain(32, 32, set, 'Dirt', initial));
    const heights = state.heights, offset = 32 + (10 * heights.width + 10) * 6;
    const coarse = heights.bytes.readUInt16LE(offset + 2);
    const range = heights.editableRange(10, 10);
    const quantum = Math.abs(heights.descriptor.quantizeScale * heights.descriptor.scale[2]);
    assert.ok(range.min <= heights.z(10, 10) && range.max >= heights.z(10, 10));
    assert.equal(heights.setZ(10, 10, range.min), range.min);
    assert.equal(heights.setZ(10, 10, range.max), range.max);
    assert.equal(heights.bytes.readUInt16LE(offset + 2), coarse);
    assert.throws(() => heights.setZ(10, 10, range.max + quantum), /HEIGHT_QUANTIZATION_RANGE.*editable range/);
    assert.equal(heights.z(10, 10), range.max);
    assert.throws(() => heights.setZ(10, 10, range.min - quantum), /HEIGHT_QUANTIZATION_RANGE/);
    assert.equal(heights.bytes.readUInt16LE(offset + 2), coarse);
  }
});
test('a lower foundation reserves more upward fine-height editing room', () => {
  const high = parseState(createFlatTerrain(32, 32, set, 'Dirt', 8)).heights;
  const low = parseState(createFlatTerrain(32, 32, set, 'Dirt', 4)).heights;
  assert.ok(high.editableRange(10, 10).max - high.z(10, 10) < 1.01);
  assert.ok(low.editableRange(10, 10).max - low.z(10, 10) > 4.99);
  assert.equal(high.editableRange(10, 10).max, low.editableRange(10, 10).max);
});
