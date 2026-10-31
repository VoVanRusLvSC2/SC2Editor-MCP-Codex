import test from "node:test";
import assert from "node:assert/strict";
import { combatSchema, runCombatCheck } from "../modules/testing/combatChecks.js";
import { testManifestSchema, type CheckState } from "../modules/testing/schemas.js";
import type { GameResult } from "../integrations/game/transport.js";

const points = { a: { x: 12, y: 14 }, b: { x: 18, y: 14 } };
const spec = combatSchema.parse({
  id: "duel",
  attacker: { type: "Marine", owner: 1, at: "a" },
  defender: { type: "Marine", owner: 15, at: "b" },
  expected: "defender_dead",
  deathSeconds: { min: 0.8, max: 2 },
  timeout: 3,
});
function fixture(
  options: {
    changedClock?: boolean;
    uncertainOrder?: boolean;
    unavailableClock?: boolean;
    invalidDeath?: boolean;
    confirmedRemovedDeath?: boolean;
    changedDeathStream?: boolean;
    cleanupFailure?: boolean;
    cancel?: boolean;
  } = {},
) {
  let wall = 0,
    ordered = false,
    n = 0;
  const units = new Map<string, any>(),
    calls: Array<{ method: string; args: Record<string, unknown> }> = [],
    records = new Map<string, any>();
  const reply = (value: Record<string, unknown>): GameResult => ({
    content: [],
    structuredContent: {
      status: "ok",
      ...(!options.unavailableClock
        ? {
            session: "owned",
            runtimeEpoch: options.changedClock && wall > 0 ? "other" : "epoch",
            mapLoadSerial: 1,
            gameTime: wall / 1000,
          }
        : {}),
      ...value,
    },
  });
  const hooks = {
    now: () => wall,
    delay: async () => {
      wall += 500;
    },
    pollMs: 1,
    checkCancel: () => {
      if (options.cancel && ordered) throw Error("TEST_CANCEL_REQUESTED");
    },
    body: (r: GameResult) => r.structuredContent as Record<string, any>,
    state: (): CheckState => "passed",
    record: async (name: string, value: unknown) => {
      records.set(name, structuredClone(value));
      return name + ".json";
    },
    call: async (method: string, args: Record<string, unknown>) => {
      calls.push({ method, args });
      if (method === "game.fixture" && args.action === "cleanup") {
        if (!options.cleanupFailure) for (const u of units.values()) u.valid = false;
        return reply({});
      }
      if (method === "game.fixture") {
        const id = String(++n),
          unit = {
            id,
            type: args.type,
            owner: args.owner,
            valid: true,
            alive: true,
            life: 45,
            shields: 0,
            position: { x: args.x, y: args.y },
          };
        units.set(id, unit);
        return reply({ unit: structuredClone(unit) });
      }
      if (method === "game.order") {
        ordered = true;
        if (options.uncertainOrder) throw Error("lost order response");
        return reply({ accepted: true });
      }
      if (method === "game.units.inspect") {
        const unit = structuredClone(units.get(String(args.unit)));
        if (ordered && unit.valid && unit.id === "2") {
          unit.life = Math.max(0, 45 - Math.floor(wall / 500) * 15);
          unit.alive = unit.life > 0;
          if ((options.invalidDeath || options.confirmedRemovedDeath) && !unit.alive)
            unit.valid = false;
        }
        return reply({ unit });
      }
      if (method === "game.events")
        return reply({
          runtimeEpoch: options.changedDeathStream ? "other" : "epoch",
          dropped: false,
          hasMore: false,
          cursor: "end",
          events: options.confirmedRemovedDeath
            ? [{ kind: "unit_died", source: "galaxy", unit: "2", gameTime: wall / 1000 }]
            : [],
        });
      throw Error("Unexpected method " + method);
    },
  };
  return { hooks, calls, records };
}

test("combat observes native-time death brackets, net vital loss, ordered duel and confirmed cleanup", async () => {
  const f = fixture(),
    result = await runCombatCheck(spec, points, f.hooks),
    check = result.checks[0];
  assert.equal(check.status, "passed");
  assert.equal(result.continueSuite, true);
  assert.deepEqual(check.evidence?.metrics, {
    elapsedGameSeconds: 1.5,
    attackerNetVitalLoss: 0,
    defenderNetVitalLoss: 45,
    defenderNetVitalLossPerGameSecond: 30,
    deathBracket: { lastObservedAlive: 1, firstObservedDead: 1.5 },
    attackerAlive: true,
    defenderAlive: false,
  });
  assert.equal(f.calls.filter((c) => c.method === "game.order").length, 2);
  assert.equal(f.records.get("samples")[0].defender.life, 45);
  assert.equal(result.checks.at(-1)?.status, "passed");
});

