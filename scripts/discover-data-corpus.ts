import { promises as fs } from "node:fs";
import path from "node:path";
import { DataDocument } from "../src/modules/data/document.js";
import type { DataField } from "../src/modules/data/types.js";
import { dataDomainFromType } from "../src/modules/data/domains.js";

const corpusRoot = path.resolve(process.argv[2] ?? process.env.SC2_DATA_CORPUS ?? "");
const output = path.resolve(process.argv[3] ?? "generated/data-observed-schema.json");
if (!process.argv[2] && !process.env.SC2_DATA_CORPUS) throw new Error("Pass a real SC2 GameData corpus root or set SC2_DATA_CORPUS");

const files: string[] = [];
const visitFiles = async (directory: string): Promise<void> => {
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) await visitFiles(absolute);
    else if (entry.isFile() && entry.name.toLowerCase().endsWith(".xml")) files.push(absolute);
  }
};
await visitFiles(corpusRoot);

const repeatable = new Set<string>();
interface AttributeAccumulator { occurrences: number; examples: Set<string> }
interface FieldAccumulator {
  path: string;
  name: string;
  occurrences: number;
  valueOccurrences: number;
  carriers: Set<string>;
  indexes: Set<string>;
  examples: Set<string>;
  distinctValues: Set<string>;
  valuesTruncated: boolean;
  defaultValues: Set<string>;
  objectsWithField: number;
  numericValues: number;
  integerValues: number;
  booleanValues: number;
  numericMin?: number;
  numericMax?: number;
  nested: boolean;
}
interface TypeAccumulator {
  ctype: string;
  domain?: string;
  objects: number;
  defaults: number;
  parents: Set<string>;
  attributes: Map<string, AttributeAccumulator>;
  fields: Map<string, FieldAccumulator>;
}
const types = new Map<string, TypeAccumulator>();
const catalogIdDomains = new Map<string, Set<string>>();
let catalogs = 0;
let objects = 0;
let fieldInstances = 0;
let parseFailures = 0;
let parseDiagnostics = 0;
let roundTripFailures = 0;
for (const file of files) {
  try {
    const source = await fs.readFile(file, "utf8");
    const document = new DataDocument(source, path.relative(corpusRoot, file));
    parseDiagnostics += document.diagnostics.length;
    if (document.source !== source) roundTripFailures++;
    if (document.root().tag !== "Catalog") continue;
    catalogs++;
    for (const object of document.objects()) {
      objects++;
      let type = types.get(object.ctype);
      if (!type) {
        type = { ctype: object.ctype, domain: dataDomainFromType(object.ctype), objects: 0, defaults: 0, parents: new Set(), attributes: new Map(), fields: new Map() };
        types.set(object.ctype, type);
      }
      type.objects++;
      if (object.id) {
        const key = object.id.toLowerCase();
        const idDomains = catalogIdDomains.get(key) ?? new Set<string>();
        if (object.domain) idDomains.add(object.domain);
        catalogIdDomains.set(key, idDomains);
      }
      if (object.isDefault) type.defaults++;
      if (object.parent) type.parents.add(object.parent);
      for (const [name, value] of Object.entries(object.attrs)) {
        let attribute = type.attributes.get(name);
        if (!attribute) { attribute = { occurrences: 0, examples: new Set() }; type.attributes.set(name, attribute); }
        attribute.occurrences++;
        if (attribute.examples.size < 8) attribute.examples.add(value);
      }
      const objectPaths = new Set<string>();
      const walk = (fields: DataField[], parentPath = "") => {
        const counts = new Map<string, number>();
        for (const field of fields) if (field.index === undefined) counts.set(field.name, (counts.get(field.name) ?? 0) + 1);
        for (const [name, count] of counts) if (count > 1) repeatable.add(`${object.ctype}.${parentPath}${name}`);
        for (const field of fields) {
          fieldInstances++;
          let observed = type!.fields.get(field.path);
          if (!observed) {
            observed = { path: field.path, name: field.name, occurrences: 0, valueOccurrences: 0, carriers: new Set(), indexes: new Set(), examples: new Set(), distinctValues: new Set(), valuesTruncated: false, defaultValues: new Set(), objectsWithField: 0, numericValues: 0, integerValues: 0, booleanValues: 0, nested: false };
            type!.fields.set(field.path, observed);
          }
          observed.occurrences++;
          if (!objectPaths.has(field.path)) { observed.objectsWithField++; objectPaths.add(field.path); }
          observed.nested ||= field.children.length > 0;
          for (const carrier of Object.keys(field.attrs)) observed.carriers.add(carrier);
          if (field.index !== undefined && observed.indexes.size < 64) observed.indexes.add(field.index);
          for (const value of [field.value, field.link]) if (value !== undefined) {
            if (observed.examples.size < 8) observed.examples.add(value);
            if (observed.distinctValues.size < 129) observed.distinctValues.add(value); else observed.valuesTruncated = true;
            if (object.isDefault && observed.defaultValues.size < 16) observed.defaultValues.add(value);
            if (field.value !== undefined && value === field.value) {
              observed.valueOccurrences++;
              const numeric = Number(value);
              if (value.trim() !== "" && Number.isFinite(numeric)) {
                observed.numericValues++;
                if (Number.isInteger(numeric)) observed.integerValues++;
                if (value === "0" || value === "1") observed.booleanValues++;
                observed.numericMin = observed.numericMin === undefined ? numeric : Math.min(observed.numericMin, numeric);
                observed.numericMax = observed.numericMax === undefined ? numeric : Math.max(observed.numericMax, numeric);
              }
            }
          }
          walk(field.children, `${field.path}.`);
        }
      };
      walk(object.fields);
    }
  } catch { parseFailures++; }
}

