import type { DataNativeFieldSpec } from "./types.js";
import { visualRecipePreloads } from "./actorRecipes.js";
import type { CatalogPreload } from "./projectileRecipe.js";
import { reviewCardBinding, cardReviewSummary } from "./cardBindings.js";
import { applyDataRecipe } from "./recipePlanner.js";
import { DataCatalogRepository } from "./catalogRepository.js";
import { DataReferenceGraph } from "./referenceGraph.js";
import { flattenDataFields, resolveEffectiveData } from "./effectiveData.js";
import {
  normalizeCatalogPath as normalize,
  catalogProvenance as provenance,
} from "./catalogSupport.js";
import type { CatalogRecord } from "./catalogTypes.js";
import { componentListWithGameData, gameDataIndexWithCatalog } from "./catalogRegistration.js";
export { componentListWithGameData, gameDataIndexWithCatalog } from "./catalogRegistration.js";
import { createHash } from "node:crypto";
import { StringTableDocument } from "../text/stringTable.js";
import { galaxyReferences, guiReferences, objectReferences } from "./crossReferences.js";
import { dataDomainFromType } from "./domains.js";
import path from "node:path";
import { Workspace } from "../../core/workspace.js";
import { scanXml } from "../../core/xmlScanner.js";
import { DataDocument, referenceSchema } from "./document.js";
import { DataSchemaRegistry } from "./schemaRegistry.js";
import { validateDataDocuments } from "./validator.js";
import { nativeClassObservations } from "./nativeClasses.js";
import { unitAbilityAnimationRecipe } from "./unitAnimations.js";
import type {
  AnimationAssetSource,
  AnimationModelInventory,
} from "../assets/animationInventory.js";
import {
  validateDataAuthoring,
  DataAuthoringError,
  type DataAuthoringVerdict,
} from "./authoringValidation.js";
import type {
  DataObject,
  DataObjectSelector,
  DataOperation,
  DataValidationReport,
} from "./types.js";

function selectorAlias(
  selector: DataObjectSelector,
  aliases: Map<string, string>,
): DataObjectSelector {
  if (typeof selector === "string" && selector.startsWith("@")) {
    const value = aliases.get(selector.slice(1));
    if (!value) throw new Error(`Unknown Data operation alias '${selector}'`);
    return value;
  }
  return selector;
}

export class DataWorkspace {
  private readonly catalogRepository: DataCatalogRepository;
  private readonly referenceGraph: DataReferenceGraph;
  get extraRoots() {
    return this.catalogRepository.extraRoots;
  }
  get nativeCatalogFiles() {
    return this.catalogRepository.nativeCatalogFiles;
  }
  set nativeCatalogFiles(files: ReadonlySet<string>) {
    this.catalogRepository.nativeCatalogFiles = files;
  }
  cacheStats() {
    return this.catalogRepository.cacheStats();
  }
  nativePackageProfile(root: string) {
    return this.catalogRepository.nativePackageProfile(root);
  }
  addDependencyRoot(root: string, builtinPackage?: string) {
    this.catalogRepository.addDependencyRoot(root, builtinPackage);
  }
  removeDependencyRoot(root: string) {
    this.catalogRepository.removeDependencyRoot(root);
  }
  async catalog(overrides?: ReadonlyMap<string, string>) {
    await this.dependencyRefresh?.();
    return this.catalogRepository.catalog(overrides);
  }
  private referenceTokenResolver(objects: DataObject[]) {
    return this.referenceGraph.referenceTokenResolver(objects);
  }
  private actorIssues(records: CatalogRecord[]) {
    return this.referenceGraph.actorIssues(records);
  }
  references(records: CatalogRecord[], scope: "all" | "workspace" = "all") {
    return this.referenceGraph.references(records, scope);
  }
  private crossReferences() {
    return this.referenceGraph.crossReferences();
  }

  private plans = new Map<
    string,
    {
      request: Parameters<DataWorkspace["applyTracked"]>[0];
      fingerprint: string;
      schemaSources: Array<{ file: string; sha256: string }>;
    }
  >();

  constructor(
    readonly workspace: Workspace,
    readonly schema = new DataSchemaRegistry(),
    extraRoots = (process.env.SC2_ASSET_ROOTS ?? "").split(path.delimiter).filter(Boolean),
  ) {
    this.catalogRepository = new DataCatalogRepository(workspace, extraRoots);
    this.referenceGraph = new DataReferenceGraph(workspace);
  }
  dependencyRefresh?: () => Promise<void>;
  animationModelReader?: (
    resources: string[],
    sources: AnimationAssetSource[],
  ) => Promise<AnimationModelInventory>;
  async open(file = "Base.SC2Data/GameData/UnitData.xml") {
    const raw = await this.workspace.readRaw(file);
    return {
      ...raw,
      document:
        raw.exists || raw.staged
          ? new DataDocument(raw.text, raw.file)
          : DataDocument.create(raw.file),
    };
  }

  async metadataEntry(domain: string, id: string) {
    const records = await this.catalog();
    const matches = [];
    for (const record of records) {
      if (
        record.engineActive === false ||
        (record.layer === "dependency" &&
          record.dependencyAvailability !== "DECLARED_AVAILABLE" &&
          !record.provenance.some((p) => /^core\.sc2mod$/i.test(p)))
      )
        continue;
      if (!record.document.source.includes(id)) continue;
      for (const node of record.document.entries())
        if (node.attrs.id === id && dataDomainFromType(node.tag) === domain)
          matches.push({
            id,
            domain,
            ctype: node.tag,
            parent: node.attrs.parent,
            layer: record.layer,
            file: record.absolute,
            sha256: createHash("sha256").update(record.document.source).digest("hex"),
          });
    }
    return { available: matches.length > 0, matches, coverageIssues: records.issues };
  }
  private async externalStringReferences() {
    const keys = new Set<string>();
    let total = 0,
      count = 0;
    const collect = (text: string) => {
      total += Buffer.byteLength(text);
      if (total > 64 * 1024 * 1024 || ++count > 512) throw Error("DATA_LOCALIZATION_READ_LIMIT");
      for (const e of new StringTableDocument(text).list(undefined, Number.MAX_SAFE_INTEGER))
        keys.add(e.key);
    };
    for (const file of await this.workspace.listStringFiles())
      collect((await this.workspace.readRaw(file)).text);
    for (const root of this.extraRoots) {
      const locales = await this.workspace.readDirectory(
        root,
        "data-locales",
        (e) => e.isDirectory() && /^[a-z]{4}\.SC2Data$/i.test(e.name),
      );
      for (const locale of locales) {
        const folder = path.join(root, locale.name, "LocalizedData");
        const files = await this.workspace
          .readDirectory(
            folder,
            "data-localized-strings",
            (e) => e.isFile() && /Strings\.txt$/i.test(e.name),
          )
          .catch((e: NodeJS.ErrnoException) => {
            if (e.code === "ENOENT") return [];
            throw e;
          });
        for (const file of files)
          collect(await this.workspace.readDependency(path.join(folder, file.name)));
      }
    }
    return new Map<string, ReadonlySet<string>>([
      ["String", keys],
      ["Hotkey", keys],
    ]);
  }

  private projectedFields(fields: DataObject["fields"], needles: string[]): DataObject["fields"] {
    if (!needles.length) return fields;
    const visit = (entries: DataObject["fields"]): DataObject["fields"] =>
      entries.flatMap((field) => {
        const children = visit(field.children);
        const ownMatch = needles.some((needle) => field.path.toLowerCase().includes(needle));
        return ownMatch || children.length ? [{ ...field, children }] : [];
      });
    return visit(fields);
  }

  private boundedFields(fields: DataObject["fields"], max: number) {
    let total = 0,
      remaining = max;
    const visit = (entries: DataObject["fields"]): DataObject["fields"] =>
      entries.flatMap((field) => {
        total++;
        const keep = remaining-- > 0;
        const children = visit(field.children);
        return keep ? [{ ...field, children }] : [];
      });
    const selected = visit(fields);
    return { selected, total, truncated: total > max };
  }

