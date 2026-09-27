import { randomBytes } from 'node:crypto';
import type { Workspace } from '../../core/workspace.js';

type Kind = 'Event' | 'Action';
const element = /<Element\s+Type="([^"]+)"\s+Id="([A-Fa-f0-9]{8})"[^>]*>[\s\S]*?<\/Element>/g;
const idOf = (xml: string) => /\bId="([A-Fa-f0-9]{8})"/.exec(xml)?.[1]?.toUpperCase();
const escapeRx = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function libraryId(xml: string) {
  const id = /<Library\s+[^>]*Id="([A-Fa-f0-9]{8})"/.exec(xml)?.[1];
  if (!id) throw new Error('TRIGGER_LIBRARY_MISSING');
  return id.toUpperCase();
}
function graph(xml: string) {
  const found = new Map<string, { type: string; xml: string }>();
  for (const match of xml.matchAll(element)) found.set(match[2]!.toUpperCase(), { type: match[1]!, xml: match[0] });
  return found;
}
function trigger(xml: string, name: string) {
  const matches = [...xml.matchAll(/<Element\s+Type="Trigger"\s+Id="([A-Fa-f0-9]{8})"[^>]*>[\s\S]*?<\/Element>/g)]
    .filter(m => m[1]!.toUpperCase() === name.toUpperCase() || new RegExp(`<Identifier>${escapeRx(name)}<\\/Identifier>`).test(m[0]));
  if (matches.length !== 1) throw new Error(`TRIGGER_NOT_UNIQUE: ${name} (${matches.length})`);
  return { xml: matches[0]![0], id: matches[0]![1]!.toUpperCase(), offset: matches[0]!.index! };
}
function list(xml: string) {
  return [...xml.matchAll(/<Element\s+Type="Trigger"\s+Id="([A-Fa-f0-9]{8})"[^>]*>[\s\S]*?<\/Element>/g)]
    .map(m => ({ id: m[1]!, identifier: /<Identifier>([^<]+)<\/Identifier>/.exec(m[0])?.[1] ?? m[1]!, events: [...m[0].matchAll(/<Event\b[^>]*Id="([A-Fa-f0-9]{8})"/g)].map(x => x[1]), actions: [...m[0].matchAll(/<Action\b[^>]*Id="([A-Fa-f0-9]{8})"/g)].map(x => x[1]) }));
}
function uniqueId(used: Set<string>) {
  let id: string;
  do { id = randomBytes(4).toString('hex').toUpperCase(); } while (used.has(id));
  used.add(id);
  return id;
}
function graft(target: string, source: string, sourceTrigger: string, targetTrigger: string, kind: Kind, index: number) {
  if (!Number.isInteger(index) || index < 0) throw new Error('TRIGGER_INDEX_INVALID');
  const sourceLib = libraryId(source), targetLib = libraryId(target);
  const sourceBlock = trigger(source, sourceTrigger);
  const targetBlock = trigger(target, targetTrigger);
  const refs = [...sourceBlock.xml.matchAll(new RegExp(`<${kind}\\b[^>]*Id="([A-Fa-f0-9]{8})"`, 'g'))];
  const root = refs[index]?.[1]?.toUpperCase();
  if (!root) throw new Error(`TRIGGER_${kind.toUpperCase()}_INDEX_MISSING`);
  const sourceGraph = graph(source), targetGraph = graph(target);
  const ids = new Set(targetGraph.keys()), closure: string[] = [], seen = new Set<string>();
  const visit = (id: string) => {
    if (seen.has(id)) return;
    seen.add(id);
    const node = sourceGraph.get(id);
    if (!node) throw new Error(`TRIGGER_DANGLING_SOURCE_REF: ${id}`);
    closure.push(id);
    const refRx = /\bLibrary="([A-Fa-f0-9]{8})"\s+Id="([A-Fa-f0-9]{8})"/g;
    for (const m of node.xml.matchAll(refRx)) if (m[1]!.toUpperCase() === sourceLib && sourceGraph.has(m[2]!.toUpperCase())) visit(m[2]!.toUpperCase());
  };
  visit(root);
  const remap = new Map(closure.map(id => [id, ids.has(id) ? uniqueId(ids) : (ids.add(id), id)]));
  const rewrite = (fragment: string) => fragment.replace(/\b(?:Library="([A-Fa-f0-9]{8})"\s+)?Id="([A-Fa-f0-9]{8})"/g, (whole, lib: string | undefined, id: string) => {
    const mapped = remap.get(id.toUpperCase());
    if (!mapped || (lib && lib.toUpperCase() !== sourceLib)) return whole;
    return `${lib ? `Library="${targetLib}" ` : ''}Id="${mapped}"`;
  });
  const nl = target.includes('\r\n') ? '\r\n' : '\n';
  const eventRef = `            <${kind} Type="${sourceGraph.get(root)!.type}" Library="${targetLib}" Id="${remap.get(root)}" />`;
  const insertion = targetBlock.xml.indexOf('</Identifier>') + '</Identifier>'.length;
  const updated = targetBlock.xml.slice(0, insertion) + nl + eventRef + targetBlock.xml.slice(insertion);
  target = target.slice(0, targetBlock.offset) + updated + target.slice(targetBlock.offset + targetBlock.xml.length);
  const fragments = closure.map(id => '        ' + rewrite(sourceGraph.get(id)!.xml).replace(/\r?\n/g, nl)).join(nl);
  if (!target.includes('</Library>')) throw new Error('TRIGGER_LIBRARY_END_MISSING');
  return { xml: target.replace('</Library>', `${fragments}${nl}    </Library>`), copied: closure.length, rootId: remap.get(root) };
}

