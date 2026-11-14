const keys = [
  "hasMore",
  "cursor",
  "nextCursor",
  "continuation",
  "sourceCoverage",
  "sources",
  "droppedEntries",
  "diagnosticsComplete",
  "responseTruncated",
  "limitations",
  "jobId",
  "sessionId",
  "snapshotId",
  "sceneHash",
  "layer",
  "selectedKey",
  "count",
  "objectKey",
  "type",
  "name",
  "x",
  "y",
  "owner",
  "pendingId",
  "windowId",
  "sourceWindowId",
  "processId",
  "processStart",
  "preparedDirectory",
  "componentDirectory",
  "retryMutation",
  "createdAction",
  "createdEvent",
  "createdCondition",
  "conditionName",
  "conditions",
  "totalConditions",
  "groupPath",
  "parameterPath",
  "parameterContainer",
  "eventName",
  "event",
  "kind",
  "eventIndex",
  "events",
  "totalEvents",
  "section",
  "parameterVerified",
  "parametersVerified",
  "parameterState",
  "actionName",
  "nativeLabel",
  "category",
  "detailFingerprint",
  "parameterFingerprint",
  "parameters",
  "totalParameters",
  "parameterRoot",
  "itemIndex",
  "itemText",
  "parameterIndex",
  "parameter",
  "remainingParameters",
  "unitName",
  "pointName",
  "pointIdentity",
  "unitIdentity",
  "catalogIdVerified",
  "previousValue",
  "actions",
  "totalActions",
  "actionIndex",
  "previousSeconds",
  "seconds",
  "path",
  "referenceSafety",
  "saveAttempted",
  "prepared",
  "savedMap",
  "mapMutation",
  "copiesCreated",
  "reopensMap",
  "nativeModelVerified",
  "nativeLibraryVerified",
  "nativeCatalogVerified",
  "catalogReferenceCount",
  "catalogRevision",
  "existingRootLabelsVerified",
  "player",
  "every",
  "amount",
  "nativeCompilePassed",
  "gameplayVerified",
  "nativeMutationAttempted",
  "internalTestArtifact",
  "runtimeVerified",
  "adopted",
  "triggerRuntime",
  "visualVerified",
  "documentDirty",
  "dirtinessScope",
  "pendingInput",
  "pendingXmlBuffers",
  "dialogPresent",
  "reason",
  "recovery",
  "sourcePublished",
  "newWorkingMapCopies",
  "reopensSamePath",
  "resetsNativeUndo",
  "editorChanged",
  "sha256",
  "size",
  "mtimeMs",
  "savedUiBufferError",
  "ready",
  "state",
  "phase",
  "index",
  "outcome",
  "nativeProfile",
  "organization",
  "modules",
  "zone",
  "profile",
  "recipe",
  "seed",
  "replaced",
  "saveFile",
  "entryFile",
  "activation",
  "logicDefault",
  "systems",
  "folders",
  "created",
  "moved",
  "issues",
  "checks",
  "manifest",
  "textures",
  "style",
  "offset",
  "nextOffset",
  "countsAreQuotas",
  "evidence",
  "section",
  "ok",
  "completed",
  "failed",
  "steps",
  "scope",
  "mode",
  "language",
  "format",
  "modes",
  "examples",
  "logicDefault",
  "sections",
  "limits",
  "total",
  "nextOffset",
  "version",
  "apiVersion",
  "pagination",
  "coverage",
  "coverageIssueCount",
  "backend",
  "cacheHit",
  "elapsedMilliseconds",
  "complete",
  "models",
  "modelFacets",
  "cliffPieces",
  "rampPieces",
  "terrainTextures",
  "counts",
  "catalogFootprints",
  "engineValidated",
  "inputRevision",
  "status",
  "accepted",
  "valid",
  "planId",
  "transactionId",
  "reportId",
  "reportFile",
  "compilerErrors",
  "reportBytes",
  "diagnosticsTotal",
  "errors",
  "warnings",
  "filesTotal",
  "appliedTotal",
  "id",
  "file",
  "directory",
  "archive",
  "pngFile",
  "htmlFile",
  "imageFile",
  "comparisonFile",
  "manifestFile",
  "topPngFile",
  "images",
  "dimensions",
  "pivot",
  "bottom",
  "scales",
  "connectors",
  "reservedLocal",
  "reservedWorld",
  "clearance",
  "prefab",
  "variantCount",
  "frameCount",
  "issueCount",
  "dialogs",
  "dialogItems",
  "error",
  "sourceSha256",
  "sourceBytes",
  "dryRun",
  "staged",
  "saved",
  "unchanged",
  "nativePlayback",
];
function compactArtifactPaths(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  const files = (value as Record<string, unknown>).files;
  if (!files || typeof files !== "object" || Array.isArray(files)) return;
  const paths: Record<string, string> = {};
  for (const key of ["html", "png"]) {
    const file = Object.hasOwn(files, key) ? (files as Record<string, unknown>)[key] : undefined;
    if (
      typeof file === "string" &&
      file.length <= 4096 &&
      !/^(?:data|blob):/i.test(file.trim()) &&
      (key === "png" ? /\.png$/i : /\.html?$/i).test(file)
    )
      paths[key] = file;
  }
  return Object.keys(paths).length ? paths : undefined;
}
export function compactResult(value: unknown) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const v = value as Record<string, unknown>;
    const animationReviews = Array.isArray(v.applied)
      ? v.applied.filter((a) => a && typeof a === "object" && a.animation)
      : [];
    if (
      v.cardReview ||
      v.cardReviews ||
      v.bindingAccepted !== undefined ||
      animationReviews.length ||
      Array.isArray(v.applied)
    )
      return {
        ...(compactGeneralResult(v) as Record<string, unknown>),
        ...(Array.isArray(v.applied) && v.appliedTotal === undefined
          ? { appliedTotal: v.applied.length }
          : {}),
        ...Object.fromEntries(
          [
            "bindingAccepted",
            "layoutResolved",
            "bindingCount",
            "conflictCount",
            "warningCount",
            "unresolvedCount",
            "conflicts",
            "unresolved",
            "nativePresentation",
            "cardReviewCount",
          ]
            .filter((k) => v[k] !== undefined)
            .map((k) => [k, v[k]]),
        ),
        ...(v.cardReview ? { cardReview: v.cardReview } : {}),
        ...(Array.isArray(v.cardReviews)
          ? {
              cardReviews: v.cardReviews.slice(0, 4),
              cardReviewsTruncated: v.cardReviews.length > 4,
            }
          : {}),
        ...(animationReviews.length
          ? {
              animationReviewCount: animationReviews.length,
              animationReviews: animationReviews
                .slice(0, 4)
                .map((a) => ({ operation: a.index, ...a.animation })),
              animationReviewsTruncated: animationReviews.length > 4,
            }
          : {}),
      };
  }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const v = value as Record<string, unknown>;
    if (typeof v.id === "string" && v.id.startsWith("terrain_") && Array.isArray(v.files)) {
      const changed = v.files.filter(
        (f) =>
          f && typeof f === "object" && typeof f.changedBytes === "number" && f.changedBytes > 0,
      );
      const issues = Array.isArray(v.issues) ? v.issues : [];
      return {
        id: v.id,
        directory: v.directory,
        valid: v.valid,
        changedVertices: v.changedVertices,
        changedTexturePixels: v.changedTexturePixels,
        changedFiles: changed.length,
        filesTotal: v.files.length,
        files: changed
          .slice(0, 8)
          .map((f) => ({ file: f.file, changedBytes: f.changedBytes, afterBytes: f.afterBytes })),
        issueCount: issues.length,
        issues: issues.slice(0, 8),
        ...(v.ownership ? { ownership: v.ownership } : {}),
        ...(v.atomicComponents ? { atomicComponents: v.atomicComponents } : {}),
        sourceIdentity:
          "Retained by the guarded plan; full hashes available from the detailed tool",
      };
    }
    if (
      typeof v.planId === "string" &&
      v.planId.startsWith("modkit_terrain_") &&
      Array.isArray(v.operations)
    ) {
      const operations = v.operations.slice(0, 8).map((o) => {
        if (!o || typeof o !== "object") return o;
        const report = Object.fromEntries(
          [
            "op",
            "changed",
            "changedVertices",
            "changedCells",
            "updatedSyncVertices",
            "extraHalfWidth",
            "engineValidated",
          ]
            .filter((k) => o[k] !== undefined)
            .map((k) => [k, o[k]]),
        );
        if (o.adjoining && typeof o.adjoining === "object")
          report.adjoining = Object.fromEntries(
            ["mode", "highCells", "checkedFlatCells", "preparedStrokes", "envelope", "scope"]
              .filter((k) => o.adjoining[k] !== undefined)
              .map((k) => [k, o.adjoining[k]]),
          );
        return report;
      });
      return {
        ...(compactGeneralResult(v) as Record<string, unknown>),
        operationsTotal: v.operations.length,
        operations,
        operationsTruncated: v.operations.length > 8,
      };
    }
    if (v.stopped === true) return { stopped: true };
    if (
      typeof v.state === "string" &&
      ["check", "capture", "cameras", "diagnostics"].includes(String(v.operation))
    )
      return Object.fromEntries(
        [
          "id",
          "state",
          "operation",
          "phase",
          "createdAt",
          "startedAt",
          "finishedAt",
          "deadlineExceeded",
          "report",
          "error",
          "result",
        ]
          .filter((k) => v[k] !== undefined)
          .map((k) => [k, v[k]]),
      );
    if (v.transport === "retained stdio MCP") return v;
  }
  const summary = compactGeneralResult(value),
    files = compactArtifactPaths(value);
  return files && summary && typeof summary === "object" && !Array.isArray(summary)
    ? { ...summary, files }
    : summary;
}
function compactGeneralResult(value: unknown) {
  if (!value || typeof value !== "object") return value;
  if (Array.isArray(value))
    return {
      total: value.length,
      items: value.slice(0, 8).map((item) => {
        const raw = JSON.stringify(item);
        return raw.length <= 2000 ? item : { truncated: true, preview: raw.slice(0, 1000) };
      }),
    };
  const v = value as Record<string, unknown>,
    out: Record<string, unknown> = {};
  if (typeof v.name === "string" && /^sc2_[a-z0-9_]+$/.test(v.name) && v.schemaTruncated === true)
    return { name: v.name, schemaTruncated: true, schemaBytes: v.schemaBytes, reason: v.reason };
  if (
    typeof v.name === "string" &&
    /^sc2_[a-z0-9_]+$/.test(v.name) &&
    v.inputSchema &&
    typeof v.inputSchema === "object" &&
    !Array.isArray(v.inputSchema)
  ) {
    const schemaBytes = Buffer.byteLength(JSON.stringify(v.inputSchema));
    return {
      name: v.name,
      ...(typeof v.description === "string" && { description: v.description.slice(0, 2000) }),
      ...(schemaBytes <= 65536
        ? { inputSchema: v.inputSchema }
        : {
            schemaTruncated: true,
            schemaBytes,
            reason: "Schema exceeds compact response limit; call editor.tools directly.",
          }),
    };
  }
  for (const key of keys) if (v[key] !== undefined) out[key] = v[key];
  if (v.nativeCatalogVerified === true && Array.isArray(v.references))
    out.references = v.references.slice(0, 32).map((value) => {
      const r = value as Record<string, unknown>;
      return { domain: r.domain, id: r.id, source: r.source };
    });
  if (typeof v.value === "number" && Number.isFinite(v.value)) out.value = v.value;
  if (v.module === "editor-live" || v.module === "live") {
    const current =
      v.module === "live" &&
      v.currentDocument &&
      typeof v.currentDocument === "object" &&
      !Array.isArray(v.currentDocument)
        ? (v.currentDocument as Record<string, unknown>)
        : v;
    for (const key of [
      "module",
      "directInMemoryMutation",
      "capabilityScope",
      "unsupportedScope",
      "fallback",
    ])
      if (current[key] !== undefined) out[key] = current[key];
    if (Array.isArray(current.unsupported)) out.unsupported = current.unsupported.slice(0, 12);
    if (current.refresh && typeof current.refresh === "object" && !Array.isArray(current.refresh)) {
      const refresh = current.refresh as Record<string, unknown>;
      out.refresh = Object.fromEntries(
        ["backend", "tools", "scope", "reopensSamePath", "resetsNativeUndo", "requires", "evidence"]
          .filter((key) => refresh[key] !== undefined)
          .map((key) => [key, refresh[key]]),
      );
    }
  }
  if (v.status === "preparation_failed" && v.result && typeof v.result === "object") {
    const nested = v.result as Record<string, unknown>;
    const failedStep = Array.isArray(nested.steps)
      ? nested.steps.find(
          (step: unknown) =>
            step && typeof step === "object" && (step as Record<string, unknown>).ok === false,
        )
      : undefined;
    const step = failedStep as Record<string, unknown> | undefined;
    out.preparation = {
      ...(typeof nested.failed === "string" && { failed: nested.failed.slice(0, 128) }),
      ...(typeof nested.completed === "number" && { completed: nested.completed }),
      ...(typeof step?.tool === "string" && { tool: step.tool.slice(0, 128) }),
      ...(typeof step?.error === "string" && { error: step.error.slice(0, 1000) }),
    };
  }
  for (const [key, fields] of [
    [
      "efficiency",
      [
        "toolCalls",
        "authoredOperations",
        "operations",
        "nativeMutations",
        "files",
        "includesValidation",
      ],
    ],
    [
      "authoring",
      [
        "accepted",
        "status",
        "completeness",
        "executionPolicy",
        "staticValidation",
        "editor",
        "runtime",
        "scope",
      ],
    ],
    [
      "validation",
      ["valid", "errors", "warnings", "levels", "validationScope", "semanticCoverage"],
    ],
    [
      "save",
      ["status", "saved", "sha256", "error", "savedUiBufferError", "retryMutation", "recovery"],
    ],
    [
      "document",
      [
        "archive",
        "sha256",
        "windowId",
        "processId",
        "processStart",
        "documentDirty",
        "pendingInput",
        "pendingXmlBuffers",
        "dialogPresent",
      ],
    ],
    ["recoveryContext", ["token", "windowId", "mode", "componentFile"]],
    ["tree", ["id", "count", "total", "offset", "fingerprint", "truncated"]],
  ] as const) {
    const item = v[key];
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const source = item as Record<string, unknown>;
    out[key] = Object.fromEntries(
      fields.filter((k) => source[k] !== undefined).map((k) => [k, source[k]]),
    );
    if (key === "tree" && Array.isArray(source.items)) {
      (out[key] as Record<string, unknown>).items = source.items.slice(0, 128).map((row) => {
        if (!row || typeof row !== "object" || Array.isArray(row)) return {};
        const node = row as Record<string, unknown>;
        return Object.fromEntries(
          ["handle", "parent", "depth", "text"]
            .filter((k) => node[k] !== undefined)
            .map((k) => [k, node[k]]),
        );
      });
    }
    if (Array.isArray(source.diagnostics)) {
      const receipt = out[key] as Record<string, unknown>;
      receipt.diagnosticsTotal = source.diagnosticsTotal ?? source.diagnostics.length;
      receipt.diagnostics = source.diagnostics.slice(0, 4).map((d) => {
        const raw = JSON.stringify(d);
        return raw.length <= 4000 ? d : { truncated: true, preview: raw.slice(0, 1000) };
      });
      receipt.diagnosticsTruncated = Number(receipt.diagnosticsTotal) > 4;
      if (source.nextOffset !== undefined) receipt.nextOffset = source.nextOffset;
    }
  }
  for (const key of ["plan", "transaction"])
    if (v[key] && typeof v[key] === "object") out[key] = compactResult(v[key]);
  if (Array.isArray(v.changed) && v.changed.every((item) => typeof item === "string")) {
    out.changed = v.changed.slice(0, 16).map((item: string) => item.slice(0, 1024));
    out.changedTotal = v.changed.length;
    if (v.changed.length > 16) out.changedTruncated = true;
  }
  if (Array.isArray(v.diagnostics))
    out.diagnostics = v.diagnostics.slice(0, 8).map((item) => {
      const text = JSON.stringify(item);
      return text.length <= 4000 ? item : { truncated: true, preview: text.slice(0, 1000) };
    });
  if (Array.isArray(v.files)) {
    out.filesTotal = v.files.length;
    out.files = v.files
      .slice(0, 8)
      .map((item) =>
        typeof item === "string"
          ? item
          : item && typeof item === "object"
            ? Object.fromEntries(
                Object.entries(item).filter(
                  ([key, val]) =>
                    ["file", "path", "name", "action", "sha256", "bytes", "changed"].includes(
                      key,
                    ) && typeof val !== "object",
                ),
              )
            : item,
      );
    if (v.files.length > 8) out.filesTruncated = true;
  }
  if (Array.isArray(v.variants)) out.variants = v.variants.slice(0, 8).map(compactResult);
  if (Array.isArray(v.items))
    out.items = v.items.slice(0, 8).map((item) => {
      const raw = JSON.stringify(item);
      return raw.length <= 2000 ? item : { truncated: true, preview: raw.slice(0, 1000) };
    });
  if (Array.isArray(v.players)) out.players = v.players.slice(0, 16);
  if (Array.isArray(v.objects))
    out.objects = v.objects.slice(0, 8).map((item) => {
      const raw = JSON.stringify(item);
      return raw.length <= 3000 ? item : { truncated: true, preview: raw.slice(0, 1000) };
    });
  if (Array.isArray(v.items) && v.items.length > 8 && typeof v.offset === "number") {
    out.nextOffset = v.offset + 8;
    out.responseTruncated = true;
  }
  if (Array.isArray(v.objects) && v.objects.length > 8 && typeof v.offset === "number") {
    out.nextOffset = v.offset + 8;
    out.responseTruncated = true;
  }
  if (typeof v.objects === "number") out.objects = v.objects;
  if (!Object.keys(out).length) out.resultAvailable = true;
  return out;
}
