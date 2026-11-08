import test from "node:test";
import assert from "node:assert/strict";
import {
  createTriggerLibrary,
  triggerLibrarySignature,
} from "../modules/editorLive/triggerLibrary.js";

const source =
  '<TriggerData><Root><Item Type="Category" Id="00000001"/></Root><Element Type="Category" Id="00000001"><Identifier>MAIN</Identifier><Item Type="Trigger" Id="00000002"/></Element><Element Type="Trigger" Id="00000002"><Identifier>Start</Identifier><Event Type="FunctionCall" Id="00000003"/></Element><Element Type="FunctionCall" Id="00000003"><FunctionDef Type="FunctionDef" Library="Ntve" Id="00000120"/></Element></TriggerData>';
test("native library transfer embeds exact names and retains the GUI reference graph", () => {
  const library = createTriggerLibrary(
    source,
    "Category/Name/00000001=Main & setup\nTrigger/Name/00000002=Initialize\n",
    "Live <system>",
  );
  assert.match(library, /<Name>Live &lt;system&gt;<\/Name>/);
  assert.match(library, /<Name>Main &amp; setup<\/Name>/);
  assert.match(library, /<Name>Initialize<\/Name>/);
  assert.match(library, /Library="Ntve" Id="00000120"/);
  assert.equal(
    triggerLibrarySignature(library),
    triggerLibrarySignature(
      library.replaceAll("/><", "/>\r\n <").replaceAll("</Element><", "</Element>\r\n <"),
    ),
  );
  assert.notEqual(
    triggerLibrarySignature(library),
    triggerLibrarySignature(library.replace('Id="00000120"', 'Id="00000121"')),
  );
});
test("unsupported library scope, scripts and localization refuse rather than dropping content", () => {
  for (const graph of [
    source.replace('Library="Ntve"', 'Library="User"'),
    source.replace("<Root>", '<Library Id="Own"/><Root>'),
    source.replace("<Root>", "<ScriptCode>call();</ScriptCode><Root>"),
  ])
    assert.throws(() => createTriggerLibrary(graph, "", "System"), /SELF_CONTAINED_GUI_REQUIRED/);
  assert.throws(
    () => createTriggerLibrary(source, "Param/Value/00000001=Hello", "System"),
    /LOCALIZATION_UNSUPPORTED/,
  );
  assert.throws(
    () => createTriggerLibrary(source, "Trigger/Name/00000099=missing", "System"),
    /ORPHAN_LOCALIZATION/,
  );
});
test("native definition/metadata order is harmless while parameter order and literal whitespace stay significant", () => {
  const prefix = "<TriggerData><Name>System</Name><Root/>",
    suffix = "</TriggerData>";
  const action =
    '<Element Type="FunctionCall" Id="00000001"><Name></Name><Parameter Type="Param" Id="00000002"/><Parameter Type="Param" Id="00000003"/></Element>';
  const param =
    '<Element Type="Param" Id="00000002"><Name></Name><ValueType Type="string"/><Value> a </Value></Element>';
  const native = param.replace(
    '<ValueType Type="string"/><Value> a </Value>',
    '<Value> a </Value><ValueType Type="string"/>',
  );
  assert.equal(
    triggerLibrarySignature(prefix + action + param + suffix),
    triggerLibrarySignature(prefix + native + action + suffix),
  );
  assert.notEqual(
    triggerLibrarySignature(prefix + action + param + suffix),
    triggerLibrarySignature(prefix + action + param.replace("> a <", ">a<") + suffix),
  );
  assert.notEqual(
    triggerLibrarySignature(prefix + action + param + suffix),
    triggerLibrarySignature(
      prefix +
        action.replace(
          'Id="00000002"/><Parameter Type="Param" Id="00000003"',
          'Id="00000003"/><Parameter Type="Param" Id="00000002"',
        ) +
        param +
        suffix,
    ),
  );
});
