import { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import { TerrainSurfaceWorkspace } from './workspace.js';
import type { TerrainToolContext } from '../tools.js';
import { SurfaceSnapshot, planCellEdit, planSummary, type CellEdit } from './core/index.js';
const scope = { directory: z.string().max(512).default('') };
const coordinate = { x: z.number().int().min(0), y: z.number().int().min(0) };
const edit = z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('height-raw'), ...coordinate, channel: z.enum(['heightBase', 'heightAdjustments']), value: z.number().int().min(0).max(65535) }).strict(),
    z.object({ kind: z.literal('texture-weight'), ...coordinate, layer: z.number().int().min(0).max(7), value: z.number().int().min(0).max(15) }).strict(),
    z.object({ kind: z.literal('painted-raw'), ...coordinate, layer: z.enum(['pathing', 'creep']), secondary: z.boolean(), value: z.number().int().min(0).max(255) }).strict(),
    z.object({ kind: z.literal('vertex-byte'), entry: z.number().int().min(0), byte: z.number().int().min(0), value: z.number().int().min(0).max(255) }).strict(),
    z.object({ kind: z.literal('terrain-parameter'), attribute: z.enum(['quantizeScale', 'quantizeBias', 'standardHeight']), value: z.number().finite() }).strict(),
]);
function response(result: unknown, isError = false) { let text = JSON.stringify({ engineValidated: false, result }); if (text.length > 32000) {
    text = JSON.stringify({ engineValidated: false, error: 'OUTPUT_BUDGET', hint: 'Use smaller page/character limit or a narrower query' });
    isError = true;
} return { isError, content: [{ type: 'text' as const, text }] }; }
export function registerTerrainSurfaceTools(server: McpServer, context: TerrainToolContext): void {
    async function run(directory: string, work: (snapshot: SurfaceSnapshot) => unknown) {
        try {
            const loaded = await new TerrainSurfaceWorkspace(context.workspace.workspace).load(directory);
            return response({ revision: loaded.revision, directory: loaded.directory, stagedFiles: loaded.stagedFiles,
                data: work(loaded.snapshot), source: 'one scoped component snapshot; not map runtime' });
        }
        catch (e) {
            return response({ error: e instanceof Error ? e.message : String(e) }, true);
        }
    }
    const annotations = { readOnlyHint: true, destructiveHint: false, openWorldHint: false };
    server.registerTool('terrain.surface.overview', { description: 'Compact whole-surface component overview. Unknowns and missing schemas remain explicit. Character budget is NOT a token measurement.', inputSchema: z.object({ ...scope, maxChars: z.number().int().min(128).max(12000).default(6000) }).strict(), annotations }, a => run(a.directory, s => s.context(a.maxChars)));
    server.registerTool('terrain.surface.components', { description: 'Paginated component inventory with raw sizes and profile/evidence status.', inputSchema: z.object({ ...scope, offset: z.number().int().min(0).default(0), limit: z.number().int().min(1).max(50).default(20) }).strict(), annotations }, a => run(a.directory, s => { const names = s.names(); return { total: names.length, items: names.slice(a.offset, a.offset + a.limit).map(n => s.inspect(n)), nextOffset: a.offset + a.limit < names.length ? a.offset + a.limit : null }; }));
    server.registerTool('terrain.surface.component.inspect', { description: 'Inspect one component, optionally one bounded array page. Never interprets raw paint as final passability.', inputSchema: z.object({ ...scope, component: z.string().min(1).max(1024), section: z.enum(['cliffCells', 'ramps', 'cliffSets', 'textures', 'textureSets', 'blockTextureSets', 'cliffDoodads', 'zones', 'bodies', 'entries', 'doodads', 'textureNames', 'indices']).optional(), offset: z.number().int().min(0).default(0), limit: z.number().int().min(1).max(20).default(5) }).strict(), annotations }, a => run(a.directory, s => { const summary = s.inspect(a.component); if (!a.section)
        return summary; const m = s.model(a.component) as Record<string, unknown> | undefined, rows = m?.[a.section]; if (!Array.isArray(rows))
        return { summary, sectionUnavailable: true }; return { summary, section: a.section, total: rows.length, rows: rows.slice(a.offset, a.offset + a.limit), nextOffset: a.offset + a.limit < rows.length ? a.offset + a.limit : null }; }));
    server.registerTool('terrain.surface.height.sample', { description: 'Sample raw HMAP vertex channels and world-height candidates; reports non-unit scale formula conflicts.', inputSchema: z.object({ ...scope, ...coordinate }).strict(), annotations }, a => run(a.directory, s => s.sampleHeight(a.x, a.y)));
    server.registerTool('terrain.surface.texture.sample', { description: 'Eight raw 4-bit weights at a MASK pixel, not world-space coordinates. Does not infer a rendered material.', inputSchema: z.object({ ...scope, ...coordinate }).strict(), annotations }, a => run(a.directory, s => s.sampleMask(a.x, a.y)));
    server.registerTool('terrain.surface.paint.sample', { description: 'Read two physical paint bytes. No lookup table / passability claim.', inputSchema: z.object({ ...scope, ...coordinate, layer: z.enum(['pathing', 'creep']) }).strict(), annotations }, a => run(a.directory, s => s.samplePaint(a.layer === 'pathing' ? 'paintedpathinglayer' : 'paintedcreeplayer', a.x, a.y)));
    server.registerTool('terrain.surface.bytes', { description: 'Bounded hex slice for verifying an exact component offset.', inputSchema: z.object({ ...scope, component: z.string().min(1).max(1024), offset: z.number().int().min(0), length: z.number().int().min(0).max(4096).default(128) }).strict(), annotations }, a => run(a.directory, s => s.rawRange(a.component, a.offset, a.length)));
    server.registerTool('terrain.surface.validate', { description: 'Structural/profile checks only. SC2 Editor, multiplayer determinism, mesh, shader and navigation validation are NOT performed.', inputSchema: z.object(scope).strict(), annotations }, a => run(a.directory, s => s.consistency()));
    server.registerTool('terrain.surface.plan.cell', { description: 'Preview one bounded RAW edit in memory. Does not stage or save. Lists dependent layers needing Editor regeneration; never an engine-validity certificate.', inputSchema: z.object({ ...scope, edit }).strict(), annotations }, a => run(a.directory, s => planSummary(planCellEdit(s, a.edit as CellEdit))));
    server.registerTool('terrain.surface.catalog.inspect', {
        description: 'Inspect authored terrain catalog records, tokens, raw references, sparse CliffHeights and symbolic HeightCodes. Does not resolve inheritance, dependency order, CASC or assets.',
        inputSchema: z.object({ file: z.string().min(1).max(1024), id: z.string().max(512).optional(), type: z.string().max(128).optional(),
            offset: z.number().int().min(0).default(0), limit: z.number().int().min(1).max(20).default(5),
            bindings: z.record(z.string().max(128), z.string().max(8192)).refine(v => Object.keys(v).length <= 32, 'At most 32 bindings').default({}) }).strict(), annotations,
    }, async args => {
        try { return response(await new TerrainSurfaceWorkspace(context.workspace.workspace).catalog(args.file, args)); }
        catch (error) { return response({ error: error instanceof Error ? error.message : String(error) }, true); }
    });
}
