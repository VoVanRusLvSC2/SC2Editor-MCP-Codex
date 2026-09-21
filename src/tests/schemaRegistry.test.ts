import test from "node:test";
import assert from "node:assert/strict";
import { SchemaRegistry } from "../schema/schemaRegistry.js";

test("loads the full bundled SC2 UI schema and Blizzard observations", async () => {
  const schema = await SchemaRegistry.loadBundled();
  assert.ok(schema.frameTypes.size > 800);
  assert.ok(schema.frameClasses.size > 850);
  assert.ok(schema.simpleTypes.size > 200);
  assert.ok(schema.corpusFiles >= 378);
});

test("resolves frame inheritance and effective typed properties", async () => {
  const schema = await SchemaRegistry.loadBundled();
  const button = schema.describeType("Button");
  assert.deepEqual(button?.inheritance.slice(0, 3), ["CButton", "CControl", "CFrame"]);
  assert.equal(schema.getProperty("Button", "Width")?.valueType, "Real32");
  assert.equal(schema.getProperty("Button", "Text")?.valueType, "Text");
  assert.ok(button?.hookups.some((hookup) => hookup.path === "Label"));
});

test("exposes real StateGroup and animation variants", async () => {
  const schema = await SchemaRegistry.loadBundled();
  assert.ok(schema.stateActionTypes().includes("SetProperty"));
  assert.ok(schema.stateActionTypes().includes("ApplyTemplate"));
  assert.ok(schema.animationControllerTypes().includes("Fade"));
  assert.ok(schema.animationControllerTypes().includes("Anchor"));
  assert.ok(schema.animationControllerTypes().includes("Dimension"));
  assert.match(schema.validateScalar("Boolean", "maybe") ?? "", /Expected Boolean/);
  assert.deepEqual(schema.enumValues("EImageTextureType"), [
    "None", "Normal", "Border", "HorizontalBorder", "EndCap", "NineSlice", "Circular",
  ]);
});

test("catalogs and checks real Blizzard templates for restricted frame types", async () => {
  const schema = await SchemaRegistry.loadBundled();
  assert.ok(schema.blizzardTemplates.size > 2000);
  assert.equal(schema.getFrameType("LaunchURLButton")?.blizzardOnly, true);
  assert.equal(schema.getBlizzardTemplate("ScreenCustomFeatured/CTABannerTemplate")?.frameType, "Frame");
  assert.equal(
    schema.getBlizzardTemplate("StandardBattlenetTemplates/BattlenetMediumAlternateButtonTemplate")?.frameType,
    "Button",
  );
  assert.equal(
    schema.isTemplateCompatible("LaunchURLButton", "StandardBattlenetTemplates/BattlenetMediumAlternateButtonTemplate"),
    true,
  );
  assert.equal(schema.isTemplateCompatible("Image", "StandardBattlenetTemplates/BattlenetMediumAlternateButtonTemplate"), false);
});

test("builds a restriction route for every Blizzard-only type and a complete SceneBrowser container route", async () => {
  const schema = await SchemaRegistry.loadBundled();
  const restricted = [...schema.frameTypes.values()].filter((type) => type.blizzardOnly);
  assert.ok(restricted.length > 400);
  for (const type of restricted) assert.ok(schema.restrictionPlan(type.name));

  const sceneBrowser = schema.restrictionPlan("SceneBrowser");
  assert.equal(sceneBrowser?.recommended.strategy, "container-template");
  if (sceneBrowser?.recommended.strategy !== "container-template") assert.fail("SceneBrowser container route missing");
  assert.equal(sceneBrowser.recommended.template, "StandardDialog/BrowserDialogTemplate");
  assert.equal(sceneBrowser.recommended.containerFrameType, "SceneBrowserDialog");
  assert.equal(sceneBrowser.recommended.targetPath, "SceneBrowser");
  assert.deepEqual(sceneBrowser.containerRoutes[0].missingHookups, []);
  assert.equal(sceneBrowser.containerRoutes[0].requiredHookupsCovered, true);
  assert.equal(sceneBrowser.runtimeExpectation, "may-not-work");
  assert.match(sceneBrowser.runtimeNotice, /may not work at SC2 runtime/i);
});

test("labels ordinary templates separately from locked-frame template usage", async () => {
  const schema = await SchemaRegistry.loadBundled();
  const ordinary = schema.assessTemplateUsage("Button", "StandardBattlenetTemplates/BattlenetMediumAlternateButtonTemplate");
  assert.equal(ordinary.kind, "ordinary-template");
  assert.equal(ordinary.runtimeExpectation, "expected-to-work");
  assert.match(ordinary.notice, /expected to work/i);

  const locked = schema.assessTemplateUsage("LaunchURLButton", "StandardBattlenetTemplates/BattlenetMediumAlternateButtonTemplate");
  assert.equal(locked.kind, "locked-frame-template");
  assert.equal(locked.runtimeExpectation, "may-not-work");
  assert.match(locked.notice, /may not work at SC2 runtime/i);

  const incompatible = schema.assessTemplateUsage("Image", "StandardBattlenetTemplates/BattlenetMediumAlternateButtonTemplate");
  assert.equal(incompatible.runtimeExpectation, "unsupported");
});

test("recommends a visible standard template while retaining alternative choices", async () => {
  const schema = await SchemaRegistry.loadBundled();
  assert.equal(schema.recommendedTemplate("Button")?.reference, "StandardTemplates/StandardButtonTemplate");
  assert.ok(schema.compatibleTemplates("Button", 20).length > 1);
});

test("audits every known frame and declared property without hiding schema gaps", async () => {
  const schema = await SchemaRegistry.loadBundled();
  const report = schema.auditCoverage();
  assert.equal(report.frameTypes.total, schema.frameTypes.size);
  assert.equal(report.frameTypes.described, schema.frameTypes.size);
  assert.deepEqual(report.frameTypes.missingClassDefinitions, []);
  assert.deepEqual(report.frameTypes.inheritanceCycles, []);
  assert.equal(report.properties.declared, 1918);
  assert.equal(report.properties.typedDeclared, report.properties.declared);
  assert.equal(report.properties.structurallyEditableDeclared, report.properties.declared);
  assert.deepEqual(report.properties.unresolvedTypeReferences, []);
  assert.deepEqual(report.properties.opaqueScalarTypes, []);
  assert.equal(report.guarantees.allKnownFrameTypesGenericReadWrite, true);
  assert.equal(report.guarantees.allDeclaredPropertiesGenericReadWrite, true);
  assert.equal(report.guarantees.declaredScalarValidationComplete, true);
  assert.equal(report.guarantees.observedOnlyScalarValidationComplete, false);
  assert.ok(schema.enumValues("EHotkey").includes("MenuGame"));

  for (const frameType of schema.frameTypes.values()) {
    assert.ok(schema.describeType(frameType.name), `Frame type should be describable: ${frameType.name}`);
  }
});