  async context(
    args: {
      text?: string;
      parent?: string;
      link?: string;
      file?: string;
      ids?: string[];
      ctypes?: string[];
      domains?: string[];
      fields?: string[];
      includeRaw?: boolean;
      includeInherited?: boolean;
      includeDependencies?: boolean;
      includeReferences?: boolean;
      activeOnly?: boolean;
      offset?: number;
      limit?: number;
    } = {},
  ) {
    const records = await this.catalog();
    const requested = args.file ? normalize(args.file) : undefined;
    if (
      requested &&
      !records.some((record) => record.layer === "workspace" && record.file === requested)
    ) {
      const opened = await this.open(requested);
      if (opened.exists || opened.staged)
        records.unshift({
          file: opened.file,
          absolute: opened.absolute,
          layer: "workspace",
          provenance: provenance(opened.absolute),
          document: opened.document,
        });
    }
    const all = records.flatMap((record) =>
      record.document.objects(args.includeRaw ?? false).map((object) => ({
        ...object,
        declarationKey: { file: record.absolute, start: object.declarationKey?.start ?? 0 },
        file: record.file,
        layer: record.layer,
        provenance: record.provenance,
        engineActive: record.engineActive,
        activationMode: record.activationMode,
        dependencyAvailability: record.dependencyAvailability,
        declarationOrder: record.declarationOrder,
        recordKey: `${record.layer}:${record.absolute}`,
      })),
    );
    const ids = new Set((args.ids ?? []).map((value) => value.toLowerCase()));
    const ctypes = new Set((args.ctypes ?? []).map((value) => value.toLowerCase()));
    const domains = new Set((args.domains ?? []).map((value) => value.toLowerCase()));
    const needles = (args.fields ?? []).map((value) => value.toLowerCase());
    const linkReferences = args.link ? this.references(records) : [];
    const matchingObjects = all.filter(
      (object) =>
        (!args.text ||
          object.id?.toLowerCase().includes(args.text.toLowerCase()) ||
          object.ctype.toLowerCase().includes(args.text.toLowerCase())) &&
        (!args.parent || object.parent?.toLowerCase() === args.parent.toLowerCase()) &&
        (!args.link ||
          flattenDataFields([object]).some((f) => f.link === args.link) ||
          linkReferences.some(
            (r) =>
              r.file === object.file &&
              r.object === `${object.ctype}:${object.id}` &&
              r.value === args.link,
          )) &&
        (!args.activeOnly || object.engineActive === true) &&
        (!requested || object.file === requested) &&
        (args.includeDependencies !== false || object.layer === "workspace") &&
        (!ids.size || (object.id && ids.has(object.id.toLowerCase()))) &&
        (!ctypes.size || ctypes.has(object.ctype.toLowerCase())) &&
        (!domains.size || (object.domain && domains.has(object.domain.toLowerCase()))),
    );
    const offset = args.offset ?? 0,
      limit = args.limit ?? 200;
    const filtered = matchingObjects.slice(offset, offset + limit);
    const parentIndex = new Map<string, (typeof all)[number]>(),
      verifiedParents = new Map<string, (typeof all)[number]>();
    const indexes = {
      defaults: new Map<string, typeof all>(),
      layers: new Map<string, typeof all>(),
    };
    for (const object of all) {
      if (object.engineActive === false) continue;
      if (object.isDefault && !object.id) {
        const list = indexes.defaults.get(object.ctype);
        if (list) list.push(object);
        else indexes.defaults.set(object.ctype, [object]);
      }
      if (object.id) {
        const key = object.domain + "\0" + object.id,
          list = indexes.layers.get(key);
        if (list) list.push(object);
        else indexes.layers.set(key, [object]);
      }
    }
    for (const object of all) {
      const key = `${object.domain ?? object.ctype}\0${object.id ?? ""}`;
      if (object.engineActive !== false && !parentIndex.has(key)) parentIndex.set(key, object);
      if (object.engineActive === true && !verifiedParents.has(key))
        verifiedParents.set(key, object);
    }
    const objects = filtered.map((object) => {
      const publicObject: Omit<typeof object, "recordKey"> & { recordKey?: string } = { ...object };
      delete publicObject.recordKey;
      const effective =
        args.includeInherited === false
          ? undefined
          : resolveEffectiveData(
              object,
              all,
              object.engineActive === true ? verifiedParents : parentIndex,
              indexes,
            );
      const fieldSummary = this.boundedFields(
        this.projectedFields(object.fields, needles),
        args.includeRaw ? Number.MAX_SAFE_INTEGER : 200,
      );
      const effectiveEntries = effective
        ? Object.entries(effective.fields).filter(
            ([fieldPath]) =>
              !needles.length || needles.some((needle) => fieldPath.toLowerCase().includes(needle)),
          )
        : [];
      return {
        ...publicObject,
        fields: fieldSummary.selected,
        fieldPagination: {
          total: fieldSummary.total,
          truncated: fieldSummary.truncated,
          details: "Select fields in data.context/data.resolve or explicitly includeRaw",
        },
        effective: effective
          ? {
              ...effective,
              fields: Object.fromEntries(
                effectiveEntries.slice(0, args.includeRaw ? Number.MAX_SAFE_INTEGER : 200),
              ),
              fieldPagination: {
                total: effectiveEntries.length,
                truncated: !args.includeRaw && effectiveEntries.length > 200,
                details: "Select fields in data.resolve",
              },
            }
          : undefined,
      };
    });
    const selective = Boolean(
      requested ||
      ids.size ||
      ctypes.size ||
      domains.size ||
      needles.length ||
      args.text ||
      args.parent ||
      args.link,
    );
    const selectedRecordKeys = new Set(filtered.map((object) => object.recordKey));
    const selectedIds = new Set(
      filtered.flatMap((object) => (object.id ? [object.id.toLowerCase()] : [])),
    );
    const selectedObjects = new Set(
      filtered.map((object) => `${object.ctype}:${object.id ?? ""}`.toLowerCase()),
    );
    const cross = args.includeReferences === false ? undefined : await this.crossReferences();
    if (cross) cross.issues.push(...this.actorIssues(records));
    const allReferences =
      args.includeReferences === false
        ? undefined
        : [...this.references(records), ...(cross?.references ?? [])];
    const matchingReferences = allReferences?.filter(
      (reference) =>
        !selective ||
        (selectedIds.has(reference.value.toLowerCase()) &&
          (!domains.size ||
            !reference.targetDomain ||
            domains.has(reference.targetDomain.toLowerCase()))) ||
        selectedObjects.has(reference.object.toLowerCase()),
    );
    const references = matchingReferences?.slice(0, args.limit ?? 200);
    const visibleRecords = selective
      ? records.filter((record) => selectedRecordKeys.has(`${record.layer}:${record.absolute}`))
      : records;
    return {
      files: visibleRecords
        .filter((record) => args.includeDependencies !== false || record.layer === "workspace")
        .map((record) => ({
          file: record.file,
          layer: record.layer,
          provenance: record.provenance,
          objects: record.document.entries().length,
          sha256: record.document.sha256,
          engineActive: record.engineActive,
          activationMode: record.activationMode,
          activationWarnings: record.activationWarnings,
          dependencyAvailability: record.dependencyAvailability,
          declarationOrder: record.declarationOrder,
        })),
      corpusSummary: {
        files: records.length,
        objects: all.length,
        objectTypes: new Set(all.map((entry) => entry.ctype)).size,
      },
      objects,
      references,
      pagination: {
        total: matchingObjects.length,
        offset,
        truncated: offset + limit < matchingObjects.length,
        next: offset + limit < matchingObjects.length ? offset + limit : null,
      },
      referencePagination: {
        total: matchingReferences?.length ?? 0,
        truncated: (matchingReferences?.length ?? 0) > (references?.length ?? 0),
        scope:
          "Loaded GameData XML; use data.references for complete paginated cross-domain queries",
      },
      coverageIssues: [...records.issues, ...(cross?.issues ?? [])].slice(0, 200),
      coveragePagination: {
        total: records.issues.length + (cross?.issues.length ?? 0),
        truncated: records.issues.length + (cross?.issues.length ?? 0) > 200,
        details: "data.references issueOffset/issueLimit",
      },
      diagnostics: requested
        ? (await this.validate(requested)).diagnostics.slice(0, args.limit ?? 200)
        : [],
      schema: {
        mode: "observed-bundled-plus-dynamic",
        activeObjectTypes: new Set(
          all.filter((entry) => entry.engineActive === true).map((entry) => entry.ctype),
        ).size,
        activeFieldPaths: new Set(
          all
            .filter((entry) => entry.engineActive === true)
            .flatMap((entry) =>
              flattenDataFields([entry]).map((field) => `${entry.ctype}.${field.path}`),
            ),
        ).size,
        coverage: this.schema.coverage(),
      },
      operations: [
        "object.create",
        "object.clone",
        "object.rename",
        "object.delete",
        "object.setParent",
        "object.setType",
        "object.setAttribute",
        "object.removeAttribute",
        "field.set",
        "field.setLink",
        "field.setAttribute",
        "field.removeAttribute",
        "field.remove",
        "array.append",
        "native.add",
        "recipe.weaponBurn",
        "recipe.unitTextureByVital",
        "recipe.unitActor",
        "recipe.effectModel",
        "recipe.instantAbility",
        "recipe.targetAbility",
        "recipe.abilityCharges",
        "recipe.projectileEffect",
        "recipe.veterancy",
        "recipe.xpSearch",
        "recipe.learn",
        "recipe.unitAbilityAnimation",
      ],
      recipes: {
        "recipe.learn": {
          tool: "data.hero.learn",
          requires:
            "Bound explicit unparented CBehaviorVeterancy table, local instant/target abilities with explicit Levels, valid distinct learn cards",
          semantics:
            "Native CAbilLearn points and per-level gains, Learn1..Learn20 commands, minimum/skip rank gates; execution Data remains separate",
          limits:
            "No competing learn pool, unknown inherited veterancy or implicit rank count. Native point/rank/UI behavior needs gameplay testing",
        },
        "recipe.abilityCharges": {
          tool: "data.ability.charges",
          requires: "One unambiguous local CAbilEffectInstant/Target with direct indexed Cost[0]",
          semantics:
            "Own the native Charge subtree; preserve effects, energy, cooldown and command card. Explicit Abil/Unit/Player/Global scope, own/default link and optional natural recovery; max0 disables the charge gate",
          limits:
            "Direct level-zero execution abilities only; shared state and recovery require native gameplay checks; no Behavior/OffCost or unindexed local costs",
        },
        "recipe.projectileEffect": {
          tool: "data.effect.projectile",
          creates: ["CEffectLaunchMissile", "CActorAction", "merged Preload.xml dependencies"],
          requires:
            "Explicit matching GenericAttack launch/impact source tokens, one ActionDamage event, unique native ammo/Missile Actor/Model, impact Effect, Damage Effect and impact Model",
          semantics:
            "Retain native ammo/mover, rebind launch/impact/damage and pin missile/impact/sound presentation instead of implicit new-ID asset lookups",
          limits:
            "Observed GenericAttack/GenericAttackMissile profile only; body animation, visual/audio playback and mechanics require native checks; single-catalog only",
        },
        "recipe.unitAbilityAnimation": {
          tool: "data.actor.ability_animation",
          creates: ["Owned ability phase events on one existing local main CActorUnit"],
          requires:
            "Unique active unit/ability/main Actor and resolved effective Model; actual installed/imported M3 sequence metadata",
          semantics:
            "Cast/channel/finish phase bindings, stop/death/movement cleanup; unrelated native events remain intact. Saved plans pin observed asset revision.",
          limits:
            "Single catalog; conservative ownership/parent guards; sequence existence does not establish native playback or artistic suitability",
        },
        "recipe.xpSearch": {
          tool: "data.xp.search",
          creates: ["CGame:Dflt VeterancySearchRadius override"],
          requires: "Explicit radius; replace:true when changing an existing local radius",
          semantics:
            "Map-wide native kill-XP recipient search; radius0 disables nearby automatic recipients",
          limits:
            "Does not override behavior-level sharing or native XP eligibility; not a per-hero setting",
        },
        "recipe.veterancy": {
          tool: "data.hero.veterancy",
          creates: ["CBehaviorVeterancy", "local unit behavior binding and Hero flag"],
          requires:
            "Local unit with resolvable unambiguous parents and no other known veterancy; existing level Effect",
          semantics:
            "Native kill XP; cumulative XP thresholds become native per-transition costs; level entries start at0 for displayed level1; cumulative life and four damage-kind deltas",
          limits:
            "Per-behavior sharing disabled; map-wide CGame search remains inherited unless data.xp.search explicitly changes it. Presentation and actual native level/stat behavior require separate engine checks; single-catalog only",
        },
        "recipe.instantAbility": {
          tool: "data.ability.instant",
          creates: ["CAbilEffectInstant", "optional local-unit ability/card binding"],
          requires:
            "One active same-class native template; existing effect and button; explicit indexed card when binding a local unit",
          semantics:
            "Inherit native execution defaults, set energy and unit cooldown, neutralize inherited life/resource cost and optionally research requirements. Existing ability replacement is explicit.",
          limits:
            "Single catalog only; other inherited behavior, native execution and presentation still require target tests",
        },
        "recipe.targetAbility": {
          tool: "data.ability.target",
          creates: ["CAbilEffectTarget", "optional local-unit ability/card binding"],
          requires:
            "Explicit active same-class source template, existing effect/button, explicit indexed local unit/card when binding",
          semantics:
            "Native inherited target/filter/cursor semantics; optional range, energy, unit cooldown. Does not infer unit/point target behavior.",
          limits:
            "Single catalog only; valid/invalid targeting, execution and presentation require native tests",
        },
        "recipe.unitActor": {
          tool: "data.apply",
          creates: ["native-class unit Actor"],
          requires: "One native source Actor with a GenericUnit template; explicit unit and Model",
          semantics:
            "Copy authored presentation, rebind unit events, pin display/build/placement Model and retain the source native class. replace:true explicitly rebuilds an existing Actor.",
          limits: "Concrete source layer overlays and full native rendering are not simulated",
        },
        "recipe.effectModel": {
          tool: "data.apply",
          creates: ["CActorModel", "merged Preload.xml dependencies"],
          semantics:
            "Native Start/Stop event, Source/Caster/Target context, host/site operation, inherited scale and one-shot orphan policy are explicit. stopEffect/stopEvent close the bracket. Model/Actor/Effect and related sound preloads are committed atomically. replace:true rebuilds an existing Actor.",
          limits: "Model existence is checked; engine playback remains a separate test",
        },
        "recipe.weaponBurn": {
          creates: [
            "CEffectDamage",
            "CBehaviorBuff",
            "CEffectApplyBehavior",
            "CEffectSet",
            "CActorModel",
          ],
          patches: "carrierEffect.carrierPath",
          defaults: {
            carrierCtype: "CEffectCreatePersistent",
            carrierPath: "PeriodicEffectArray[0]",
            attachSite: "SOpAttachHead",
          },
        },
        "recipe.unitTextureByVital": {
          creates: ["2x CTexture per slot", "CValidatorUnitCompareVital", "CActorStateMonitor"],
          semantics:
            "fractional Life threshold with reversible healthy/damaged TextureSelectById states",
          defaults: { pollInterval: 0.5 },
          requires: "healthy and damaged DDS paths for every declared model material slot",
        },
      },
      recommendedWorkflow:
        "one data.context + one data.apply; data.apply includes validation, minimal diff, backup and atomic commit",
    };
  }
  private referenceTokens(objects: DataObject[], ctype: string, id?: string) {
    return this.referenceTokenResolver(objects)(ctype, id);
  }

