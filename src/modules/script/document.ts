export interface Token {
    kind: "identifier" | "number" | "string" | "punctuation";
    value: string;
    start: number;
    end: number;
}
export interface Diagnostic {
    severity: "error" | "warning";
    code: string;
    offset: number;
    message: string;
}
export interface Symbol {
    name: string;
    kind: "function" | "prototype" | "struct" | "global";
    start: number;
    end: number;
    signature: string;
    returnType?: string;
    parameters?: string[];
    bodyStart?: number;
    bodyEnd?: number;
}
export interface Include {
    path: string;
    start: number;
    end: number;
}
const idStart = /[A-Za-z_]/, idPart = /[A-Za-z_0-9]/;
/** Lossless token spans and structural declaration model, not a complete Galaxy compiler. */
export class GalaxyDocument {
    readonly tokens: Token[] = [];
    readonly diagnostics: Diagnostic[] = [];
    readonly symbols: Symbol[] = [];
    readonly includes: Include[] = [];
    readonly pairs = new Map<number, number>();
    readonly referencesByName = new Map<string, Array<{token:Token;index:number}>>();
    private callCache?: Array<{name:string;offset:number;member:boolean}>;
    constructor(readonly source: string) { this.lex(); for(let index=0;index<this.tokens.length;index++){const token=this.tokens[index]!;if(token.kind!=="identifier"&&token.kind!=="string")continue;const key=token.kind==="string"?decodeGalaxyString(token.value):token.value;const rows=this.referencesByName.get(key)??[];rows.push({token,index});this.referencesByName.set(key,rows);} this.structure(); }
    private error(code: string, offset: number, message: string) { this.diagnostics.push({ severity: "error", code, offset, message }); }
    private lex() { const s = this.source; let i = 0; while (i < s.length) {
        const start = i, c = s[i]!;
        if (/\s/.test(c)) {
            i++;
            continue;
        }
        if (s.startsWith('//', i)) {
            i = s.indexOf('\n', i);
            if (i < 0)
                break;
            continue;
        }
        if (s.startsWith('/*', i)) {
            const end = s.indexOf('*/', i + 2);
            if (end < 0) {
                this.error('UNCLOSED_COMMENT', i, 'Unclosed block comment');
                break;
            }
            i = end + 2;
            continue;
        }
        if (c === '"') {
            i++;
            let closed = false;
            while (i < s.length) {
                if (s[i] === '\\') {
                    i += 2;
                    continue;
                }
                if (s[i] === '"') {
                    i++;
                    closed = true;
                    break;
                }
                if (s[i] === '\n' || s[i] === '\r') {
                    this.error('STRING_NEWLINE', i, 'Raw newline in string');
                    break;
                }
                i++;
            }
            if (!closed)
                this.error('UNCLOSED_STRING', start, 'Unclosed string literal');
            this.tokens.push({ kind: 'string', value: s.slice(start, i), start, end: i });
            continue;
        }
        if (idStart.test(c)) {
            while (i < s.length && idPart.test(s[i]!))
                i++;
            this.tokens.push({ kind: 'identifier', value: s.slice(start, i), start, end: i });
            continue;
        }
        if (/[0-9]/.test(c)) {
            i++;
            while (i < s.length && /[A-Za-z_0-9.]/.test(s[i]!))
                i++;
            this.tokens.push({ kind: 'number', value: s.slice(start, i), start, end: i });
            continue;
        }
        i++;
        this.tokens.push({ kind: 'punctuation', value: c, start, end: i });
    } }
    private structure() {
        const t = this.tokens, stack: number[] = [];
        for (let i = 0; i < t.length; i++) {
            const v = t[i]!.value;
            if (['(', '[', '{'].includes(v))
                stack.push(i);
            if ([')', ']', '}'].includes(v)) {
                const open = stack.pop();
                if (open === undefined || ({ '(': ')', '[': ']', '{': '}' } as Record<string, string>)[t[open]!.value] !== v)
                    this.error('DELIMITER_MISMATCH', t[i]!.start, 'Mismatched delimiter');
                else {
                    this.pairs.set(open, i);
                    this.pairs.set(i, open);
                }
            }
        }
        for (const i of stack)
            this.error('UNCLOSED_DELIMITER', t[i]!.start, 'Unclosed delimiter');
        let i = 0;
        while (i < t.length) {
            const first = i;
            if (t[i]!.value === 'include') {
                const p = t[i + 1];
                if (p?.kind !== 'string') {
                    this.error('INVALID_INCLUDE', t[i]!.start, 'Include needs a quoted path');
                    i++;
                    continue;
                }
                this.includes.push({ path: decodeGalaxyString(p.value), start: t[i]!.start, end: p.end });
                i += 2;
                if (t[i]?.value === ';')
                    i++;
                continue;
            }
            if (t[i]!.value === 'struct' && t[i + 1]?.kind === 'identifier' && t[i + 2]?.value === '{') {
                const end = this.pairs.get(i + 2);
                if (end === undefined)
                    break;
                this.symbols.push({ kind: 'struct', name: t[i + 1]!.value, start: t[i]!.start, end: t[end]!.end, signature: this.source.slice(t[i]!.start, t[i + 2]!.start).trim() });
                i = end + 1;
                if (t[i]?.value === ';')
                    i++;
                continue;
            }
            let stop = i;
            while (stop < t.length && ![';', '{'].includes(t[stop]!.value)) {
                if (t[stop]!.value === '(') {
                    const close = this.pairs.get(stop);
                    if (close === undefined)
                        break;
                    stop = close + 1;
                }
                else
                    stop++;
            }
            if (stop >= t.length) {
                if (i < t.length)
                    this.error('INCOMPLETE_DECLARATION', t[i]!.start, 'Incomplete top-level declaration');
                break;
            }
            let paren = -1, eq = -1;
            for (let j = first; j < stop; j++) {
                if (t[j]!.value === '(' && paren < 0)
                    paren = j;
                if (t[j]!.value === '=' && eq < 0)
                    eq = j;
            }
            if (paren > first && t[paren - 1]?.kind === 'identifier' && (eq < 0 || eq > paren)) {
                const close = this.pairs.get(paren);
                if (close === undefined)
                    break;
                const body = t[stop]!.value === '{' ? stop : undefined;
                const end = body === undefined ? stop : this.pairs.get(body);
                if (end === undefined)
                    break;
                const params = this.splitParameters(paren + 1, close);
                const type = t.slice(first, paren - 1).filter(x => !['native', 'static'].includes(x.value)).map(x => x.value).join('');
                this.symbols.push({ kind: body === undefined ? 'prototype' : 'function', name: t[paren - 1]!.value, start: t[first]!.start, end: t[end]!.end, signature: this.source.slice(t[first]!.start, t[close]!.end), returnType: type, parameters: params, ...(body === undefined ? {} : { bodyStart: t[body]!.end, bodyEnd: t[end]!.start }) });
                i = end + 1;
                continue;
            }
            if (t[stop]!.value === '{') {
                const end = this.pairs.get(stop);
                if (end === undefined)
                    break;
                i = end + 1;
                while (i < t.length && t[i]!.value !== ';')
                    i++;
                i++;
                continue;
            }
            const head = t.slice(first, eq < 0 ? stop : eq);
            const names = head.filter(x => x.kind === 'identifier' && !['const', 'static'].includes(x.value));
            if (names.length >= 2)
                this.symbols.push({ kind: 'global', name: names.at(-1)!.value, start: t[first]!.start, end: t[stop]!.end, signature: this.source.slice(t[first]!.start, t[stop]!.end) });
            else
                this.error('UNKNOWN_DECLARATION', t[first]!.start, 'Unrecognized top-level declaration');
            i = stop + 1;
        }
    }
    private splitParameters(start: number, end: number) { const out: string[] = []; let from = start; for (let i = start; i <= end; i++)
        if (i === end || this.tokens[i]!.value === ',') {
            if (i > from)
                out.push(this.source.slice(this.tokens[from]!.start, this.tokens[i - 1]!.end).trim());
            from = i + 1;
        } return out.length === 1 && out[0] === 'void' ? [] : out; }
    function(name: string) { const matches = this.symbols.filter(s => s.kind === 'function' && s.name === name); if (matches.length !== 1)
        throw new Error('FUNCTION_NOT_UNIQUE: ' + name); return matches[0]!; }
    calls() { if(this.callCache)return this.callCache; const signatures = this.symbols.filter(s => s.kind === 'function' || s.kind === 'prototype'); let cursor = 0; return this.callCache = this.tokens.flatMap((t, i) => { while (cursor < signatures.length && t.start >= signatures[cursor]!.start + signatures[cursor]!.signature.length)
        cursor++; return t.kind === 'identifier' && this.tokens[i + 1]?.value === '(' && !['if', 'for', 'while', 'switch', 'return'].includes(t.value) && !(signatures[cursor] && t.start >= signatures[cursor]!.start && t.end <= signatures[cursor]!.start + signatures[cursor]!.signature.length) ? [{ name: t.value, offset: t.start, member: this.tokens[i - 1]?.value === '.' }] : []; }); }
}
export function decodeGalaxyString(raw: string) { return raw.slice(1, -1).replace(/\\([\\"nrt])/g, (_, c: string) => ({ n: '\n', r: '\r', t: '\t' } as Record<string, string>)[c] ?? c); }
export function editSpans(source: string, edits: Array<{
    start: number;
    end: number;
    text: string;
}>) { const ordered = [...edits].sort((a, b) => b.start - a.start || b.end - a.end); let boundary = source.length; for (const edit of ordered) {
    if (edit.start < 0 || edit.end < edit.start || edit.end > boundary)
        throw new Error('OVERLAPPING_SCRIPT_EDITS');
    source = source.slice(0, edit.start) + edit.text + source.slice(edit.end);
    boundary = edit.start;
} return source; }
