import * as z from 'zod/v4';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { Workspace } from '../../core/workspace.js';
import { projectPath } from '../../app/paths.js';
import { GalaxyDocument, decodeGalaxyString, editSpans } from './document.js';
const reserved = new Set('if else for while do switch case default break continue return include native static const struct typedef void int fixed bool string true false null'.split(' '));
const identifier = z.string().regex(/^[A-Za-z_][A-Za-z_0-9]*$/).max(256).refine(v => !reserved.has(v), 'Reserved Galaxy identifier');
const file = z.string().min(1).max(1024).refine(v => /\.galaxy$/i.test(v), 'Galaxy file required');
const code = z.string().max(512 * 1024);
export const scriptPlanSchema = z.object({ operations: z.array(z.discriminatedUnion('op', [
        z.object({ op: z.literal('file.create'), file, source: code }).strict(),
        z.object({ op: z.literal('function.add'), file, source: code }).strict(),
        z.object({ op: z.literal('function.body'), file, name: identifier, body: code }).strict(),
        z.object({ op: z.literal('function.rename'), file, name: identifier, newName: identifier }).strict(),
        z.object({ op: z.literal('connect'), file, entryFile: file.default('MapScript.galaxy'), entry: identifier.default('InitMap'), init: identifier }).strict()
    ])).min(1).max(100) }).strict();