  async referenceQuery(
    args: {
      id?: string;
      domain?: string;
      direction?: "incoming" | "outgoing" | "both";
      offset?: number;
      limit?: number;
      issueOffset?: number;
      issueLimit?: number;
    } = {},
  ) {
    const records = await this.catalog();
    const cross = await this.crossReferences();
    cross.issues.push(...this.actorIssues(records));
    const all = [...this.references(records), ...cross.references].filter((r) => {
      const incoming =
        (!args.id || r.value === args.id) &&
        (!args.domain || !r.targetDomain || r.targetDomain === args.domain);
      const [ctype, ...parts] = r.object.split(":");
      const outgoing =
        (!args.id || parts.join(":") === args.id) &&
        (!args.domain || dataDomainFromType(ctype) === args.domain);
      return args.direction === "incoming"
        ? incoming
        : args.direction === "outgoing"
          ? outgoing
          : incoming || outgoing;
    });
    const offset = args.offset ?? 0,
      limit = args.limit ?? 100;
    const coverageIssues = [
        ...records.issues,
        ...cross.issues,
        {
          code: "EXTERNAL_CONSUMERS_NOT_INDEXED",
          scope: "Unknown catalog calls and unconfigured external consumers",
        },
      ],
      issueOffset = args.issueOffset ?? 0,
      issueLimit = args.issueLimit ?? 100;
    return {
      schema: referenceSchema.manifest()?.source,
      scope: "Loaded GameData XML, supported Galaxy catalog calls, GUI gamelinks and Objects v27",
      coverage: "PARTIAL",
      issues: coverageIssues.slice(issueOffset, issueOffset + issueLimit),
      issuePagination: {
        total: coverageIssues.length,
        offset: issueOffset,
        truncated: issueOffset + issueLimit < coverageIssues.length,
        next: issueOffset + issueLimit < coverageIssues.length ? issueOffset + issueLimit : null,
      },
      total: all.length,
      items: all.slice(offset, offset + limit),
      truncated: offset + limit < all.length,
      next: offset + limit < all.length ? offset + limit : null,
    };
  }

  async resolveFields(args: { id: string; domain: string; fields?: string[] }) {
    const context = await this.context({
      ids: [args.id],
      domains: [args.domain],
      fields: args.fields,
      includeReferences: false,
    });
    return {
      objects: context.objects
        .filter((o) => o.id === args.id && o.domain === args.domain)
        .map((o) => ({
          id: o.id,
          domain: o.domain,
          file: o.file,
          layer: o.layer,
          declarationKey: o.declarationKey,
          effective: o.effective,
        })),
      coverage: "PARTIAL",
      scope:
        "Loaded declarations and available parents; unresolved runtime layer rules remain explicit",
    };
  }