test("explicit acceptance ranges reject a mismatched fight without treating observation as universal balance", async () => {
  const f = fixture(),
    result = await runCombatCheck({ ...spec, defenderLoss: { min: 0, max: 10 } }, points, f.hooks);
  assert.equal(result.checks[0].status, "failed");
  assert.match(result.checks[0].reason!, /LOSS_OUTSIDE_RANGE/);
  assert.equal(result.continueSuite, false);
});

test("removed corpses require same-stream post-order death evidence and do not invent terminal vitals", async () => {
  const f = fixture({ confirmedRemovedDeath: true });
  const result = await runCombatCheck(spec, points, f.hooks);
  assert.equal(result.checks[0].status, "passed");
  const metrics = result.checks[0].evidence?.metrics as Record<string, unknown>;
  assert.equal(metrics.defenderNetVitalLoss, null);
  assert.equal(metrics.terminalVitals, "unavailable_after_correlated_death");
  const changed = await runCombatCheck(
    spec,
    points,
    fixture({ confirmedRemovedDeath: true, changedDeathStream: true }).hooks,
  );
  assert.equal(changed.checks[0].status, "inconclusive");
  const bounded = await runCombatCheck(
    { ...spec, defenderLoss: { min: 40, max: 50 } },
    points,
    fixture({ confirmedRemovedDeath: true }).hooks,
  );
  assert.equal(bounded.checks[0].status, "inconclusive");
});

test("uncertain order responses never retry and still remove known owned fixtures", async () => {
  const f = fixture({ uncertainOrder: true }),
    result = await runCombatCheck(spec, points, f.hooks);
  assert.equal(result.checks[0].status, "inconclusive");
  assert.equal(result.continueSuite, false);
  assert.equal(f.calls.filter((c) => c.method === "game.order").length, 1);
  assert.equal(result.checks.find((c) => c.id.endsWith(":cleanup"))?.status, "passed");
  assert.equal(result.checks.find((c) => c.id.endsWith(":submission"))?.status, "inconclusive");
});

test("missing or changed native clocks and invalid handles cannot certify death timing", async () => {
  for (const options of [
    { changedClock: true },
    { unavailableClock: true },
    { invalidDeath: true },
  ]) {
    const f = fixture(options),
      result = await runCombatCheck(spec, points, f.hooks);
    assert.equal(result.checks[0].status, "inconclusive");
    assert.equal(result.continueSuite, false);
  }
});

test("capture or cleanup failure cannot retain a passing complete combat case; cancellation cleans up", async () => {
  const f = fixture(),
    failedFrame = await runCombatCheck(spec, points, {
      ...f.hooks,
      capture: async () => {
        throw Error("frame failed");
      },
    });
  assert.equal(failedFrame.checks[0].status, "inconclusive");
  const cleanup = await runCombatCheck(spec, points, fixture({ cleanupFailure: true }).hooks);
  assert.equal(cleanup.continueSuite, false);
  assert.equal(cleanup.checks.at(-1)?.status, "failed");
  const cancelled = fixture({ cancel: true });
  await assert.rejects(runCombatCheck(spec, points, cancelled.hooks), /TEST_CANCEL_REQUESTED/);
  assert.ok(cancelled.calls.some((c) => c.args.action === "cleanup"));
});

test("combat manifests require declared distinct anchors, views, owners and ordered ranges", () => {
  const manifest = { version: 1, map: "Map.SC2Map", game: { points, combats: [spec] } };
  assert.equal(testManifestSchema.safeParse(manifest).success, true);
  assert.equal(
    testManifestSchema.safeParse({
      ...manifest,
      game: { points: { a: points.a }, combats: [spec] },
    }).success,
    false,
  );
  assert.equal(combatSchema.safeParse({ ...spec, attacker: spec.defender }).success, false);
  assert.equal(
    combatSchema.safeParse({ ...spec, deathSeconds: { min: 5, max: 2 } }).success,
    false,
  );
});