const hash = (s: string) => createHash('sha256').update(s).digest('hex');
interface NativeFunction {
    name: string;
    signature: string;
    parameters: string[];
    returnType: string;
    guiAction?: {
        library: 'Ntve';
        functionDefId: string;
        displayName: string;
        grammar: string;
        hint: string;
        paramDefIds: string[];
    };
}
interface NativeApi {
    provenance: unknown;
    functions: NativeFunction[];
}
interface IndexedNativeApi extends NativeApi {
    byName: ReadonlyMap<string, NativeFunction>;
}
let sharedNativeApi: Promise<IndexedNativeApi> | undefined;
function nativeApi() {
    return sharedNativeApi ??= fs.readFile(projectPath('generated/galaxy-native-api.json'), 'utf8').then(source => {
        const api = JSON.parse(source) as NativeApi;
        const byName = new Map<string, NativeFunction>();
        for (const fn of api.functions) {
            if (byName.has(fn.name))
                throw new Error(`DUPLICATE_NATIVE_API_FUNCTION: ${fn.name}`);
            byName.set(fn.name, fn);
        }
        return Object.assign(api, { byName });
    });
}
interface Snapshot {
    sources: Map<string, string>;
    exists: Map<string, boolean>;
    docs: Map<string, GalaxyDocument>;
    fingerprint: string;
}
interface Plan {
    before: Snapshot;
    after: Map<string, string>;
    changed: string[];
}
/** Only workspace-owned .galaxy files are writable. Native and GUI trigger files stay read-only. */
export class ScriptWorkspace {
    private cache = new Map<string, {
        source: string;
        document: GalaxyDocument;
    }>();
    private cacheBytes = 0;
    private plans = new Map<string, Plan>();
    private staged = new Map<string, {
        fingerprint: string;
        files: string[];
    }>();
    constructor(readonly workspace: Workspace) { }
    private api() { return nativeApi(); }
    private key(file: string) { if (!/\.galaxy$/i.test(file))
        throw new Error('GALAXY_FILE_REQUIRED'); return path.relative(this.workspace.root, this.workspace.resolveUserPath(file)).replaceAll('\\', '/'); }
    private document(file: string, source: string) { const old = this.cache.get(file); if (old?.source === source)
        return old.document; if (old) {
        this.cacheBytes -= Buffer.byteLength(old.source);
        this.cache.delete(file);
    } const document = new GalaxyDocument(source); this.cache.set(file, { source, document }); this.cacheBytes += Buffer.byteLength(source); while (this.cache.size > 128 || this.cacheBytes > 32 * 1024 * 1024) {
        const key = this.cache.keys().next().value!;
        this.cacheBytes -= Buffer.byteLength(this.cache.get(key)!.source);
        this.cache.delete(key);
    } return document; }
    private async files() { const out: string[] = []; const walk = async (dir: string) => { for (const e of await fs.readdir(dir, { withFileTypes: true })) {
        if (e.name.startsWith('.') || ['node_modules', 'dist', 'dist-runtime', 'release'].includes(e.name))
            continue;
        const full = path.join(dir, e.name);
        if (e.isDirectory())
            await walk(full);
        else if (e.isFile() && /\.galaxy$/i.test(e.name))
            out.push(this.key(full));
    } }; await walk(this.workspace.root); for (const f of this.workspace.draftFiles())
        if (/\.galaxy$/i.test(f) && !out.includes(f))
            out.push(f); return out.sort(); }
    private async snapshot(extra: string[] = []): Promise<Snapshot> { const sources = new Map<string, string>(), exists = new Map<string, boolean>(), docs = new Map<string, GalaxyDocument>(); const files = [...new Set([...(await this.files()), ...extra.map(f => this.key(f))])].sort(); if (files.length > 4096)
        throw new Error('SCRIPT_FILE_LIMIT'); let bytes = 0; for (const file of files) {
        const raw = await this.workspace.readRaw(file);
        bytes += Buffer.byteLength(raw.text);
        if (bytes > 64 * 1024 * 1024)
            throw new Error('SCRIPT_INDEX_BYTE_LIMIT');
        sources.set(file, raw.text);
        exists.set(file, raw.exists || raw.staged);
        docs.set(file, this.document(file, raw.text));
    } return { sources, exists, docs, fingerprint: hash(JSON.stringify([...sources].map(([f, s]) => [f, exists.get(f), hash(s)]))) }; }
    async inspect() { const s = await this.snapshot(), api = await this.api(); return { fingerprint: s.fingerprint, files: [...s.docs].map(([file, d]) => ({ file, sha256: hash(d.source), bytes: Buffer.byteLength(d.source), symbols: d.symbols.length, includes: d.includes, diagnostics: d.diagnostics })), nativeFunctions: api.functions.length, nativeEvidence: api.provenance, semanticCoverage: 'PARTIAL', compiler: 'NOT_EXECUTED', cache: { entries: this.cache.size, sourceBytes: this.cacheBytes, maxEntries: 128, maxSourceBytes: 32 * 1024 * 1024 } }; }
    async symbols(args: {
        file?: string;
        query?: string;
        offset?: number;
        limit?: number;
    } = {}) { const s = await this.snapshot(); const all = [...s.docs].flatMap(([file, d]) => d.symbols.map(x => ({ file, ...x }))).filter(x => (!args.file || x.file === this.key(args.file)) && (!args.query || x.name.toLowerCase().includes(args.query.toLowerCase()))); const offset = args.offset ?? 0, limit = args.limit ?? 50; return { fingerprint: s.fingerprint, total: all.length, offset, items: all.slice(offset, offset + limit), nextOffset: offset + limit < all.length ? offset + limit : null }; }
    async references(name: string, limit = 100) { const s = await this.snapshot(); const all = [...s.docs].flatMap(([file, d]) => (d.referencesByName.get(name)??[]).map(({token:t,index:i})=>({file,offset:t.start,kind:t.kind==='string'?'stringCandidate':d.tokens[i+1]?.value==='('?'callOrDeclaration':'identifier',member:t.kind==='identifier'&&d.tokens[i-1]?.value==='.'}))); return { fingerprint: s.fingerprint, total: all.length, items: all.slice(0, limit), truncated: all.length > limit, bindingsVerified: false }; }
    async context(args: {
        file: string;
        name: string;
        maxChars?: number;
    }) { const s = await this.snapshot(), key = this.key(args.file), d = s.docs.get(key); if (!d)
        throw new Error('SCRIPT_FILE_NOT_FOUND'); const fn = d.function(args.name), api = await this.api(), calls = [...new Set(d.calls().filter(c => c.offset >= fn.start && c.offset < fn.end).map(c => c.name))]; const callSet = new Set(calls); const local = [...s.docs].flatMap(([file, d]) => d.symbols.filter(x => callSet.has(x.name)).map(x => ({ file, name: x.name, signature: x.signature }))); const native = calls.flatMap(name => { const fn = api.byName.get(name); return fn ? [fn] : []; }); const nativeNames = new Set(native.map(x => x.name)); const localNames = new Set(local.map(x => x.name)); const budget = z.number().int().min(1000).max(64000).parse(args.maxChars ?? 8000); const metadata = { file: key, name: fn.name, sha256: hash(d.source), includes: d.includes, dependencies: local, nativeSignatures: native, unresolvedCalls: calls.filter(name => !localNames.has(name) && !nativeNames.has(name)), semanticCoverage: 'PARTIAL', compiler: 'NOT_EXECUTED', source: '', sourceTruncated: true, fullSourceChars: fn.end - fn.start, maxChars: budget, dependencyMetadataTruncated: false }; if (JSON.stringify(metadata).length > budget) {
        metadata.dependencies = [];
        metadata.nativeSignatures = [];
        metadata.unresolvedCalls = [];
        metadata.includes = [];
        metadata.dependencyMetadataTruncated = true;
    } if (JSON.stringify(metadata).length > budget)
        throw new Error('CONTEXT_METADATA_EXCEEDS_BUDGET'); const source = d.source.slice(fn.start, fn.end); let lo = 0, hi = source.length; while (lo < hi) {
        const mid = Math.ceil((lo + hi) / 2);
        metadata.source = source.slice(0, mid);
        metadata.sourceTruncated = mid < source.length;
        if (JSON.stringify(metadata).length <= budget)
            lo = mid;
        else
            hi = mid - 1;
    } metadata.source = source.slice(0, lo); metadata.sourceTruncated = lo < source.length; return metadata; }
    private async validation(s: Snapshot) {
        const api = await this.api(), native = api.byName;
        const declarations = new Map<string, Array<{
            file: string;
            kind: string;
        }>>();
        for (const [file, d] of s.docs)
            for (const x of d.symbols) {
                const rows = declarations.get(x.name) ?? [];
                rows.push({ file, kind: x.kind });
                declarations.set(x.name, rows);
            }
        const diagnostics = [...s.docs].flatMap(([file, d]) => d.diagnostics.map(x => ({ file, ...x })));
        for (const [name, rows] of declarations)
            if (rows.filter(x => x.kind === 'function').length > 1)
                diagnostics.push({ file: rows[0]!.file, severity: 'warning', code: 'DUPLICATE_FUNCTION_CANDIDATE', offset: 0, message: name + ': Include activation/scoping must be checked' });
        const knownPaths = new Map([...s.sources.keys()].map(f => [f.toLowerCase(), f]));
        const includes = [...s.docs].flatMap(([file, d]) => d.includes.map(x => { if (/^[/\\]|(^|[/\\])\.\.([/\\]|$)|:/.test(x.path))
            return { file, path: x.path, status: 'UNSAFE' }; const wanted = x.path.replaceAll('\\', '/').replace(/\.galaxy$/i, '') + '.galaxy'; const local = knownPaths.get(path.posix.join(path.posix.dirname(file), wanted).toLowerCase()) ?? knownPaths.get(wanted.toLowerCase()); return { file, path: x.path, status: local ? 'LOCAL' : 'EXTERNAL_UNRESOLVED', resolved: local }; }));
        for (const x of includes)
            if (x.status === 'UNSAFE')
                diagnostics.push({ file: x.file, severity: 'error', code: 'UNSAFE_INCLUDE', offset: 0, message: x.path });
        const visiting = new Set<string>(), done = new Set<string>();
        const visit = (file: string) => { if (visiting.has(file)) {
            diagnostics.push({ file, severity: 'error', code: 'INCLUDE_CYCLE', offset: 0, message: 'Local Include cycle' });
            return;
        } if (done.has(file))
            return; visiting.add(file); for (const x of includes)
            if (x.file === file && x.resolved)
                visit(x.resolved); visiting.delete(file); done.add(file); };
        for (const file of s.docs.keys())
            visit(file);
        for (const [file, d] of s.docs) {
            const tokenIndex = new Map(d.tokens.map((t, i) => [t.start, i]));
            for (const c of d.calls()) {
                const n = native.get(c.name);
                if (!n || declarations.has(c.name) || c.member)
                    continue;
                const i = tokenIndex.get(c.offset)!, open = i + 1, close = d.pairs.get(open);
                if (close === undefined)
                    continue;
                let count = close === open + 1 ? 0 : 1;
                for (let j = open + 1; j < close; j++) {
                    const token = d.tokens[j]!;
                    if (['(', '[', '{'].includes(token.value)) {
                        j = d.pairs.get(j) ?? j;
                        continue;
                    }
                    if (token.value === ',')
                        count++;
                }
                if (count !== n.parameters.length)
                    diagnostics.push({ file, severity: 'error', code: 'NATIVE_ARITY', offset: c.offset, message: `${c.name}: expected ${n.parameters.length} args, got ${count}` });
            }
        }
        const calls = [...s.docs].flatMap(([file, d]) => d.calls().filter(x => !x.member).map(c => ({ file, ...c, resolution: declarations.has(c.name) ? 'LOCAL_CANDIDATE' : native.has(c.name) ? 'PINNED_NATIVE' : 'UNRESOLVED' })));
        return { valid: !diagnostics.some(x => x.severity === 'error'), validationScope: 'LEXICAL_AND_STRUCTURAL_WITH_SIGNATURE_INDEX', semanticCoverage: 'PARTIAL', diagnostics, includes, callSummary: { total: calls.length, unresolved: calls.filter(x => x.resolution === 'UNRESOLVED').length }, unresolvedCalls: calls.filter(x => x.resolution === 'UNRESOLVED').slice(0, 100), unresolvedRules: ['Expression and assignment type checking', 'Native runtime/target-build compatibility', 'Include activation, local scope binding and external library resolution', 'Dynamic string function references and map resource links'], compiler: 'NOT_EXECUTED' };
    }
    async validate() { return this.validation(await this.snapshot()); }
    async plan(input: z.input<typeof scriptPlanSchema>) {
        const args = scriptPlanSchema.parse(input);
        const extra = args.operations.flatMap(o => o.op === 'connect' ? [o.file, o.entryFile ?? 'MapScript.galaxy'] : [o.file]);
        const before = await this.snapshot(extra), after = new Map(before.sources), present = new Map(before.exists);
        for (const op of args.operations) {
            const key = this.key(op.file), source = after.get(key) ?? '', d = new GalaxyDocument(source);
            if (d.diagnostics.some(x => x.severity === 'error'))
                throw new Error('INVALID_SCRIPT_SOURCE: ' + key);
            if (op.op === 'file.create') {
                if (present.get(key))
                    throw new Error('SCRIPT_FILE_EXISTS');
                after.set(key, op.source);
                present.set(key, true);
            }
            if (op.op === 'function.add') {
                if (!present.get(key))
                    throw new Error('SCRIPT_FILE_NOT_FOUND');
                const add = new GalaxyDocument(op.source);
                if (add.symbols.length !== 1 || add.symbols[0]?.kind !== 'function' || add.diagnostics.some(x => x.severity === 'error'))
                    throw new Error('ONE_FUNCTION_REQUIRED');
                if ([...after.values()].some(s => new GalaxyDocument(s).symbols.some(x => x.name === add.symbols[0]!.name)))
                    throw new Error('SCRIPT_SYMBOL_COLLISION');
                after.set(key, source + (source.endsWith('\n') ? '' : '\n') + op.source + '\n');
            }
            if (op.op === 'function.body') {
                const fn = d.function(op.name);
                after.set(key, editSpans(source, [{ start: fn.bodyStart!, end: fn.bodyEnd!, text: op.body }]));
            }
            if (op.op === 'function.rename') {
                d.function(op.name);
                if (op.newName === op.name)
                    continue;
                const definitions = [...after].flatMap(([file, s]) => new GalaxyDocument(s).symbols.filter(x => x.name === op.name && x.kind === 'function').map(() => file));
                if (definitions.length !== 1)
                    throw new Error('AMBIGUOUS_RENAME');
                for (const [file, s] of after) {
                    const doc = new GalaxyDocument(s);
                    if (doc.tokens.some(t => t.kind === 'identifier' && t.value === op.newName))
                        throw new Error('SCRIPT_SYMBOL_COLLISION');
                    const edits = [];
                    for (let i = 0; i < doc.tokens.length; i++) {
                        const t = doc.tokens[i]!;
                        if (t.kind === 'string' && decodeGalaxyString(t.value) === op.name)
                            throw new Error('DYNAMIC_FUNCTION_REFERENCE: ' + file);
                        if (t.kind === 'identifier' && t.value === op.name) {
                            if (doc.tokens[i - 1]?.value === '.' || doc.tokens[i + 1]?.value !== '(')
                                throw new Error('UNVERIFIED_RENAME_BINDING: ' + file);
                            edits.push({ start: t.start, end: t.end, text: op.newName });
                        }
                    }
                    after.set(file, editSpans(s, edits));
                }
            }
            if (op.op === 'connect') {
                if (!present.get(key))
                    throw new Error('SCRIPT_FILE_NOT_FOUND');
                const init = d.function(op.init);
                if (init.returnType !== 'void' || init.parameters?.length)
                    throw new Error('INIT_MUST_BE_VOID_NO_ARGS');
                const entryKey = this.key(op.entryFile ?? 'MapScript.galaxy');
                if (key === entryKey)
                    throw new Error('CONNECT_SELF_INCLUDE');
                const entrySource = after.get(entryKey) ?? '', entryDoc = new GalaxyDocument(entrySource), entry = entryDoc.function(op.entry ?? 'InitMap');
                if (entry.returnType !== 'void' || entry.parameters?.length)
                    throw new Error('ENTRY_MUST_BE_VOID_NO_ARGS');
                if (entryDoc.tokens.some(t => t.value === 'return' && t.start > entry.bodyStart! && t.end < entry.bodyEnd!))
                    throw new Error('ENTRY_EARLY_RETURN_UNSUPPORTED');
                if ([...after].some(([f, s]) => f !== key && new GalaxyDocument(s).symbols.some(x => x.name === op.init)))
                    throw new Error('INIT_SYMBOL_COLLISION');
                const includePath = path.posix.relative(path.posix.dirname(entryKey), key).replace(/\.galaxy$/i, '');
                if (includePath.startsWith('../'))
                    throw new Error('CONNECT_INCLUDE_OUTSIDE_ENTRY_DIRECTORY');
                const newline = entrySource.includes('\r\n') ? '\r\n' : '\n';
                const edits = [];
                if (!entryDoc.includes.some(x => x.path.replace(/\.galaxy$/i, '') === includePath))
                    edits.push({ start: entry.start, end: entry.start, text: `include ${JSON.stringify(includePath)}${newline}` });
                const initCalls=entryDoc.calls().filter(c=>c.name===op.init&&c.offset>=entry.bodyStart!&&c.offset<entry.bodyEnd!);
                const hasOtherCode=entryDoc.tokens.some(t=>t.start>=entry.bodyStart!&&t.end<=entry.bodyEnd!&&['if','for','while','switch','do','break','continue'].includes(t.value));
                if(initCalls.length && (hasOtherCode || initCalls.length!==1 || initCalls.some(c=>{const i=entryDoc.tokens.findIndex(t=>t.start===c.offset);return c.member || !['{','}',';'].includes(entryDoc.tokens[i-1]?.value??'') || entryDoc.tokens[i+2]?.value!==')' || entryDoc.tokens[i+3]?.value!==';';})))throw new Error('ENTRY_INIT_CONTROL_FLOW_UNVERIFIED');
                if (!initCalls.length)
                    edits.push({ start: entry.bodyEnd!, end: entry.bodyEnd!, text: `    ${op.init}();${newline}` });
                after.set(entryKey, editSpans(entrySource, edits));
            }
        }
        const docs = new Map([...after].map(([f, s]) => [f, new GalaxyDocument(s)]));
        const result = await this.validation({ sources: after, exists: present, docs, fingerprint: '' });
        if (!result.valid)
            throw new Error('SCRIPT_PLAN_INVALID: ' + JSON.stringify(result.diagnostics));
        const changed = [...after].filter(([f, s]) => s !== before.sources.get(f) || present.get(f) !== before.exists.get(f)).map(([f]) => f);
        if (changed.length > 64)
            throw new Error('SCRIPT_TRANSACTION_FILE_LIMIT');
        const planId = 'script_' + hash(JSON.stringify([before.fingerprint, [...after]])).slice(0, 24);
        this.plans.set(planId, { before, after, changed });
        while (this.plans.size > 8 || [...this.plans.values()].reduce((n, p) => n + [...p.before.sources.values(), ...p.after.values()].reduce((m, t) => m + Buffer.byteLength(t), 0), 0) > 128 * 1024 * 1024)
            this.plans.delete(this.plans.keys().next().value!);
        if (!this.plans.has(planId))
            throw new Error('SCRIPT_PLAN_BYTE_LIMIT');
        return { planId, changedFiles: changed.map(file => ({ file, beforeSha256: hash(before.sources.get(file) ?? ''), afterSha256: hash(after.get(file)!) })), validation: result, generatedMapScriptWarning: 'Editor may regenerate MapScript.galaxy; native save persistence needs target validation', dryRun: true };
    }
    async apply(planId: string, dryRun = true) { const p = this.plans.get(planId); if (!p)
        throw new Error('SCRIPT_PLAN_NOT_FOUND'); if (!p.changed.length)
        return { accepted: true, files: [], noChange: true }; const transaction = await this.workspace.applyRawTransaction(p.changed, async (sources) => { const current = await this.snapshot([...p.before.sources.keys()]); if (current.fingerprint !== p.before.fingerprint)
        throw new Error('STALE_SCRIPT_PLAN'); for (const file of p.changed)
        if (sources.get(file) !== p.before.sources.get(file))
            throw new Error('STALE_SCRIPT_PLAN'); return new Map(p.changed.map(file => [file, p.after.get(file)!])); }, { dryRun, stage: true, requireMissing:p.changed.filter(file=>!p.before.exists.get(file)), summary: 'Galaxy token-span plan; structural validation only, target compiler not executed' }); if (!dryRun) {
        const fingerprint = hash(JSON.stringify([...p.after].map(([f, text]) => [f, p.changed.includes(f) ? true : p.before.exists.get(f), hash(text)])));
        for (const file of p.changed)
            this.staged.set(file, { fingerprint, files: [...p.after.keys()] });
    } return transaction; }
    async save(file: string, backup = true) { const key = this.key(file), group = this.staged.get(key); if (group && (await this.snapshot(group.files)).fingerprint !== group.fingerprint)
        throw new Error('STALE_SCRIPT_SAVE: source or indexed file set changed'); const result = await this.workspace.save(key, { backup }); for (const file of result.savedFiles)
        this.staged.delete(file); return result; }
    discard(file: string) { const key = this.key(file); const discarded = this.workspace.discard(key); for (const file of this.staged.keys())
        if (!this.workspace.hasDraft(file))
            this.staged.delete(file); return discarded; }
    async recipe(args: {
        file: string;
        name: string;
        kind: 'init' | 'periodic';
        seconds?: number;
        action?: string;
    }) { const name = identifier.parse(args.name); if ((await this.symbols({ query: name, limit: 500 })).items.some(x => x.name === name))
        throw new Error('SCRIPT_SYMBOL_COLLISION'); let source = `void ${name} () {\n    // Add initialization actions here.\n}\n`; if (args.kind === 'periodic') {
        if (!args.action)
            throw new Error('PERIODIC_ACTION_REQUIRED');
        identifier.parse(args.action);
        const s = await this.snapshot(), matches = [...s.docs.values()].flatMap(d => d.symbols).filter(x => x.kind === 'function' && x.name === args.action);
        if (matches.length !== 1 || matches[0]!.returnType !== 'void' || matches[0]!.parameters?.length)
            throw new Error('ACTION_MUST_BE_UNIQUE_VOID_NO_ARGS');
        const seconds = z.number().finite().min(0.0001).max(86400).parse(args.seconds ?? 1);
        source = `trigger ${name}_trigger;\n\nbool ${name}_callback (bool testConds, bool runActions) {\n    if (!runActions) { return true; }\n    ${args.action}();\n    return true;\n}\n\nvoid ${name} () {\n    ${name}_trigger = TriggerCreate("${name}_callback");\n    TriggerAddEventTimePeriodic(${name}_trigger, ${seconds.toFixed(4)}, c_timeGame);\n}\n`;
        for (const suffix of ['', '_trigger', '_callback'])
            if ([...s.docs.values()].some(d => d.tokens.some(t => t.kind === 'identifier' && t.value === name + suffix)))
                throw new Error('SCRIPT_SYMBOL_COLLISION');
    } return this.plan({ operations: [{ op: 'file.create', file: args.file, source }] }); }
}
