import { scanXml } from '../../core/xmlScanner.js';

/** Editor reads custom-action ScriptCode as an XML-indented block, stripping
 * the structural prefix on every line. An inline/under-indented carrier can
 * therefore lose executable characters even though the XML itself is valid.
 * Only payload spans are rewritten; the trigger graph is never regenerated.
 */
export function normalizeCustomScriptLayout(xml: string) {
  const parsed = scanXml(xml);
  if (parsed.diagnostics.some(d => d.severity === 'error')) throw new Error('TRIGGER_XML_INVALID');
  const nl = xml.includes('\r\n') ? '\r\n' : '\n';
  const edits: Array<{ start: number; end: number; text: string; ownerId: string }> = [];
  for (const node of parsed.nodes) {
    if (node.tag !== 'ScriptCode' || node.selfClosing || node.parentId === null) continue;
    const owner = parsed.nodes[node.parentId]!;
    if (owner.tag !== 'Element') continue;
    const customAction = owner.attrs.Type === 'FunctionCall' && owner.childIds.some(id => {
      const def = parsed.nodes[id]!;
      return def.tag === 'FunctionDef' && def.attrs.Library === 'Ntve' && def.attrs.Id === '00000123';
    });
    if (!customAction && owner.attrs.Type !== 'CustomScript') continue;
    if (node.childIds.length) throw new Error('TRIGGER_SCRIPTCODE_CHILD_ELEMENT');
    const raw = xml.slice(node.startTagEnd, node.endTagStart);
    if (raw.includes('<')) throw new Error('TRIGGER_SCRIPTCODE_UNSUPPORTED_CDATA');
    const lines = raw.replace(/\r\n?/g, '\n').split('\n');
    while (lines.length && !lines[0]!.trim()) lines.shift();
    while (lines.length && !lines.at(-1)!.trim()) lines.pop();
    if (!lines.length) continue;
    const common = Math.min(...lines.filter(line => line.trim()).map(line => /^[ \t]*/.exec(line)![0].length));
    let depth = 0;
    for (let parent: number | null = node.parentId; parent !== null; parent = parsed.nodes[parent]!.parentId) depth++;
    const closingIndent = '    '.repeat(depth);
    const prefix = closingIndent + '    '; // XML structure only; extra spaces become visible code indentation in Editor.
    const text = nl + lines.map(line => prefix + (line.trim() ? line.slice(common) : '')).join(nl) + nl + closingIndent;
    if (raw !== text) edits.push({ start: node.startTagEnd, end: node.endTagStart, text, ownerId: owner.attrs.Id ?? '' });
  }
  for (const edit of [...edits].reverse()) xml = xml.slice(0, edit.start) + edit.text + xml.slice(edit.end);
  return { xml, changedScriptBlocks: edits.length, ownerIds: edits.map(e => e.ownerId) };
}
