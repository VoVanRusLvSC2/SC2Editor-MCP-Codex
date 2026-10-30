import test from "node:test";
import assert from "node:assert/strict";
import { XmlParseCache } from "../core/xmlParseCache.js";
import { scanXml } from "../core/xmlScanner.js";

test("read-only XML preparation retains complete parser output and cannot be poisoned by callers", () => {
  const source = '<Root future="keep"><Child value="one"/><Child>&amp; text</Child></Root>',
    cache = new XmlParseCache();
  const parsed = cache.read(source);
  assert.deepEqual(parsed, scanXml(source));
  assert.equal(cache.read(source), parsed);
  assert.throws(() => {
    parsed.nodes[0].attrs.future = "changed";
  }, TypeError);
  assert.throws(() => {
    parsed.nodes[0].childIds.push(99);
  }, TypeError);
  assert.throws(() => {
    parsed.nodes[1].attrSpans[0].valueStart = 999;
  }, TypeError);
  assert.throws(() => {
    parsed.diagnostics.push({ severity: "error", message: "injected", offset: 0 });
  }, TypeError);
  assert.equal(cache.read(source).nodes[0].attrs.future, "keep");
  assert.notEqual(cache.read(source.replace("one", "two")), parsed);
  assert.deepEqual(cache.read("<Root><Broken></Root>"), scanXml("<Root><Broken></Root>"));
});

test("prepared XML cache bounds content bytes and entry count, including uncached large inputs", () => {
  const cache = new XmlParseCache(2, 80);
  cache.read("<A/>");
  cache.read("<B/>");
  cache.read("<A/>");
  cache.read("<C/>");
  assert.equal(cache.stats().entries, 2);
  assert.equal(cache.stats().hits, 1);
  const parses = cache.stats().parses;
  cache.read("<B/>");
  assert.equal(cache.stats().parses, parses + 1);
  const large = "<Root>" + "x".repeat(90) + "</Root>";
  assert.notEqual(cache.read(large), cache.read(large));
  assert.ok(cache.stats().sourceBytes <= 80);
  assert.ok(cache.stats().entries <= 2);
});

test("small but structurally dense XML does not bypass the retention budget", () => {
  const cache = new XmlParseCache(8, 10000, 4);
  cache.read('<A value="1"/>');
  cache.read('<B value="2"/>');
  assert.equal(cache.stats().structureItems, 4);
  cache.read('<C value="3"/>');
  assert.equal(cache.stats().entries, 2);
  assert.equal(cache.stats().structureItems, 4);
  const dense = "<Root><A/><B/><C/><D/></Root>";
  assert.notEqual(cache.read(dense), cache.read(dense));
  assert.equal(cache.stats().entries, 2);
  assert.throws(() => new XmlParseCache(-1), /LIMIT_INVALID/);
});