export class TriggerWorkspace {
  constructor(private readonly workspace: Workspace) {}
  async inspect(query?: string, offset = 0, limit = 100) {
    const { text, exists } = await this.workspace.readRaw('Triggers');
    if (!exists) return { exists: false, triggers: [] };
    const all = list(text), selected = query ? all.filter(t => t.identifier.toLowerCase().includes(query.toLowerCase())) : all;
    return { exists: true, libraryId: libraryId(text), count: all.length, matching: selected.length, triggers: selected.slice(offset, offset + limit) };
  }
  async get(identifier: string) {
    const { text } = await this.workspace.readRaw('Triggers');
    const found = trigger(text, identifier);
    const nodes = graph(text);
    const refs = [...found.xml.matchAll(/<(Event|Action)\b[^>]*Id="([A-Fa-f0-9]{8})"/g)].map(m => ({ kind: m[1], id: m[2], definition: nodes.get(m[2]!.toUpperCase())?.xml ?? null }));
    return { identifier, id: found.id, xml: found.xml, references: refs };
  }
  async graft(args: { sourceFile: string; sourceTrigger: string; targetTrigger: string; kind: Kind; index: number; dryRun?: boolean; stage?: boolean }) {
    const sourcePath = this.workspace.resolveUserPath(args.sourceFile);
    let result: ReturnType<typeof graft> | undefined;
    const transaction = await this.workspace.applyRawTransaction(['Triggers'], async files => {
      const source = await this.workspace.readDependency(sourcePath);
      result = graft(files.get('Triggers')!, source, args.sourceTrigger, args.targetTrigger, args.kind, args.index);
      return new Map([['Triggers', result.xml]]);
    }, { dryRun: args.dryRun ?? true, stage: args.stage ?? true, requireExisting: true, summary: `Graft ${args.kind} ${args.index} from ${args.sourceTrigger} into ${args.targetTrigger}` });
    return { ...transaction, copiedElements: result?.copied, eventOrActionId: result?.rootId };
  }
  save(backup = true) { return this.workspace.save('Triggers', { backup }); }
  discard() { return this.workspace.discard('Triggers'); }
}