  async query(args: {
    text?: string;
    ids?: string[];
    ctypes?: string[];
    domains?: string[];
    field?: string;
    link?: string;
    parent?: string;
    invalidOnly?: boolean;
    includeDependencies?: boolean;
    offset?: number;
    limit?: number;
  }) {
    const context = await this.context({
      text: args.text,
      parent: args.parent,
      link: args.link,
      offset: args.offset,
      ids: args.ids,
      ctypes: args.ctypes,
      domains: args.domains,
      fields: args.field ? [args.field] : undefined,
      includeDependencies: args.includeDependencies,
      includeReferences: true,
      includeInherited: false,
      limit: args.limit ?? 200,
    });
    const needle = args.text?.toLowerCase();
    const objects = context.objects.filter(
      (object) =>
        (!needle ||
          object.id?.toLowerCase().includes(needle) ||
          object.ctype.toLowerCase().includes(needle)) &&
        (!args.parent || object.parent?.toLowerCase() === args.parent.toLowerCase()) &&
        (!args.link ||
          flattenDataFields([object]).some((field) => field.link === args.link) ||
          context.references?.some(
            (reference) =>
              reference.file === object.file &&
              reference.object === `${object.ctype}:${object.id}` &&
              reference.value === args.link,
          )),
    );
    const diagnostics = args.invalidOnly
      ? (await this.validate()).diagnostics.filter((entry) => entry.severity !== "info")
      : undefined;
    return {
      objects,
      pagination: context.pagination,
      referencePagination: context.referencePagination,
      coverageIssues: context.coverageIssues,
      references: context.references?.filter(
        (reference) => !args.link || reference.value.toLowerCase() === args.link.toLowerCase(),
      ),
      diagnostics,
    };
  }

  async describeType(ctype?: string) {
    const records = await this.catalog();
    const objects = records.flatMap((record) =>
      record.document
        .objects()
        .map((object) => ({ ...object, layer: record.layer, provenance: record.provenance })),
    );
    return {
      ...this.schema.describe(ctype, objects),
      nativeClassObservations: nativeClassObservations(ctype),
    };
  }

  async unitMetrics(
    id: string,
  ): Promise<
    { minerals?: number; vespene?: number; supply?: number; provenance: string[] } | undefined
  > {
    const records = await this.catalog();
    const all = records.flatMap((record) =>
      record.document.objects().map((object) => ({
        ...object,
        file: record.file,
        layer: record.layer,
        provenance: record.provenance,
        engineActive: record.engineActive,
      })),
    );
    const unit = all.find(
      (object) => object.domain === "Unit" && object.id?.toLowerCase() === id.toLowerCase(),
    );
    if (!unit) return undefined;
    const effective = resolveEffectiveData(unit, all);
    const numberAt = (...paths: string[]) => {
      for (const fieldPath of paths) {
        const value = effective.fields[fieldPath]?.value;
        if (value !== undefined && Number.isFinite(Number(value))) return Number(value);
      }
      return undefined;
    };
    return {
      minerals: numberAt("CostResource[Minerals]", "Cost[Minerals]", "Minerals"),
      vespene: numberAt("CostResource[Vespene]", "CostResource[Gas]", "Cost[Vespene]", "Vespene"),
      supply: numberAt("Food", "Supply"),
      provenance: unit.provenance,
    };
  }

  async batch(request: {
    changes: Array<{ file: string; operations: DataOperation[] }>;
    componentListFile?: string;
    gameDataIndexFile?: string;
    dryRun?: boolean;
    stage?: boolean;
    backup?: boolean;
    expectedSha256?: Record<string, string>;
  }) {
    return this.workspace.withReadSet(async () => {
      if (!request.changes.length || request.changes.length > 48)
        throw new Error("DATA_BATCH_FILE_LIMIT");
      if (request.changes.reduce((n, c) => n + c.operations.length, 0) > 500)
        throw new Error("DATA_BATCH_OPERATION_LIMIT");
      const targets = request.changes.map((c) => normalize(c.file));
      for (const target of targets) {
        const absolute = this.workspace.resolveUserPath(target);
        if (
          this.extraRoots.some((root) => absolute === root || absolute.startsWith(root + path.sep))
        )
          throw new Error("DATA_DEPENDENCY_READ_ONLY");
      }
      if (new Set(targets).size !== targets.length) throw new Error("DATA_BATCH_DUPLICATE_FILE");
      for (const target of targets)
        if (!/(?:^|\/)GameData\/[^/]+\.xml$/i.test(target))
          throw new Error("DATA_BATCH_CATALOG_PATH_REQUIRED: " + target);
      const component = normalize(request.componentListFile ?? "ComponentList.SC2Components"),
        index = normalize(request.gameDataIndexFile ?? "Base.SC2Data/GameData.xml");
      const files = this.workspace.coupledDraftFiles([...targets, component, index]);
      if (files.length > 64) throw new Error("DATA_BATCH_FILE_LIMIT");
      const aliases = new Map<string, { file: string; key: string; id: string }>(),
        applied: Array<{ file: string; op: string; target: string }> = [];
      const futureAliases = new Map<string, string>();
      for (const group of request.changes)
        for (const op of group.operations)
          if ("as" in op && op.as) {
            if (futureAliases.has(op.as)) throw new Error("DATA_BATCH_ALIAS_DUPLICATE: " + op.as);
            if (op.op === "object.create" || op.op === "object.clone")
              futureAliases.set(op.as, op.id);
          }
      let verdicts: Array<{ file: string; authoring: DataAuthoringVerdict }> = [],
        validation: DataValidationReport | undefined;
      const transaction = await this.workspace.applyRawTransaction(
        files,
        async (sources) => {
          const next = new Map(sources),
            original = new Map(
              targets.map((file) => [
                file,
                sources.get(file)
                  ? new DataDocument(sources.get(file)!, file)
                  : DataDocument.create(file),
              ]),
            ),
            docs = new Map(
              targets.map((file) => [
                file,
                sources.get(file)
                  ? new DataDocument(sources.get(file)!, file)
                  : DataDocument.create(file),
              ]),
            );
          const resolveAlias = (value: string) =>
            value.startsWith("@")
              ? (aliases.get(value.slice(1))?.id ??
                futureAliases.get(value.slice(1)) ??
                (() => {
                  throw new Error("DATA_BATCH_ALIAS_UNKNOWN: " + value);
                })())
              : value;
          const resolveFields = (fields: DataNativeFieldSpec[]): DataNativeFieldSpec[] =>
            fields.map((f) => ({
              ...f,
              value: typeof f.value === "string" ? resolveAlias(f.value) : f.value,
              link: f.link ? resolveAlias(f.link) : undefined,
              children: f.children ? resolveFields(f.children) : undefined,
            }));
          for (let i = 0; i < request.changes.length; i++) {
            const file = targets[i],
              doc = docs.get(file)!;
            for (const operation of request.changes[i].operations) {
              const selector =
                "object" in operation
                  ? selectorAlias(
                      operation.object,
                      new Map(
                        [...aliases]
                          .filter(([, v]) => v.file === file)
                          .map(([name, v]) => [name, v.key]),
                      ),
                    )
                  : undefined;
              let target: string;
              switch (operation.op) {
                case "object.create": {
                  const node = doc.createObject(operation.ctype, operation.id, {
                    ...operation,
                    fields: operation.fields ? resolveFields(operation.fields) : undefined,
                  });
                  target = doc.objectKey(node);
                  break;
                }
                case "object.clone": {
                  const node = doc.cloneObject(selector!, operation.id, operation.parent);
                  target = doc.objectKey(node);
                  break;
                }
                case "object.setParent":
                  doc.setParent(
                    selector!,
                    operation.parent ? resolveAlias(operation.parent) : undefined,
                  );
                  target = doc.objectKey(doc.resolve(selector!));
                  break;
                case "object.setType": {
                  const previous = doc.objectKey(doc.resolve(selector!));
                  target = doc.objectKey(doc.setType(selector!, operation.ctype));
                  for (const [name, value] of aliases)
                    if (value.file === file && value.key === previous)
                      aliases.set(name, { ...value, key: target });
                  break;
                }
                case "object.setAttribute":
                  doc.setObjectAttribute(selector!, operation.attribute, operation.value);
                  target = doc.objectKey(doc.resolve(selector!));
                  break;
                case "object.removeAttribute":
                  doc.removeObjectAttribute(selector!, operation.attribute);
                  target = doc.objectKey(doc.resolve(selector!));
                  break;
                case "field.set":
                  doc.setField(
                    selector!,
                    operation.path,
                    "value",
                    typeof operation.value === "string"
                      ? resolveAlias(operation.value)
                      : operation.value,
                  );
                  target = doc.objectKey(doc.resolve(selector!));
                  break;
                case "field.setLink":
                  doc.setField(selector!, operation.path, "Link", resolveAlias(operation.link));
                  target = doc.objectKey(doc.resolve(selector!));
                  break;
                case "field.setAttribute":
                  doc.setField(
                    selector!,
                    operation.path,
                    operation.attribute,
                    typeof operation.value === "string"
                      ? resolveAlias(operation.value)
                      : operation.value,
                  );
                  target = doc.objectKey(doc.resolve(selector!));
                  break;
                case "field.removeAttribute":
                  doc.removeFieldAttribute(selector!, operation.path, operation.attribute);
                  target = doc.objectKey(doc.resolve(selector!));
                  break;
                case "field.remove":
                  doc.removeField(selector!, operation.path);
                  target = doc.objectKey(doc.resolve(selector!));
                  break;
                case "array.append":
                  doc.appendArray(selector!, operation.path, {
                    ...operation,
                    value:
                      typeof operation.value === "string"
                        ? resolveAlias(operation.value)
                        : operation.value,
                    link: operation.link ? resolveAlias(operation.link) : undefined,
                  });
                  target = doc.objectKey(doc.resolve(selector!));
                  break;
                case "native.add":
                  doc.addNative(
                    selector!,
                    operation.parentPath,
                    resolveFields([operation.field])[0],
                  );
                  target = doc.objectKey(doc.resolve(selector!));
                  break;
                default:
                  throw new Error("DATA_BATCH_OPERATION_UNSUPPORTED: " + operation.op);
              }
              if ("as" in operation && operation.as) {
                if (aliases.has(operation.as))
                  throw new Error("DATA_BATCH_ALIAS_DUPLICATE: " + operation.as);
                const object = doc.resolve(target);
                aliases.set(operation.as, { file, key: target, id: object.attrs.id });
              }
              applied.push({ file, op: operation.op, target });
            }
            next.set(file, doc.source);
          }
          next.set(component, componentListWithGameData(next.get(component) ?? ""));
          let include = next.get(index) ?? "";
          for (const file of targets) include = gameDataIndexWithCatalog(include, file);
          next.set(index, include);
          const records = await this.catalog(next);
          for (const file of targets)
            if (!records.some((r) => r.layer === "workspace" && r.file === file))
              records.push({
                file,
                absolute: this.workspace.resolveUserPath(file),
                layer: "workspace",
                provenance: ["workspace"],
                document: docs.get(file)!,
              });
          const external = await this.externalStringReferences();
          validation = validateDataDocuments(
            targets[0],
            records,
            this.schema,
            this.references(records, "workspace"),
            external,
          );
          verdicts = targets.map((file) => ({
            file,
            authoring: validateDataAuthoring(
              file,
              original.get(file)!,
              docs.get(file)!,
              records,
              records.issues,
              external,
            ),
          }));
          const rejected = verdicts.find((v) => !v.authoring.accepted);
          if (rejected) throw new DataAuthoringError(rejected.authoring);
          if (!validation.valid)
            throw new Error(
              "DATA_BATCH_VALIDATION_FAILED: " +
                validation.diagnostics
                  .filter((d) => d.severity === "error")
                  .slice(0, 5)
                  .map((d) => d.code + " " + d.path)
                  .join("; "),
            );
          for (const [file, text] of next)
            if (targets.includes(file) || file === component || file === index)
              if (scanXml(text).diagnostics.some((d) => d.severity === "error"))
                throw new Error("DATA_BATCH_XML_INVALID: " + file);
          return next;
        },
        {
          dryRun: request.dryRun ?? true,
          stage: request.stage ?? true,
          backup: request.backup ?? true,
          expectedSha256: request.expectedSha256,
          summary: "Strict multi-catalog Data batch",
        },
      );
      return {
        ...transaction,
        aliases: Object.fromEntries([...aliases].map(([name, v]) => ["@" + name, v])),
        applied,
        validation,
        authoring: verdicts,
        editor: "NOT_RUN",
        runtime: "NOT_RUN",
      };
    });
  }

