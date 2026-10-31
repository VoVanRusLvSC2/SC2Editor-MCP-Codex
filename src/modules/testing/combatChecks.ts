import * as z from "zod/v4";
import type { GameResult } from "../../integrations/game/transport.js";
import type { TestCheck, CheckState } from "./schemas.js";
import { MovementClock } from "./movementClock.js";

const name = z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,63}$/);
const participant = z
  .object({ type: z.string().min(1).max(128), owner: z.number().int().min(0).max(15), at: name })
  .strict();
const range = z
  .object({ min: z.number().nonnegative(), max: z.number().nonnegative() })
  .strict()
  .refine((v) => v.min <= v.max, "Range reversed");
export const combatSchema = z
  .object({
    id: name,
    attacker: participant,
    defender: participant,
    counterattack: z.boolean().default(true),
    timeout: z.number().int().min(1).max(60).default(20),
    required: z.boolean().default(true),
    expected: z
      .enum(["defender_dead", "attacker_dead", "both_alive", "observe"])
      .default("observe"),
    duration: z.number().min(0.25).max(60).default(5),
    defenderLoss: range.optional(),
    attackerLoss: range.optional(),
    deathSeconds: range.optional(),
    viewId: name.optional(),
  })
  .strict()
  .superRefine((v, c) => {
    if (v.attacker.owner === v.defender.owner)
      c.addIssue({ code: "custom", message: "Combat participants require distinct owners" });
    if (v.attacker.at === v.defender.at)
      c.addIssue({ code: "custom", message: "Combat anchors must differ" });
    if (["observe", "both_alive"].includes(v.expected) && v.duration > v.timeout)
      c.addIssue({ code: "custom", message: "Combat duration exceeds wall timeout" });
    if (v.deathSeconds && !["attacker_dead", "defender_dead"].includes(v.expected))
      c.addIssue({ code: "custom", message: "Death range requires an explicit expected death" });
  });
export type CombatSpec = z.infer<typeof combatSchema>;
type Point = { x: number; y: number };
interface Hooks {
  call: (method: string, args: Record<string, unknown>) => Promise<GameResult>;
  body: (result: GameResult) => Record<string, any>;
  state: (result: GameResult) => CheckState;
  record: (name: string, value: unknown) => Promise<string>;
  checkCancel: () => void;
  capture?: () => Promise<TestCheck>;
  pollMs?: number;
  now?: () => number;
  delay?: (ms: number) => Promise<void>;
}
interface Readback {
  id: string;
  valid: boolean;
  alive: boolean;
  life: number;
  shields: number;
  type: string;
  owner: number;
  position: Point;
  vitalsUnavailableAfterDeath?: boolean;
  deathEvent?: Record<string, unknown>;
}
class CombatUnconfirmed extends Error {}
const total = (unit: Readback) => unit.life + unit.shields;

