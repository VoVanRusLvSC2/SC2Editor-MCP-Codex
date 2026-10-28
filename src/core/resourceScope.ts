export interface OwnedResource {
  close(): void | Promise<void>;
}

/** Reverse dependency order; one failure must not skip other owned resources. */
export class ResourceScope {
  private readonly resources: Array<{ name: string; resource: OwnedResource }> = [];
  private closing?: Promise<void>;

  own<T extends OwnedResource>(name: string, resource: T): T {
    if (this.closing) throw new Error("RESOURCE_SCOPE_CLOSING");
    this.resources.push({ name, resource });
    return resource;
  }

  close(): Promise<void> {
    return (this.closing ??= this.dispose());
  }

  private async dispose(): Promise<void> {
    const errors: Error[] = [];
    for (const { name, resource } of [...this.resources].reverse()) {
      try {
        await resource.close();
      } catch (cause) {
        errors.push(new Error(`RESOURCE_CLOSE_FAILED: ${name}`, { cause }));
      }
    }
    if (errors.length) throw new AggregateError(errors, "PROJECT_CLOSE_FAILED");
  }
}