  private async planFingerprint() {
    const records = await this.catalog(),
      cross = await this.crossReferences();
    const info = (await this.workspace.readRaw("DocumentInfo")).text;
    const material = {
      roots: this.extraRoots,
      info,
      records: records.map((r) => [
        r.file,
        r.layer,
        r.engineActive,
        r.dependencyAvailability,
        createHash("sha256").update(r.document.source).digest("hex"),
      ]),
      issues: records.issues,
      cross: cross.references.map((r) => [r.file, r.path, r.value, r.targetDomain, r.resolution]),
      consumerFiles: cross.files,
      crossIssues: cross.issues,
      schema: referenceSchema.manifest()?.source,
    };
    return createHash("sha256").update(JSON.stringify(material)).digest("hex");
  }

  async plan(request: Parameters<DataWorkspace["applyTracked"]>[0]) {
    const before = await this.planFingerprint();
    const preview = await this.apply({
      ...request,
      dryRun: true,
      authoringPolicy: "strict",
      validate: true,
      allowInvalid: false,
    });
    const after = await this.planFingerprint();
    if (before !== after) throw new Error("STALE_DATA_PLAN_DURING_PREVIEW");
    const normalized = {
      ...request,
      operations: request.operations.map((op, index) =>
        op.op === "recipe.unitAbilityAnimation"
          ? {
              ...op,
              expectedAssetRevision: preview.applied.find((a) => a.index === index)?.animation
                ?.assetRevision,
            }
          : op,
      ),
      authoringPolicy: "strict" as const,
      validate: true,
      allowInvalid: false,
    };
    const planId = createHash("sha256")
      .update(JSON.stringify({ request: normalized, fingerprint: after, preview: preview.files }))
      .digest("hex");
    this.plans.set(planId, {
      request: normalized,
      fingerprint: after,
      schemaSources: referenceSchema.sources(),
    });
    while (this.plans.size > 64) this.plans.delete(this.plans.keys().next().value!);
    return {
      planId,
      fingerprint: after,
      files: preview.files,
      applied: preview.applied,
      aliases: preview.aliases,
      validation: preview.validation,
      authoring: preview.authoring,
      ...(preview.cardReviews
        ? { cardReviews: preview.cardReviews, cardReviewCount: preview.cardReviewCount }
        : {}),
      readyToApply: preview.authoring.accepted,
      policy: "strict",
      editor: "NOT_RUN",
      runtime: "NOT_RUN",
    };
  }

  async applyPlan(planId: string, dryRun = true, stage = true) {
    const plan = this.plans.get(planId);
    if (!plan) throw new Error("DATA_PLAN_NOT_FOUND");
    if ((await this.planFingerprint()) !== plan.fingerprint) throw new Error("STALE_DATA_PLAN");
    for (const schema of plan.schemaSources) {
      const source = await this.workspace.readDependency(schema.file);
      if (createHash("sha256").update(source).digest("hex") !== schema.sha256)
        throw new Error("STALE_DATA_PLAN_SCHEMA");
    }
    const result = await this.apply({ ...plan.request, dryRun, stage });
    if (!dryRun) this.plans.delete(planId);
    return { ...result, planId };
  }

