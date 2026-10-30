import type { DirectoryEntry } from '../../archive/archiveAdapter.js';

export interface PreservedFoundation {
  reason: string;
  componentSha256: Record<string, string>;
}

/** A legacy map can be repacked without pretending its opaque terrain was parsed. */
export function preserveOpaqueFoundation(
  files: DirectoryEntry[],
  issues: Array<{ severity: string; code: string; message: string }>,
  request: PreservedFoundation,
) {
  if (!request.reason.trim()) throw Error('OPAQUE_FOUNDATION_REASON_REQUIRED');
  const errors = issues.filter(issue => issue.severity === 'error');
  if (!errors.length || errors.some(issue => !(
    issue.code === 'MAPINFO_INVALID' && /^Error: UNSUPPORTED_MAPINFO_VERSION: \d+; preserve only$/.test(issue.message)
    || issue.code === 'TERRAIN_INVALID' && /^UNSUPPORTED_RTXT_VERSION: \d+$/.test(issue.message)
  ))) throw Error('OPAQUE_FOUNDATION_ONLY_UNSUPPORTED_VERSIONS');
  const components = files.filter(file => ['MapInfo', 'Objects', 'Objects.version', 'Preload.xml', 'ComponentList.SC2Components'].includes(file.file) || /^t3[^/]*$/.test(file.file) || /^Terrain(?:\.|$)/.test(file.file));
  const expected = request.componentSha256;
  if (!components.some(file => file.file === 'MapInfo') || !components.some(file => file.file === 't3Terrain.xml')
    || Object.keys(expected).length !== components.length
    || components.some(file => expected[file.file] !== file.sha256))
    throw Error('OPAQUE_FOUNDATION_HASH_MISMATCH: pin every original MapInfo/terrain component');
  return { reason: request.reason, components, parsed: false, nativeValidation: 'NOT_EXECUTED' };
}
