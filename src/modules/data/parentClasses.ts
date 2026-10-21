/** Native catalog class direction, distinct from XML object-id inheritance.
 * Reaper is CActorMissile and inherits the CActorUnit GenericUnitBase template
 * in installed Liberty ActorData. Editor 5.0.17.98310 rejects the reverse:
 * CActorUnit ArenaHero04Actor parent=Reaper (2026-10-20 XMLAlerts).
 * The flattened Data XSD gives both types CBase, so it cannot prove this rule.
 * Other class pairs remain unknown; absence of an observed pair is not failure.
 */
export function parentClassCompatibility(child: string, parent: string): "compatible" | "incompatible" | "unknown" {
  if (child === parent) return "compatible";
  if (child === "CActorMissile" && parent === "CActorUnit") return "compatible";
  if (child === "CActorUnit" && parent === "CActorMissile") return "incompatible";
  return "unknown";
}