  async apply(request: Parameters<DataWorkspace["applyTracked"]>[0]) {
    return this.workspace.withReadSet(() => this.applyTracked(request));
  }
  private async applyTracked(request: {
    file?: string;
    componentListFile?: string;
    gameDataIndexFile?: string;
    referenceFiles?: string[];
    operations: DataOperation[];
    dryRun?: boolean;
    stage?: boolean;
    backup?: boolean;
    validate?: boolean;
    allowInvalid?: boolean;
    expectedSha256?: Record<string, string>;
    authoringPolicy?: "strict" | "compatibility";
  }) {
    const target = this.workspace.resolveUserPath(
      request.file ?? "Base.SC2Data/GameData/UnitData.xml",
    );
    if (this.extraRoots.some((root) => target === root || target.startsWith(root + path.sep)))
      throw new Error("DATA_DEPENDENCY_READ_ONLY");
    if (!request.operations.length) throw new Error("data.apply requires at least one operation");
    if (request.operations.length > 500)
      throw new Error("data.apply accepts at most 500 operations");
    const targetFile = normalize(request.file ?? "Base.SC2Data/GameData/UnitData.xml");
    const componentFile = normalize(request.componentListFile ?? "ComponentList.SC2Components");
    const indexFile = normalize(request.gameDataIndexFile ?? "Base.SC2Data/GameData.xml");
    const records = await this.catalog();
    const actorRecipeObjects = request.operations.some(
      (o) =>
        o.op === "recipe.unitActor" ||
        o.op === "recipe.effectModel" ||
        o.op === "recipe.instantAbility" ||
        o.op === "recipe.targetAbility" ||
        o.op === "recipe.veterancy",
    )
      ? records.filter((r) => r.engineActive !== false).flatMap((r) => r.document.objects())
      : [];
    const cross = await this.crossReferences();
    cross.issues.push(...this.actorIssues(records));
    const allReferences = [...this.references(records), ...cross.references];
    for (const schema of referenceSchema.sources()) {
      const source = await this.workspace.readDependency(schema.file);
      if (createHash("sha256").update(source).digest("hex") !== schema.sha256)
        throw new Error("STALE_DATA_SCHEMA_TRANSACTION");
    }
    const referenceFiles = new Set((request.referenceFiles ?? []).map(normalize));
    for (const operation of request.operations) {
      if (operation.op !== "object.rename" && operation.op !== "object.delete") continue;
      if (typeof operation.object === "string" && operation.object.startsWith("@")) continue;
      const opened = await this.open(targetFile);
      const node = opened.document.resolve(operation.object);
      const oldId = node.attrs.id;
      if (!oldId) continue;
      const domain = dataDomainFromType(node.tag);
      if (!referenceSchema.manifest()) throw new Error("DATA_SCHEMA_UNAVAILABLE");
      if (
        allReferences.some(
          (ref) =>
            ref.resolution === "unknown" && (!ref.targetDomain || ref.targetDomain === domain),
        )
      )
        throw new Error(
          "DATA_REFERENCE_COVERAGE_UNKNOWN: unresolved token reference in affected domain",
        );
      if (records.issues.length)
        throw new Error(
          "DATA_REFERENCE_COVERAGE_UNKNOWN: unreadable or malformed catalog: " +
            records.issues[0].file,
        );
      if (cross.issues.some((issue) => !issue.targetDomain || issue.targetDomain === domain))
        throw new Error("DATA_REFERENCE_COVERAGE_UNKNOWN: dynamic consumer in affected domain");
      if (
        operation.op === "object.rename" &&
        allReferences.some(
          (ref) =>
            ref.value === oldId &&
            (!ref.targetDomain || ref.targetDomain === domain) &&
            ref.rewritePolicy === "readOnly",
        )
      )
        throw new Error(
          "DATA_REFERENCE_REWRITE_UNSUPPORTED: inherited token context requires local field materialization",
        );
      if (
        cross.references.some(
          (ref) => ref.value === oldId && ref.targetDomain === domain && ref.rewrite === "readOnly",
        ) &&
        operation.op === "object.rename"
      )
        throw new Error("DATA_REFERENCE_REWRITE_UNSUPPORTED: computed or embedded script consumer");
      const incoming = allReferences.filter(
        (reference) =>
          reference.value === oldId &&
          (!reference.targetDomain || reference.targetDomain === dataDomainFromType(node.tag)) &&
          reference.file !== targetFile,
      );
      if (incoming.length && operation.op === "object.rename" && !operation.updateReferences)
        throw new Error(
          `Data object '${oldId}' has ${incoming.length} incoming reference(s); set updateReferences=true`,
        );
      if (incoming.length && operation.op === "object.delete" && !operation.force)
        throw new Error(
          `Data object '${oldId}' has ${incoming.length} incoming reference(s); delete is blocked unless force=true`,
        );
      if (operation.op === "object.rename" && operation.updateReferences)
        for (const reference of incoming)
          if (
            records.some(
              (record) => record.layer === "workspace" && record.file === reference.file,
            ) ||
            cross.references.some((ref) => ref.file === reference.file)
          )
            referenceFiles.add(reference.file);
    }
    const visualRecipes = request.operations.filter(
      (o): o is Extract<DataOperation, { op: "recipe.effectModel" }> =>
        o.op === "recipe.effectModel",
    );
    const hasProjectiles = request.operations.some((o) => o.op === "recipe.projectileEffect");
    const preloadFile = path.posix.join(path.posix.dirname(componentFile), "Preload.xml");
    const files = this.workspace.coupledDraftFiles([
      targetFile,
      componentFile,
      indexFile,
      ...referenceFiles,
      ...(visualRecipes.length || hasProjectiles ? [preloadFile] : []),
    ]);
    if (files.length > 64)
      throw new Error(
        `Atomic Data rename touches ${files.length} files; narrow referenceFiles to at most 61 catalog files`,
      );
    let validation: DataValidationReport | undefined;
    let authoring: DataAuthoringVerdict | undefined;
    let aliases: Record<string, string> = {};
    let applied: Array<{
      index: number;
      op: string;
      target?: string;
      animation?: ReturnType<typeof unitAbilityAnimationRecipe> & {
        assetRevision: string;
        assets: Array<{ resource: string; sha256: string; build?: string }>;
        supplementalCoverage: string;
        warnings: string[];
      };
    }> = [];
    const cardReviews: Array<{ operation: number; review: ReturnType<typeof cardReviewSummary> }> =
      [];
    const transaction = await this.workspace.applyRawTransaction(
      files,
      async (sources) => {
        const next = new Map(sources);
        const projectilePreloads: CatalogPreload[] = [];
        const originalDocument = sources.get(targetFile)
          ? new DataDocument(sources.get(targetFile)!, targetFile)
          : DataDocument.create(targetFile);
        const document = sources.get(targetFile)
          ? new DataDocument(sources.get(targetFile)!, targetFile)
          : DataDocument.create(targetFile);
        const liveGraph = () => {
          const live = records.map((record) =>
            record.layer === "workspace"
              ? {
                  ...record,
                  document:
                    record.file === targetFile
                      ? document
                      : next.has(record.file)
                        ? new DataDocument(next.get(record.file)!, record.file)
                        : record.document,
                }
              : record,
          );
          if (!live.some((r) => r.layer === "workspace" && r.file === targetFile))
            live.push({
              file: targetFile,
              absolute: this.workspace.resolveUserPath(targetFile),
              layer: "workspace",
              provenance: ["workspace"],
              document,
            });
          const refs = [
            ...this.references(live),
            ...cross.references.filter((r) => !next.has(r.file)),
          ];
          for (const [file, text] of next) {
            const result = /\.galaxy$/i.test(file)
              ? galaxyReferences(file, text)
              : file === "Triggers"
                ? guiReferences(file, text)
                : file === "Objects"
                  ? objectReferences(file, text)
                  : undefined;
            if (result) refs.push(...result.references);
          }
          return { references: refs, issues: this.actorIssues(live) };
        };
        const aliasMap = new Map<string, string>();
        applied = [];
        cardReviews.length = 0;
        for (let index = 0; index < request.operations.length; index++) {
          const operation = request.operations[index];
          let target: string | undefined;
          let animation: (typeof applied)[number]["animation"];
          const recipe = applyDataRecipe(
            {
              workspace: this.workspace,
              document,
              records,
              targetFile,
              actorRecipeObjects,
              projectilePreloads,
              index,
              cardReviews,
            },
            operation,
          );
          if (recipe) target = recipe.target;
          else
            switch (operation.op) {
              case "recipe.unitAbilityAnimation": {
                if (!this.animationModelReader)
                  throw Error("UNIT_ANIMATION_ASSET_RESOLVER_UNAVAILABLE");
                const absolute = this.workspace.resolveUserPath(targetFile);
                const active = [
                  ...records
                    .filter(
                      (r) =>
                        r.engineActive !== false &&
                        !(r.layer === "workspace" && r.absolute === absolute),
                    )
                    .flatMap((r) =>
                      r.document.objects().map((o) => ({
                        ...o,
                        file: r.absolute,
                        layer: r.layer,
                        engineActive: r.engineActive,
                      })),
                    ),
                  ...document
                    .objects()
                    .map((o) => ({ ...o, file: absolute, layer: "workspace", engineActive: true })),
                ];
                const unique = (domain: string, id: string) => {
                  const matches = active.filter((o) => o.domain === domain && o.id === id);
                  if (matches.length !== 1)
                    throw Error("UNIT_ANIMATION_DECLARATION_UNRESOLVED: " + domain + ":" + id);
                  return matches[0];
                };
                const actor = unique("Actor", operation.actor),
                  actorState = resolveEffectiveData(actor, active),
                  actorModel = actorState.fields.Model;
                if (
                  actorState.unresolvedParents.length ||
                  actorModel?.status !== "resolved" ||
                  !actorModel.value
                )
                  throw Error("UNIT_ANIMATION_ACTOR_MODEL_UNRESOLVED");
                const model = unique("Model", actorModel.value),
                  modelState = resolveEffectiveData(model, active),
                  resource = modelState.fields.Model;
                if (
                  modelState.unresolvedParents.length ||
                  resource?.status !== "resolved" ||
                  !resource.value
                )
                  throw Error("UNIT_ANIMATION_MODEL_RESOURCE_UNRESOLVED");
                const required = Object.values(modelState.fields).filter((f) =>
                    /^RequiredAnims(?:\[|$)/.test(f.path),
                  ),
                  unresolved = required.filter((f) => f.status === "unknown");
                const resources = [
                  ...new Set([
                    resource.value,
                    ...required
                      .filter((f) => f.status === "resolved" && f.value)
                      .map((f) => f.value!),
                  ]),
                ];
                const roots = this.extraRoots
                  .map((root) => ({
                    root,
                    order: Math.max(
                      -1,
                      ...records
                        .filter(
                          (r) =>
                            r.layer === "dependency" &&
                            r.dependencyAvailability === "DECLARED_AVAILABLE" &&
                            (r.absolute === root || r.absolute.startsWith(root + path.sep)),
                        )
                        .map((r) => r.declarationOrder ?? -1),
                    ),
                  }))
                  .filter((r) => r.order >= 0)
                  .sort((a, b) => b.order - a.order);
                const inventory = await this.animationModelReader(resources, [
                  { root: this.workspace.root },
                  ...roots.map((r) => ({
                    root: r.root,
                    package: this.nativePackageProfile(r.root),
                  })),
                ]);
                if (
                  operation.expectedAssetRevision !== undefined &&
                  operation.expectedAssetRevision !== inventory.revision
                )
                  throw Error("UNIT_ANIMATION_STALE_ASSET_REVISION");
                const written = unitAbilityAnimationRecipe(document, active, operation, {
                  actor: operation.actor,
                  unit: operation.unit,
                  actorModel: actorModel.value,
                  file: inventory.file,
                  sha256: inventory.sha256,
                  animations: inventory.animations,
                });
                target = written.target;
                animation = {
                  ...written,
                  assetRevision: inventory.revision,
                  assets: inventory.assets.map(({ resource, sha256, build }) => ({
                    resource,
                    sha256,
                    ...(build ? { build } : {}),
                  })),
                  supplementalCoverage: unresolved.length
                    ? "partial"
                    : inventory.supplementalCoverage,
                  warnings: [
                    ...inventory.warnings,
                    ...unresolved.map((f) => "Unresolved supplemental animation field: " + f.path),
                  ].slice(0, 8),
                };
                break;
              }
              case "object.create": {
                const node = document.createObject(operation.ctype, operation.id, operation);
                target = document.objectKey(node);
                break;
              }
              case "object.clone": {
                const node = document.cloneObject(
                  selectorAlias(operation.object, aliasMap),
                  operation.id,
                  operation.parent,
                );
                target = document.objectKey(node);
                break;
              }
              case "object.rename": {
                const live = liveGraph(),
                  currentReferences = live.references;
                const selector = selectorAlias(operation.object, aliasMap);
                const before = document.resolve(selector);
                const beforeId = before.attrs.id;
                if (!beforeId)
                  throw new Error(`Cannot rename ${document.objectKey(before)} without id`);
                if (
                  records.issues.length ||
                  currentReferences.some(
                    (ref) =>
                      ref.resolution === "unknown" &&
                      (!ref.targetDomain || ref.targetDomain === dataDomainFromType(before.tag)),
                  )
                )
                  throw new Error("DATA_REFERENCE_COVERAGE_UNKNOWN");
                if (
                  [...cross.issues, ...live.issues].some(
                    (issue) =>
                      !issue.targetDomain || issue.targetDomain === dataDomainFromType(before.tag),
                  )
                )
                  throw new Error("DATA_REFERENCE_COVERAGE_UNKNOWN");
                if (
                  currentReferences.some(
                    (ref) =>
                      ref.value === beforeId &&
                      (!ref.targetDomain || ref.targetDomain === dataDomainFromType(before.tag)) &&
                      ref.rewritePolicy === "readOnly",
                  )
                )
                  throw new Error("DATA_REFERENCE_REWRITE_UNSUPPORTED: inherited token context");
                const externalIncoming = currentReferences.filter(
                  (ref) =>
                    ref.file !== targetFile &&
                    ref.value === beforeId &&
                    (!ref.targetDomain || ref.targetDomain === dataDomainFromType(before.tag)),
                );
                if (externalIncoming.length && !operation.updateReferences)
                  throw new Error(
                    "Data object has incoming reference(s); set updateReferences=true",
                  );
                if (externalIncoming.some((ref) => !referenceFiles.has(ref.file)))
                  throw new Error("DATA_REFERENCE_BATCH_SCOPE_UNRESOLVED");
                if (
                  cross.references.some(
                    (ref) =>
                      ref.value === beforeId &&
                      ref.targetDomain === dataDomainFromType(before.tag) &&
                      ref.rewrite === "readOnly",
                  )
                )
                  throw new Error("DATA_REFERENCE_REWRITE_UNSUPPORTED");
                const internalIncoming = currentReferences
                  .filter((r) => r.file === targetFile)
                  .filter(
                    (reference) =>
                      reference.value === beforeId &&
                      (!reference.targetDomain ||
                        reference.targetDomain === dataDomainFromType(before.tag)) &&
                      reference.object !== document.objectKey(before),
                  );
                if (internalIncoming.length && !operation.updateReferences)
                  throw new Error(
                    `Data object '${beforeId}' has ${internalIncoming.length} incoming reference(s); set updateReferences=true`,
                  );
                const candidateDomains = new Set([
                  ...records
                    .flatMap((record) => record.document.objects())
                    .filter((object) => object.id === beforeId)
                    .map((object) => object.domain ?? object.ctype),
                  ...document
                    .objects()
                    .filter((object) => object.id === beforeId)
                    .map((object) => object.domain ?? object.ctype),
                ]);
                const hasLinkReferences =
                  internalIncoming.some((reference) => reference.carrier === "Link") ||
                  currentReferences.some(
                    (reference) => reference.value === beforeId && reference.carrier === "Link",
                  );
                if (operation.updateReferences && hasLinkReferences && candidateDomains.size > 1)
                  throw new Error(
                    `Cannot safely rename ambiguous catalog id '${beforeId}': native Link references exist and the id occurs in ${candidateDomains.size} domains`,
                  );
                const result = document.renameObject(selector, operation.newId);
                if (operation.updateReferences) {
                  document.patchReferences(
                    result.oldId,
                    operation.newId,
                    result.domain,
                    true,
                    (entry) =>
                      this.referenceTokens(
                        [
                          ...records
                            .filter((r) => r.file !== targetFile)
                            .flatMap((r) => r.document.objects()),
                          ...document.objects(),
                        ],
                        entry.tag,
                        entry.attrs.id,
                      ),
                  );
                  for (const file of referenceFiles) {
                    if (file === targetFile) continue;
                    const currentExternal = /\.galaxy$/i.test(file)
                      ? galaxyReferences(file, next.get(file)!).references
                      : file === "Triggers"
                        ? guiReferences(file, next.get(file)!).references
                        : file === "Objects"
                          ? objectReferences(file, next.get(file)!).references
                          : [];
                    const external = currentExternal.filter(
                      (ref) => ref.value === result.oldId && ref.targetDomain === result.domain,
                    );
                    if (external.length) {
                      let text = next.get(file)!;
                      for (const ref of external.sort(
                        (a, b) => b.sourceSpan!.start - a.sourceSpan!.start,
                      )) {
                        const span = ref.sourceSpan!;
                        const replacement =
                          ref.rewrite === "galaxyLiteral"
                            ? JSON.stringify(operation.newId)
                            : operation.newId
                                .replaceAll("&", "&amp;")
                                .replaceAll("<", "&lt;")
                                .replaceAll('"', "&quot;")
                                .replaceAll("'", "&apos;");
                        text = text.slice(0, span.start) + replacement + text.slice(span.end);
                      }
                      next.set(file, text);
                      continue;
                    }
                    const referenced = new DataDocument(next.get(file) ?? "", file);
                    referenced.patchReferences(
                      result.oldId,
                      operation.newId,
                      result.domain,
                      true,
                      (entry) =>
                        this.referenceTokens(
                          [
                            ...records
                              .filter((r) => r.file !== file)
                              .flatMap((r) => r.document.objects()),
                            ...referenced.objects(),
                          ],
                          entry.tag,
                          entry.attrs.id,
                        ),
                    );
                    next.set(file, referenced.source);
                  }
                }
                target = `${result.ctype}:${operation.newId}`;
                for (const [alias, value] of aliasMap)
                  if (value === `${result.ctype}:${result.oldId}`) aliasMap.set(alias, target);
                break;
              }
              case "object.delete": {
                const live = liveGraph(),
                  currentReferences = live.references;
                const selector = selectorAlias(operation.object, aliasMap);
                const node = document.resolve(selector);
                target = document.objectKey(node);
                if (
                  records.issues.length ||
                  currentReferences.some(
                    (ref) =>
                      ref.resolution === "unknown" &&
                      (!ref.targetDomain || ref.targetDomain === dataDomainFromType(node.tag)),
                  )
                )
                  throw new Error("DATA_REFERENCE_COVERAGE_UNKNOWN");
                if (
                  [...cross.issues, ...live.issues].some(
                    (issue) =>
                      !issue.targetDomain || issue.targetDomain === dataDomainFromType(node.tag),
                  )
                )
                  throw new Error("DATA_REFERENCE_COVERAGE_UNKNOWN");
                const externalIncoming = currentReferences.filter(
                  (ref) =>
                    ref.file !== targetFile &&
                    ref.value === node.attrs.id &&
                    (!ref.targetDomain || ref.targetDomain === dataDomainFromType(node.tag)),
                );
                if (externalIncoming.length && !operation.force)
                  throw new Error("Data object has incoming reference(s); delete blocked");
                const id = node.attrs.id;
                const incoming = id
                  ? currentReferences
                      .filter((r) => r.file === targetFile)
                      .filter(
                        (reference) =>
                          reference.value === id &&
                          (!reference.targetDomain ||
                            reference.targetDomain === dataDomainFromType(node.tag)) &&
                          reference.object !== target,
                      )
                  : [];
                if (incoming.length && !operation.force)
                  throw new Error(
                    `Data object '${id}' has ${incoming.length} incoming reference(s); delete is blocked unless force=true`,
                  );
                document.removeObject(selector);
                break;
              }
              case "object.setParent": {
                const selector = selectorAlias(operation.object, aliasMap);
                document.setParent(selector, operation.parent);
                target = document.objectKey(document.resolve(selector));
                break;
              }
              case "object.setType": {
                const selector = selectorAlias(operation.object, aliasMap),
                  before = document.objectKey(document.resolve(selector));
                target = document.objectKey(document.setType(selector, operation.ctype));
                for (const [alias, value] of aliasMap)
                  if (value === before) aliasMap.set(alias, target);
                break;
              }
              case "object.setAttribute": {
                const selector = selectorAlias(operation.object, aliasMap);
                document.setObjectAttribute(selector, operation.attribute, operation.value);
                target = `${document.objectKey(document.resolve(selector))}@${operation.attribute}`;
                break;
              }
              case "object.removeAttribute": {
                const selector = selectorAlias(operation.object, aliasMap);
                document.removeObjectAttribute(selector, operation.attribute);
                target = `${document.objectKey(document.resolve(selector))}@${operation.attribute}`;
                break;
              }
              case "field.set": {
                const selector = selectorAlias(operation.object, aliasMap);
                document.setField(selector, operation.path, "value", operation.value);
                target = `${document.objectKey(document.resolve(selector))}.${operation.path}`;
                break;
              }
              case "field.setLink": {
                const selector = selectorAlias(operation.object, aliasMap);
                document.setField(selector, operation.path, "Link", operation.link);
                target = `${document.objectKey(document.resolve(selector))}.${operation.path}`;
                break;
              }
              case "field.setAttribute": {
                const selector = selectorAlias(operation.object, aliasMap);
                document.setField(selector, operation.path, operation.attribute, operation.value);
                target = `${document.objectKey(document.resolve(selector))}.${operation.path}@${operation.attribute}`;
                break;
              }
              case "field.removeAttribute": {
                const selector = selectorAlias(operation.object, aliasMap);
                document.removeFieldAttribute(selector, operation.path, operation.attribute);
                target = `${document.objectKey(document.resolve(selector))}.${operation.path}@${operation.attribute}`;
                break;
              }
              case "field.remove": {
                const selector = selectorAlias(operation.object, aliasMap);
                document.removeField(selector, operation.path);
                target = `${document.objectKey(document.resolve(selector))}.${operation.path}`;
                break;
              }
              case "array.append": {
                const selector = selectorAlias(operation.object, aliasMap);
                const added = document.appendArray(selector, operation.path, operation);
                target = `${document.objectKey(document.resolve(selector))}.${added}`;
                break;
              }
              case "native.add": {
                const selector = selectorAlias(operation.object, aliasMap);
                document.addNative(selector, operation.parentPath, operation.field);
                target = `${document.objectKey(document.resolve(selector))}.${operation.field.name}`;
                break;
              }
            }
          if ("as" in operation && operation.as) {
            if (!target) throw new Error(`Operation ${index} did not produce an alias target`);
            const objectTarget = target.split(".", 1)[0];
            aliasMap.set(operation.as, objectTarget);
          }
          applied.push({ index, op: operation.op, target, ...(animation ? { animation } : {}) });
        }
        next.set(targetFile, document.source);
        if (visualRecipes.length || projectilePreloads.length)
          next.set(
            preloadFile,
            visualRecipePreloads(
              sources.get(preloadFile) ?? "",
              document,
              visualRecipes,
              projectilePreloads,
            ),
          );
        next.set(componentFile, componentListWithGameData(next.get(componentFile) ?? ""));
        next.set(indexFile, gameDataIndexWithCatalog(next.get(indexFile) ?? "", targetFile));
        if ((request.validate ?? true) || request.authoringPolicy !== "compatibility") {
          const validationRecords = await this.catalog(next);
          if (
            !validationRecords.some(
              (record) => record.layer === "workspace" && record.file === targetFile,
            )
          )
            validationRecords.unshift({
              file: targetFile,
              absolute: this.workspace.resolveUserPath(targetFile),
              layer: "workspace",
              provenance: ["workspace"],
              document,
            });
          validation = validateDataDocuments(
            targetFile,
            validationRecords,
            this.schema,
            this.references(validationRecords, "workspace"),
          );
          authoring = validateDataAuthoring(
            targetFile,
            originalDocument,
            document,
            validationRecords,
            validationRecords.issues,
            await this.externalStringReferences(),
          );
          if (request.authoringPolicy !== "compatibility" && !authoring.accepted)
            throw new DataAuthoringError(authoring);
          if (!validation.valid && !request.allowInvalid)
            throw new Error(
              `Data validation failed with ${validation.errors} error(s): ${validation.diagnostics
                .filter((entry) => entry.severity === "error")
                .slice(0, 5)
                .map((entry) => `${entry.path}: ${entry.message}`)
                .join("; ")}`,
            );
        }
        for (const [file, text] of next)
          if (
            file === targetFile ||
            file === componentFile ||
            file === indexFile ||
            /\.xml$/i.test(file) ||
            file === "Triggers" ||
            file === "Objects"
          )
            if (scanXml(text).diagnostics.some((d) => d.severity === "error"))
              throw new Error("DATA_XML_INVALID: " + file);
        for (const schema of referenceSchema.sources()) {
          const source = await this.workspace.readDependency(schema.file);
          if (createHash("sha256").update(source).digest("hex") !== schema.sha256)
            throw new Error("STALE_DATA_SCHEMA_TRANSACTION");
        }
        aliases = Object.fromEntries([...aliasMap].map(([name, value]) => [`@${name}`, value]));
        return next;
      },
      {
        dryRun: request.dryRun ?? true,
        stage: request.stage ?? true,
        backup: request.backup ?? true,
        expectedSha256: request.expectedSha256,
        summary: `Apply ${request.operations.length} Data operations atomically`,
      },
    );
    const nativeMutations = request.operations.reduce(
      (total, operation) =>
        total +
        (operation.op === "recipe.weaponBurn"
          ? 6
          : operation.op === "recipe.unitTextureByVital"
            ? operation.textures.length * 2 + 2
            : 1),
      0,
    );
    return {
      ...transaction,
      applied,
      aliases,
      validation,
      ...(cardReviews.length
        ? { cardReviews: cardReviews.slice(0, 16), cardReviewCount: cardReviews.length }
        : {}),
      authoring: authoring
        ? {
            ...authoring,
            executionPolicy:
              request.authoringPolicy === "compatibility" ? "COMPATIBILITY" : "STRICT",
          }
        : {
            status: "INCOMPLETE",
            accepted: false,
            parse: "PASS",
            completeness: "INCOMPLETE",
            executionPolicy: "COMPATIBILITY",
            staticValidation: "INCOMPLETE",
            editor: "NOT_RUN",
            runtime: "NOT_RUN",
            diagnostics: [],
            scope: "Authoring validation disabled",
          },
      authoringPolicy: request.authoringPolicy ?? "strict",
      referenceCoverage: "PARTIAL",
      referenceScope:
        "Declared XSD XML carriers, supported actor selectors/messages, GUI gamelinks, Objects v27 and supported native Galaxy arguments within configured roots",
      excludedScope: ["Unknown free-text/custom carriers", "Unconfigured external consumers"],
      efficiency: {
        toolCalls: 1,
        operations: request.operations.length,
        nativeMutations,
        files: transaction.files.length,
        includesValidation: request.validate ?? true,
        includesDiff: true,
      },
    };
  }

  async cardCheck(unit: string, offset = 0, limit = 25) {
    const objects = (await this.catalog())
      .filter((r) => r.engineActive !== false)
      .flatMap((r) => r.document.objects());
    const review = reviewCardBinding(objects, unit),
      { accepted, ...summary } = cardReviewSummary(review);
    return {
      ...summary,
      bindingAccepted: accepted,
      status: !review.layoutResolved
        ? "unverified"
        : review.conflicts.length
          ? "review_required"
          : "no_known_conflicts",
      bindings: review.bindings.slice(offset, offset + limit),
      offset,
      total: review.bindings.length,
      nextOffset: offset + limit < review.bindings.length ? offset + limit : null,
      scope:
        "Known active Unit-parent cards, measured implicit-root/explicit-index overlays. Shared-face/cell findings do not prove simultaneous native visibility or actual user hotkeys; no engine presentation acceptance.",
    };
  }
  async validate(file = "Base.SC2Data/GameData/UnitData.xml"): Promise<DataValidationReport> {
    const records = await this.catalog();
    if (
      !records.some((record) => record.layer === "workspace" && record.file === normalize(file))
    ) {
      const opened = await this.open(file);
      records.unshift({
        file: opened.file,
        absolute: opened.absolute,
        layer: "workspace",
        provenance: ["workspace"],
        document: opened.document,
      });
    }
    return validateDataDocuments(
      normalize(file),
      records,
      this.schema,
      this.references(records, "workspace"),
      await this.externalStringReferences(),
    );
  }
}
