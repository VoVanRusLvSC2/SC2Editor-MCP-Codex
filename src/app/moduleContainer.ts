/** Lazy, typed factories. Existing consumers keep a nonoptional service facade. */
export class ModuleContainer<T extends object> {
  private readonly values = new Map<keyof T, unknown>();
  private readonly constructing = new Set<keyof T>();
  private closed = false;
  readonly services: T;

  constructor(factories: { [K in keyof T]: () => T[K] }) {
    this.services = {} as T;
    for (const name of Object.keys(factories) as Array<keyof T>) {
      Object.defineProperty(this.services, name, {
        enumerable: true,
        get: () => {
          if (this.values.has(name)) return this.values.get(name);
          if (this.closed) throw new Error("PROJECT_CLOSED: " + String(name));
          if (this.constructing.has(name))
            throw new Error("MODULE_DEPENDENCY_CYCLE: " + String(name));
          this.constructing.add(name);
          try {
            const value = factories[name]();
            this.values.set(name, value);
            return value;
          } finally {
            this.constructing.delete(name);
          }
        },
      });
    }
  }

  initialized(): string[] {
    return [...this.values.keys()].map(String);
  }
  seal(): void {
    this.closed = true;
  }
}