const report = {
  schemaVersion: "2.0.0",
  evidence: "OBSERVED_REAL_XML",
  corpus: { files: files.length, catalogs, objects, objectTypes: types.size, fieldInstances, fieldPaths: [...types.values()].reduce((sum, type) => sum + type.fields.size, 0), parseDiagnostics, parseFailures, roundTripFailures },
  repeatableUnindexedFields: [...repeatable].sort(),
  types: [...types.values()].sort((left, right) => left.ctype.localeCompare(right.ctype)).map((type) => ({
    ctype: type.ctype,
    domain: type.domain,
    objects: type.objects,
    defaults: type.defaults,
    parents: [...type.parents].sort().slice(0, 256),
    attributes: [...type.attributes].sort(([left], [right]) => left.localeCompare(right)).map(([name, value]) => ({ name, occurrences: value.occurrences, examples: [...value.examples] })),
    fields: [...type.fields.values()].sort((left, right) => left.path.localeCompare(right.path)).map((field) => {
      const distinct = [...field.distinctValues].filter((value) => value !== "");
      const referenceDomains = new Set<string>();
      let catalogMatches = 0;
      for (const value of distinct) {
        const domains = catalogIdDomains.get(value.toLowerCase());
        if (!domains?.size) continue;
        catalogMatches++;
        for (const domain of domains) referenceDomains.add(domain);
      }
      const catalogReferenceConfidence = distinct.length ? catalogMatches / distinct.length : 0;
      const hasCompositeSyntax = distinct.some((value) => /[,:;{}]|\\|\//.test(value));
      const valueType = field.carriers.has("Link") ? "CATALOG_LINK"
        : field.valueOccurrences > 0 && field.booleanValues === field.valueOccurrences ? "BOOLEAN_OBSERVED"
          : field.valueOccurrences > 0 && field.integerValues === field.valueOccurrences ? "INTEGER_OBSERVED"
            : field.valueOccurrences > 0 && field.numericValues === field.valueOccurrences ? "NUMBER_OBSERVED"
              : hasCompositeSyntax ? "TOKEN_PATH_OR_EXPRESSION_OBSERVED"
                : catalogReferenceConfidence >= 0.5 && catalogMatches >= 1 ? "CATALOG_REFERENCE_CANDIDATE"
                  : !field.valuesTruncated && distinct.length > 0 && distinct.length <= 64 ? "ENUM_CANDIDATE_OBSERVED"
                    : "STRING_OR_STRUCT_OBSERVED";
      return ({
      path: field.path,
      name: field.name,
      occurrences: field.occurrences,
      carriers: [...field.carriers].sort(),
      indexes: [...field.indexes].sort(),
      examples: [...field.examples],
      nested: field.nested,
      repeatableUnindexed: repeatable.has(`${type.ctype}.${field.path}`),
      observedPresence: field.objectsWithField === type.objects ? "ALL_OBJECTS" : "SOME_OBJECTS",
      objectsWithField: field.objectsWithField,
      valueType,
      enumCandidates: valueType === "ENUM_CANDIDATE_OBSERVED" ? distinct.sort() : undefined,
      referenceDomainCandidates: valueType === "CATALOG_LINK" || valueType === "CATALOG_REFERENCE_CANDIDATE" ? [...referenceDomains].sort() : [],
      catalogReferenceConfidence: valueType === "CATALOG_REFERENCE_CANDIDATE" ? Number(catalogReferenceConfidence.toFixed(4)) : undefined,
      observedRange: field.numericValues > 0 ? { min: field.numericMin, max: field.numericMax } : undefined,
      observedDefaultCandidates: [...field.defaultValues],
      valuesTruncated: field.valuesTruncated,
      canonicalPath: field.path.replace(/\[[^\]]*\]/g, "[]"),
    }); }),
  })),
};
await fs.mkdir(path.dirname(output), { recursive: true });
await fs.writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({ output, ...report.corpus, repeatableUnindexedFields: repeatable.size }, null, 2)}\n`);
if (parseFailures || roundTripFailures) process.exitCode = 1;
