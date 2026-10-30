import { Workspace } from "../../core/workspace.js";
import { DataDocument } from "./document.js";
import type { DataOperation, DataObject, DataNativeFieldSpec } from "./types.js";
import type { CatalogRecord } from "./catalogTypes.js";
import { unitActorRecipe, effectModelRecipe } from "./actorRecipes.js";
import { instantAbilityRecipe, targetAbilityRecipe } from "./abilityRecipes.js";
import { abilityChargesRecipe } from "./abilityCharges.js";
import { projectileEffectRecipe, type CatalogPreload } from "./projectileRecipe.js";
import { veterancyRecipe } from "./veterancyRecipe.js";
import { xpSearchRecipe } from "./xpSearchRecipe.js";
import { learnRecipe } from "./learnRecipe.js";
import { unitCopyRecipe } from "./unitCopyRecipe.js";
import { configureUnit, configureSpell } from "./configureRecipes.js";
import { reviewCardBinding, cardReviewSummary, DataCardBindingError } from "./cardBindings.js";
interface RecipeContext {
  workspace: Workspace;
  document: DataDocument;
  records: CatalogRecord[];
  targetFile: string;
  actorRecipeObjects: DataObject[];
  projectilePreloads: CatalogPreload[];
  index: number;
  cardReviews: Array<{ operation: number; review: ReturnType<typeof cardReviewSummary> }>;
}
const recipeFields = (...fields: DataNativeFieldSpec[]) => fields;
/** Ordered recipe mutation only. The caller retains validation and the complete transaction. */
export function applyDataRecipe(
  context: RecipeContext,
  operation: DataOperation,
): { target?: string } | undefined {
  const {
    workspace,
    document,
    records,
    targetFile,
    actorRecipeObjects,
    projectilePreloads,
    index,
    cardReviews,
  } = context;
  let target: string | undefined;
  switch (operation.op) {
    case "recipe.unitConfigure": {
      const { op: _op, ...args } = operation;
      void _op;
      target = configureUnit(document, args);
      break;
    }
    case "recipe.spellConfigure": {
      const { op: _op, ...args } = operation;
      void _op;
      target = configureSpell(document, args);
      break;
    }
    case "recipe.unitCopy": {
      const available = [
        ...records
          .filter(
            (r) =>
              r.engineActive !== false &&
              !(r.layer === "workspace" && r.absolute === workspace.resolveUserPath(targetFile)),
          )
          .flatMap((r) => r.document.objects()),
        ...document.objects(),
      ];
      const { op: _op, ...copyRequest } = operation;
      void _op;
      const copy = unitCopyRecipe(document, available, copyRequest);
      projectilePreloads.push(...copy.preloads);
      target = copy.target;
      break;
    }
    case "recipe.veterancy": {
      const available = [
        ...records
          .filter(
            (r) =>
              r.engineActive !== false &&
              !(r.layer === "workspace" && r.absolute === workspace.resolveUserPath(targetFile)),
          )
          .flatMap((r) => r.document.objects()),
        ...document.objects(),
      ];
      target = veterancyRecipe(document, available, operation);
      break;
    }
    case "recipe.xpSearch": {
      const other = records.find(
        (r) =>
          r.engineActive !== false &&
          r.layer === "workspace" &&
          r.absolute !== workspace.resolveUserPath(targetFile) &&
          r.document
            .objects()
            .some(
              (o) =>
                o.domain === "Game" &&
                o.id === "Dflt" &&
                o.fields.some((f) => f.name === "VeterancySearchRadius"),
            ),
      );
      if (other)
        throw Error(
          "XP_SEARCH_RECIPE_OTHER_CATALOG: edit the existing map-wide radius in " + other.file,
        );
      target = xpSearchRecipe(document, operation);
      break;
    }
    case "recipe.learn": {
      const available = [
        ...records
          .filter(
            (r) =>
              r.engineActive !== false &&
              !(r.layer === "workspace" && r.absolute === workspace.resolveUserPath(targetFile)),
          )
          .flatMap((r) => r.document.objects()),
        ...document.objects(),
      ];
      target = learnRecipe(document, available, operation);
      break;
    }
    case "recipe.instantAbility":
    case "recipe.targetAbility": {
      const available = [...actorRecipeObjects, ...document.objects()];
      for (const [domain, id] of [
        ["Effect", operation.effect],
        ["Button", operation.button],
      ])
        if (!available.some((o) => o.domain === domain && o.id === id))
          throw Error("ABILITY_RECIPE_REFERENCE_MISSING: " + domain + ":" + id);
      // Replace the current target catalog's old parse with the evolving
      // document once. Other active declarations remain genuinely ambiguous.
      const sourceObjects = [
        ...records
          .filter(
            (r) =>
              r.engineActive !== false &&
              !(r.layer === "workspace" && r.absolute === workspace.resolveUserPath(targetFile)),
          )
          .flatMap((r) => r.document.objects()),
        ...document.objects(),
      ];
      const candidates = sourceObjects.filter(
        (o) => o.domain === "Abil" && o.id === (operation.sourceAbility ?? "Stimpack"),
      );
      if (candidates.length !== 1)
        throw Error(
          (operation.op === "recipe.instantAbility" ? "INSTANT" : "TARGET") +
            "_ABILITY_SOURCE_AMBIGUOUS_OR_MISSING: " +
            (operation.sourceAbility ?? "Stimpack") +
            "; mount the target's declared native catalogs and choose one source declaration",
        );
      if (operation.unit && operation.card) {
        const review = reviewCardBinding(sourceObjects, operation.unit, {
          ability: operation.id,
          button: operation.button,
          ...operation.card,
        });
        if (!review.accepted) throw new DataCardBindingError(review);
        cardReviews.push({ operation: index, review: cardReviewSummary(review) });
      }
      target =
        operation.op === "recipe.instantAbility"
          ? instantAbilityRecipe(document, candidates[0], operation)
          : targetAbilityRecipe(document, candidates[0], operation);
      break;
    }
    case "recipe.abilityCharges": {
      const active = [
        ...records
          .filter(
            (r) =>
              r.engineActive !== false &&
              !(r.layer === "workspace" && r.absolute === workspace.resolveUserPath(targetFile)),
          )
          .flatMap((r) => r.document.objects()),
        ...document.objects(),
      ];
      if (active.filter((o) => o.domain === "Abil" && o.id === operation.id).length !== 1)
        throw Error("ABILITY_CHARGES_ACTIVE_IDENTITY_AMBIGUOUS");
      target = abilityChargesRecipe(document, operation);
      break;
    }
    case "recipe.projectileEffect": {
      const active = [
        ...records
          .filter(
            (r) =>
              r.engineActive !== false &&
              !(r.layer === "workspace" && r.absolute === workspace.resolveUserPath(targetFile)),
          )
          .flatMap((r) => r.document.objects()),
        ...document.objects(),
      ];
      const written = projectileEffectRecipe(document, active, operation);
      projectilePreloads.push(...written.preloads);
      target = written.target;
      break;
    }
    case "recipe.unitActor": {
      const available = [...actorRecipeObjects, ...document.objects()];
      for (const [domain, id] of [
        ["Unit", operation.unit],
        ["Model", operation.model],
      ])
        if (!available.some((o) => o.domain === domain && o.id === id))
          throw new Error("ACTOR_RECIPE_REFERENCE_MISSING: " + domain + ":" + id);
      const candidates = actorRecipeObjects.filter(
        (o) =>
          o.domain === "Actor" &&
          o.id === operation.sourceActor &&
          o.parent?.startsWith("GenericUnit") &&
          o.attrs.unitName,
      );
      if (candidates.length !== 1)
        throw new Error("UNIT_ACTOR_SOURCE_AMBIGUOUS_OR_UNSUPPORTED: " + operation.sourceActor);
      target = unitActorRecipe(document, candidates[0], operation);
      break;
    }
    case "recipe.effectModel": {
      const available = [...actorRecipeObjects, ...document.objects()];
      for (const [domain, id] of [
        ["Effect", operation.effect],
        ["Model", operation.model],
        ...(operation.stopEffect ? [["Effect", operation.stopEffect]] : []),
        ...(operation.siteOp ? [["Actor", operation.siteOp]] : []),
      ])
        if (!available.some((o) => o.domain === domain && o.id === id))
          throw new Error("ACTOR_RECIPE_REFERENCE_MISSING: " + domain + ":" + id);
      target = effectModelRecipe(document, operation);
      break;
    }
    case "recipe.weaponBurn": {
      const damageId = `${operation.id}PeriodicDamage`;
      const applyId = `${operation.id}Apply`;
      const setId = `${operation.id}HitSet`;
      const visualId = `${operation.id}Visual`;
      document.createObject("CEffectDamage", damageId, {
        fields: recipeFields(
          ...(operation.editorCategories
            ? [{ name: "EditorCategories", value: operation.editorCategories }]
            : []),
          ...(operation.damageKind ? [{ name: "Kind", value: operation.damageKind }] : []),
          { name: "Amount", value: operation.periodicDamage },
        ),
      });
      document.createObject("CBehaviorBuff", operation.id, {
        fields: recipeFields(
          ...(operation.alignment ? [{ name: "Alignment", value: operation.alignment }] : []),
          { name: "Duration", value: operation.duration },
          { name: "Period", value: operation.period },
          { name: "PeriodicEffect", value: damageId },
          { name: "BuffFlags", index: "RefreshStack", value: true },
          { name: "MaxStackCount", value: 1 },
        ),
      });
      document.createObject("CEffectApplyBehavior", applyId, {
        fields: recipeFields({ name: "Behavior", value: operation.id }),
      });
      document.createObject("CEffectSet", setId, {
        fields: recipeFields(
          { name: "EffectArray", index: 0, value: operation.impactEffect },
          { name: "EffectArray", index: 1, value: applyId },
        ),
      });
      document.createObject("CActorModel", visualId, {
        parent: "ModelAnimationStyleOneShot",
        fields: recipeFields(
          { name: "Model", value: operation.visualModel },
          { name: "Host", attrs: { Subject: "_Unit" } },
          { name: "HostSiteOps", attrs: { Ops: operation.attachSite ?? "SOpAttachHead" } },
          {
            name: "On",
            attrs: { Terms: `Effect.${damageId}.Start; At Target`, Send: "Create" },
          },
        ),
      });
      const carrierSelector = {
        id: operation.carrierEffect,
        ctype: operation.carrierCtype ?? "CEffectCreatePersistent",
      };
      try {
        document.resolve(carrierSelector);
      } catch {
        document.createObject(carrierSelector.ctype, carrierSelector.id);
      }
      document.setField(
        carrierSelector,
        operation.carrierPath ?? "PeriodicEffectArray[0]",
        "value",
        setId,
      );
      target = `CBehaviorBuff:${operation.id}`;
      break;
    }
    case "recipe.unitTextureByVital": {
      const validatorId = `${operation.id}LifeBelow`;
      const monitorId = `${operation.id}Monitor`;
      const healthyIds: string[] = [];
      const damagedIds: string[] = [];
      operation.textures.forEach((texture, textureIndex) => {
        const healthyId = `${operation.id}HealthyTexture${textureIndex}`;
        const damagedId = `${operation.id}DamagedTexture${textureIndex}`;
        healthyIds.push(healthyId);
        damagedIds.push(damagedId);
        document.createObject("CTexture", healthyId, {
          fields: recipeFields(
            { name: "File", value: texture.healthyFile },
            { name: "Slot", value: texture.slot },
          ),
        });
        document.createObject("CTexture", damagedId, {
          fields: recipeFields(
            { name: "File", value: texture.damagedFile },
            { name: "Slot", value: texture.slot },
          ),
        });
      });
      document.createObject("CValidatorUnitCompareVital", validatorId, {
        parent: "CasterLifePercent",
        fields: recipeFields(
          { name: "Compare", value: "LT" },
          { name: "Value", value: operation.threshold },
        ),
      });
      const events = recipeFields(
        { name: "On", attrs: { Terms: `UnitCreation.${operation.unit}`, Send: "Create" } },
        ...healthyIds.map((textureId) => ({
          name: "On",
          attrs: {
            Terms: "StateChange; StateValid Healthy",
            Target: "_Unit",
            Send: `TextureSelectById ${textureId}`,
          },
        })),
        ...damagedIds.map((textureId) => ({
          name: "On",
          attrs: {
            Terms: "StateChange; StateValid Damaged",
            Target: "_Unit",
            Send: `TextureSelectById ${textureId}`,
          },
        })),
        { name: "StateThinkInterval", value: operation.pollInterval ?? 0.5 },
        {
          name: "StateArray",
          attrs: { Name: "Healthy", Terms: `!ValidateUnit ${validatorId}` },
        },
        {
          name: "StateArray",
          attrs: { Name: "Damaged", Terms: `ValidateUnit ${validatorId}` },
        },
      );
      document.createObject("CActorStateMonitor", monitorId, { fields: events });
      target = `CActorStateMonitor:${monitorId}`;
      break;
    }
    default:
      return undefined;
  }
  return { target };
}
