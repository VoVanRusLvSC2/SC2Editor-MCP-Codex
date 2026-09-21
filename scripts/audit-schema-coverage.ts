import { SchemaRegistry } from "../src/schema/schemaRegistry.js";

const schema = await SchemaRegistry.loadBundled();
const report = schema.auditCoverage();

console.log(JSON.stringify(report, null, 2));

if (
  !report.guarantees.allKnownFrameTypesGenericReadWrite ||
  !report.guarantees.allDeclaredPropertiesGenericReadWrite ||
  report.frameTypes.inheritanceCycles.length ||
  report.properties.unresolvedTypeReferences.length
) {
  process.exitCode = 1;
}
