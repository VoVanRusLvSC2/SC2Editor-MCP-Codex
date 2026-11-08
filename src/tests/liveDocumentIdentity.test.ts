import test from "node:test";
import assert from "node:assert/strict";
import { currentDocumentMatches, shortMapCaption } from "../modules/editorLive/documentIdentity.js";
import type { EditorWindow } from "../modules/editorLive/desktop.js";

const archive = "K:/Projects/Arena/delivery/Очень длинное имя карты.SC2Map",
  window: EditorWindow = {
    windowId: "123",
    processId: 456,
    processStart: "789",
    title: "Terrain - [K:/.../delivery/Очень длинное имя карты.SC2Map*] - StarCraft II Editor",
    enabled: true,
    acceptsFiles: true,
  },
  proof = {
    verified: true,
    archive,
    ...window,
    matchingDocuments: 1,
    lockedByProcess: true,
    scope: "map_archive_owner_and_unique_document",
  };

test("short captions require independent exact archive/process/document evidence", async () => {
  assert.equal(shortMapCaption(window, archive), true);
  assert.equal(await currentDocumentMatches({}, window, archive), false);
  assert.equal(
    await currentDocumentMatches({ documentIdentity: async () => proof }, window, archive),
    true,
  );
  for (const patch of [
    { verified: false },
    { archive: archive.replace("Projects", "Other") },
    { windowId: "124" },
    { processId: 457 },
    { processStart: "790" },
    { title: window.title.replace("*]", "]") },
    { matchingDocuments: 2 },
    { lockedByProcess: false },
    { scope: "caption_only" },
  ])
    assert.equal(
      await currentDocumentMatches(
        { documentIdentity: async () => ({ ...proof, ...patch }) },
        window,
        archive,
      ),
      false,
    );
});

test("basename-only, wrong drives/folders, mods and extra ellipses never use the fallback", async () => {
  let calls = 0;
  const desktop = {
    documentIdentity: async () => {
      calls++;
      return proof;
    },
  };
  for (const title of [
    "Terrain - [Очень длинное имя карты.SC2Map] - StarCraft II Editor",
    window.title.replace("K:/", "L:/"),
    window.title.replace("delivery/", "Other/"),
    window.title.replace("delivery/", ".../delivery/"),
  ])
    assert.equal(await currentDocumentMatches(desktop, { ...window, title }, archive), false);
  assert.equal(
    await currentDocumentMatches(
      desktop,
      { ...window, title: window.title.replace(".SC2Map", ".SC2Mod") },
      archive.replace(".SC2Map", ".SC2Mod"),
    ),
    false,
  );
  assert.equal(calls, 0);
});

test("exact and guarded multi-directory captions retain compatibility without a native query", async () => {
  const desktop = {
    documentIdentity: async () => {
      throw Error("unexpected extra query");
    },
  };
  assert.equal(
    await currentDocumentMatches(
      desktop,
      { ...window, title: `Terrain - [${archive}] - StarCraft II Editor` },
      archive,
    ),
    true,
  );
  assert.equal(
    await currentDocumentMatches(
      desktop,
      { ...window, title: window.title.replace("/delivery/", "/Arena/delivery/") },
      archive,
    ),
    true,
  );
});

test("identity inspection errors are preserved, not converted to permission for a write", async () => {
  await assert.rejects(
    currentDocumentMatches(
      {
        documentIdentity: async () => {
          throw Error("native owner query unavailable");
        },
      },
      window,
      archive,
    ),
    /native owner query unavailable/,
  );
});
