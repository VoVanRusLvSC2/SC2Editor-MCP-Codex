/** Exact-content identities are supplied by verified readers. Cached values are
 * cloned on both sides; one consumer cannot alter another consumer's metadata. */
export class PreparedValueCache<T> {
  private readonly entries = new Map<string, { value: T; weight: number }>();
  private weight = 0;
  constructor(
    readonly maxEntries = 16,
    readonly maxWeight = 1024 * 1024,
  ) {
    if (
      !Number.isSafeInteger(maxEntries) ||
      maxEntries < 0 ||
      !Number.isSafeInteger(maxWeight) ||
      maxWeight < 0
    )
      throw Error("PREPARED_VALUE_LIMIT_INVALID");
  }

  get(key: string): T | undefined {
    const entry = this.entries.get(key);
    if (!entry) return;
    this.entries.delete(key);
    this.entries.set(key, entry);
    return structuredClone(entry.value);
  }

  set(key: string, value: T, weight: number): void {
    if (!Number.isSafeInteger(weight) || weight < 0) throw Error("PREPARED_VALUE_WEIGHT_INVALID");
    const previous = this.entries.get(key);
    if (previous) {
      this.weight -= previous.weight;
      this.entries.delete(key);
    }
    if (weight > this.maxWeight || this.maxEntries <= 0) return;
    while (
      this.entries.size &&
      (this.entries.size >= this.maxEntries || this.weight + weight > this.maxWeight)
    ) {
      const first = this.entries.keys().next().value!;
      this.weight -= this.entries.get(first)!.weight;
      this.entries.delete(first);
    }
    this.entries.set(key, { value: structuredClone(value), weight });
    this.weight += weight;
  }

  stats() {
    return {
      entries: this.entries.size,
      weight: this.weight,
      maxEntries: this.maxEntries,
      maxWeight: this.maxWeight,
    };
  }
}
