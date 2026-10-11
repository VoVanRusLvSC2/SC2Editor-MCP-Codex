/** Minimal lexical patch after strict XML validation. Keeps comments, formatting, attribute order and unknown elements. */
import { parseStrictXml } from '../format/xml.js';
import { finite } from '../format/guards.js';
import { parseTerrainXml } from '../format/terrain-params.js';
interface Tag {
    name: string;
    path: string;
    start: number;
    end: number;
    source: string;
}
function tags(xml: string): Tag[] {
    const out: Tag[] = [], stack: string[] = [];
    for (let i = 0; i < xml.length;) {
        const start = xml.indexOf('<', i);
        if (start < 0)
            break;
        if (xml.startsWith('<!--', start)) {
            const e = xml.indexOf('-->', start + 4);
            if (e < 0)
                throw new Error('XML_COMMENT');
            i = e + 3;
            continue;
        }
        if (xml.startsWith('<![CDATA[', start)) {
            const e = xml.indexOf(']]>', start + 9);
            if (e < 0)
                throw new Error('XML_CDATA');
            i = e + 3;
            continue;
        }
        if (xml.startsWith('<?', start)) {
            const e = xml.indexOf('?>', start + 2);
            if (e < 0)
                throw new Error('XML_PI');
            i = e + 2;
            continue;
        }
        let quote = '', end = start + 1;
        for (; end < xml.length; end++) {
            const ch = xml[end]!;
            if (quote) {
                if (ch === quote)
                    quote = '';
            }
            else if (ch === '"' || ch === "'")
                quote = ch;
            else if (ch === '>')
                break;
        }
        const source = xml.slice(start, end + 1), match = source.match(/^<\s*(\/?)\s*([A-Za-z_][\w:.-]*)/);
        if (!match)
            throw new Error('XML_UNSUPPORTED_TAG');
        const name = match[2]!;
        if (match[1]) {
            if (stack.pop() !== name)
                throw new Error('XML_STACK_MISMATCH');
        }
        else {
            out.push({ name, path: [...stack, name].join('/'), start, end: end + 1, source });
            if (!/\/\s*>$/.test(source))
                stack.push(name);
        }
        i = end + 1;
    }
    return out;
}
export function patchTerrainNumericAttribute(xml: string, attribute: 'quantizeScale' | 'quantizeBias' | 'standardHeight', value: number): string {
    finite(value, attribute);
    if (attribute === 'quantizeScale' && value <= 0)
        throw new Error('QUANTIZE_SCALE_MUST_BE_POSITIVE');
    parseStrictXml(xml);
    parseTerrainXml(xml);
    const candidates = tags(xml).filter(t => t.path === 'terrain/heightMap/vertData');
    if (candidates.length !== 1)
        throw new Error('EXACTLY_ONE_VERTDATA_REQUIRED');
    const t = candidates[0]!, regex = /([A-Za-z_][\w:.-]*)\s*=\s*(["'])([\s\S]*?)\2/g;
    let match: RegExpExecArray | null, span: {
        start: number;
        end: number;
    } | undefined;
    while ((match = regex.exec(t.source))) {
        if (match[1] !== attribute)
            continue;
        const quoteAt = match[0].indexOf(match[2]!);
        const start = t.start + match.index + quoteAt + 1;
        span = { start, end: start + match[3]!.length };
    }
    if (!span)
        throw new Error('ATTRIBUTE_ABSENT: insertion is intentionally not guessed');
    const next = xml.slice(0, span.start) + String(value) + xml.slice(span.end);
    parseTerrainXml(next);
    return next;
}