/** Ordinary native attacks, same-response clocks and sampled vital loss. Not a balance oracle. */
export async function runCombatCheck(spec: CombatSpec, points: Record<string, Point>, h: Hooks) {
  const args = combatSchema.parse(spec),
    now = h.now ?? Date.now,
    pause = h.delay ?? ((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms))),
    clock = new MovementClock(),
    checks: TestCheck[] = [],
    units: string[] = [],
    samples: Array<{ time: number; attacker: Readback; defender: Readback }> = [];
  let status: CheckState = "inconclusive",
    reason: string | undefined,
    mutationUncertain = false,
    attempted = false,
    cancellation: unknown,
    cancelled = false,
    orderTime: number | undefined,
    lastAlive: number | undefined,
    firstDead: number | undefined,
    latestNativeTime: number | undefined;
  const lastKnown: Array<Readback | undefined> = [];
  let orderIdentity: { session: string; runtimeEpoch: string; mapLoadSerial: number } | undefined;
  const confirmRemovedDeath = async (side: 0 | 1, body: Record<string, any>) => {
    if (
      !lastKnown[side] ||
      orderTime === undefined ||
      !orderIdentity ||
      !Number.isFinite(body.gameTime)
    )
      return;
    let cursor: string | undefined;
    for (let page = 0; page < 8; page++) {
      const response = await h.call("game.events", cursor ? { cursor } : {}),
        events = h.body(response);
      await h.record("death_events_" + side + "_" + page, response);
      if (
        h.state(response) !== "passed" ||
        events.dropped !== false ||
        !Array.isArray(events.events) ||
        ["session", "runtimeEpoch", "mapLoadSerial"].some(
          (key) => events[key] !== orderIdentity![key as keyof typeof orderIdentity],
        )
      )
        return;
      const event = events.events.find(
        (e: Record<string, any>) =>
          e.kind === "unit_died" &&
          e.source === "galaxy" &&
          e.unit === units[side] &&
          Number.isFinite(e.gameTime) &&
          e.gameTime >= orderTime! &&
          e.gameTime <= body.gameTime,
      );
      if (event)
        return {
          ...lastKnown[side]!,
          valid: false,
          alive: false,
          vitalsUnavailableAfterDeath: true,
          deathEvent: event,
        };
      if (!events.hasMore || typeof events.cursor !== "string" || events.cursor === cursor) return;
      cursor = events.cursor;
    }
  };
  const cancel = () => {
    try {
      h.checkCancel();
    } catch (error) {
      cancelled = true;
      cancellation = error;
      throw error;
    }
  };
  const read = async (side: 0 | 1, phase: "initial" | "sample"): Promise<Readback> => {
    cancel();
    const started = now(),
      result = await h.call("game.units.inspect", { unit: units[side] }),
      body = h.body(result);
    clock.observe(body, phase, started, now());
    latestNativeTime = body.gameTime;
    const unit = body.unit,
      participant = side ? args.defender : args.attacker;
    if (h.state(result) === "passed" && unit?.valid === false && phase === "sample") {
      await h.record("removed_readback_" + side, result);
      const confirmed = await confirmRemovedDeath(side, body);
      if (confirmed) return confirmed;
    }
    if (
      h.state(result) !== "passed" ||
      !unit ||
      String(unit.id) !== units[side] ||
      typeof unit.valid !== "boolean" ||
      typeof unit.alive !== "boolean"
    )
      throw new CombatUnconfirmed("COMBAT_READBACK_UNCONFIRMED");
    // A dead handle can remain valid. Invalid handles without confirmed death are not deaths.
    if (
      unit.valid !== true ||
      unit.type !== participant.type ||
      unit.owner !== participant.owner ||
      ![unit.life, unit.shields, unit.position?.x, unit.position?.y].every(Number.isFinite) ||
      unit.life < 0 ||
      unit.shields < 0
    )
      throw new CombatUnconfirmed("COMBAT_IDENTITY_OR_VITALS_UNCONFIRMED");
    lastKnown[side] = structuredClone(unit);
    return structuredClone(unit);
  };
  const sample = async (phase: "initial" | "sample") => {
    const attacker = await read(0, phase),
      defender = await read(1, phase),
      summary = clock.summary();
    if (summary.quality !== "verified" || clock.invalid)
      throw new CombatUnconfirmed("COMBAT_NATIVE_CLOCK_UNCONFIRMED");
    // The latest inspect's game time is read from that exact response by MovementClock.
    const time = orderTime === undefined ? 0 : latestNativeTime! - orderTime;
    samples.push({ time, attacker, defender });
    return samples.at(-1)!;
  };
  const order = async (side: 0 | 1) => {
    cancel();
    mutationUncertain = true;
    const started = now(),
      response = await h.call("game.order", {
        unit: units[side],
        action: "attack",
        target_unit: units[1 - side],
      }),
      body = h.body(response),
      stamp = clock.observe(body, "order", started, now());
    await h.record("order_" + side, response);
    if (h.state(response) !== "passed" || body.accepted !== true || !stamp.native)
      throw new CombatUnconfirmed("COMBAT_ORDER_UNCONFIRMED");
    mutationUncertain = false;
    orderTime ??= stamp.native.gameTime;
    orderIdentity ??= stamp.native;
  };
  try {
    for (const participant of [args.attacker, args.defender]) {
      cancel();
      const at = points[participant.at];
      if (!at) throw Error("COMBAT_POINT_MISSING");
      attempted = true;
      mutationUncertain = true;
      const result = await h.call("game.fixture", {
        type: participant.type,
        owner: participant.owner,
        ...at,
      });
      await h.record("fixture_" + units.length, result);
      const id = h.body(result).unit?.id;
      if (h.state(result) !== "passed" || typeof id !== "string" || !id || units.includes(id))
        throw new CombatUnconfirmed("COMBAT_FIXTURE_UNCONFIRMED");
      units.push(id);
      mutationUncertain = false;
    }
    const initial = await sample("initial");
    for (const [side, participant] of [args.attacker, args.defender].entries()) {
      const unit = side ? initial.defender : initial.attacker,
        anchor = points[participant.at];
      if (!unit.alive || Math.hypot(unit.position.x - anchor.x, unit.position.y - anchor.y) > 0.75)
        throw new CombatUnconfirmed("COMBAT_INITIAL_PLACEMENT_UNCONFIRMED");
    }
    await order(0);
    if (args.counterattack) await order(1);
    const deadline = now() + args.timeout * 1000;
    do {
      const current = await sample("sample");
      const expectedDead = args.expected === "attacker_dead" ? current.attacker : current.defender;
      if (expectedDead.alive) lastAlive = current.time;
      else firstDead ??= current.time;
      if (now() > deadline) {
        reason = "COMBAT_WALL_DEADLINE_EXCEEDED";
        break;
      }
      const isDeath = ["attacker_dead", "defender_dead"].includes(args.expected),
        complete = isDeath ? !expectedDead.alive : current.time >= args.duration;
      if (
        isDeath &&
        (args.expected === "defender_dead" ? !current.attacker.alive : !current.defender.alive) &&
        expectedDead.alive
      ) {
        status = "failed";
        reason = "COMBAT_OTHER_PARTICIPANT_DIED_FIRST";
        break;
      }
      if (complete) {
        status =
          args.expected === "both_alive" && (!current.attacker.alive || !current.defender.alive)
            ? "failed"
            : "passed";
        if (status === "failed") reason = "COMBAT_SURVIVAL_EXPECTATION_FAILED";
        for (const [side, bounds] of [
          ["attacker", args.attackerLoss],
          ["defender", args.defenderLoss],
        ] as const) {
          const loss = total(initial[side]) - total(current[side]);
          if (bounds && current[side].vitalsUnavailableAfterDeath) {
            status = "inconclusive";
            reason = "COMBAT_TERMINAL_VITALS_UNAVAILABLE: " + side;
          } else if (bounds && (loss < bounds.min || loss > bounds.max)) {
            status = "failed";
            reason = "COMBAT_VITAL_LOSS_OUTSIDE_RANGE: " + side;
          }
        }
        if (
          args.deathSeconds &&
          (lastAlive === undefined ||
            firstDead === undefined ||
            lastAlive < args.deathSeconds.min ||
            firstDead > args.deathSeconds.max)
        ) {
          status = "failed";
          reason = "COMBAT_DEATH_BRACKET_OUTSIDE_RANGE";
        }
        break;
      }
      await pause(h.pollMs ?? 250);
    } while (now() <= deadline && samples.length < 256);
    reason ??=
      status === "inconclusive"
        ? "COMBAT_OBSERVATION_BOUND: nondeath is not proof of invulnerability"
        : undefined;
    if (h.capture) checks.push(await h.capture());
  } catch (error) {
    status = "inconclusive";
    if (!cancelled)
      reason =
        error instanceof CombatUnconfirmed
          ? error.message
          : "COMBAT_OPERATION_UNCONFIRMED: inspect private evidence";
    await h.record("failure", { error: String(error) }).catch(() => undefined);
  } finally {
    const start = samples[0],
      end = samples.at(-1),
      elapsed = end?.time ?? 0;
    let report: string | undefined;
    try {
      report = await h.record("samples", samples);
    } catch {
      status = "failed";
      reason = "COMBAT_EVIDENCE_NOT_SAVED";
    }
    const metrics =
      start && end
        ? {
            elapsedGameSeconds: elapsed,
            attackerNetVitalLoss: end.attacker.vitalsUnavailableAfterDeath
              ? null
              : total(start.attacker) - total(end.attacker),
            defenderNetVitalLoss: end.defender.vitalsUnavailableAfterDeath
              ? null
              : total(start.defender) - total(end.defender),
            defenderNetVitalLossPerGameSecond:
              elapsed > 0 && !end.defender.vitalsUnavailableAfterDeath
                ? (total(start.defender) - total(end.defender)) / elapsed
                : null,
            ...(end.attacker.vitalsUnavailableAfterDeath || end.defender.vitalsUnavailableAfterDeath
              ? {
                  terminalVitals: "unavailable_after_correlated_death",
                  deathEvidence:
                    "same-stream post-order unit_died; carried values are last-known, not terminal",
                }
              : {}),
            deathBracket:
              firstDead === undefined
                ? null
                : { lastObservedAlive: lastAlive ?? 0, firstObservedDead: firstDead },
            attackerAlive: end.attacker.alive,
            defenderAlive: end.defender.alive,
          }
        : null;
    checks.unshift({
      id: "combat:" + args.id,
      status,
      required: args.required,
      reason,
      evidence: {
        metrics,
        sampleCount: samples.length,
        report,
        nativeClock: clock.summary(),
        firstOrderGameTime: orderTime,
        scope:
          "Controlled ordinary attack orders and sampled life+shield loss, including any regeneration/healing/interference. Sequential reads; sampled death bracket, not exact kill time or isolated damage attribution. Automatic target acquisition remains native; counterattack=false omits only the explicit defender order. No universal balance or visual certification.",
      },
    });
    if (attempted) {
      let removed: boolean;
      try {
        const cleanup = await h.call("game.fixture", { action: "cleanup" });
        await h.record("cleanup", cleanup);
        removed = h.state(cleanup) === "passed";
        for (const unit of units) {
          const result = await h.call("game.units.inspect", { unit });
          await h.record("cleanup_" + units.indexOf(unit), result);
          removed = removed && h.state(result) === "passed" && h.body(result).unit?.valid === false;
        }
      } catch {
        removed = false;
      }
      checks.push({
        id: "combat:" + args.id + ":cleanup",
        status: removed ? "passed" : "failed",
        required: true,
      });
    }
    if (mutationUncertain)
      checks.push({
        id: "combat:" + args.id + ":submission",
        status: "inconclusive",
        required: true,
        reason: "A mutation response was unconfirmed; no retry or later combat case is permitted",
      });
  }
  if (cancelled) throw cancellation;
  return {
    checks,
    continueSuite:
      !mutationUncertain &&
      checks.every((c) => c.status === "passed" || (!c.required && c.status !== "failed")),
  };
}
