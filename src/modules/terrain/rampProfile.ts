/** Measured cardinal B→C ramp in user-authored p.SC2Map (5.0.17.98310).
 * Native XML frame footprint: x=64..68,y=66..72, mid=(66,69), up=(-1,0).
 * Channels: adjustment world offset, HMAP level, SMAP Q8 offset; cell CLIF relative raw, hole bit.
 * Source HMAP SHA256: 397379fa9c9dfcc31efeb44661589267ef5c714a4ba1b2e01677be80421ef3ee.
 * Runtime/editor reopening is a separate test; never an engine certificate. */
export const CARDINAL_RAMP_VERTICES = [[[0,1,1],[0,1,2],[0,1,16],[0,1,5],[0,1,0]],[[1,2,438],[0.75,1,357],[0.5,1,239],[0.25,1,111],[0,1,4]],[[2,2,503],[1.5,2,385],[1,1,258],[0.5,1,131],[0,1,8]],[[2,2,504],[1.5,2,384],[1,1,256],[0.5,1,128],[0,1,8]],[[2,2,505],[1.5,2,388],[1,1,259],[0.5,1,130],[0,1,8]],[[2,2,512],[1.25,2,453],[0.5,1,273],[0.25,1,132],[0,1,10]],[[2,2,515],[1,2,444],[0,1,17],[0,1,2],[0,1,0]]] as const;
export const CARDINAL_RAMP_CELLS = [[[0,1],[0,1],[0,1],[0,1]],[[64,1],[40,1],[24,1],[8,1]],[[64,0],[40,0],[24,0],[8,0]],[[64,0],[40,0],[24,0],[8,0]],[[64,1],[40,1],[24,1],[8,1]],[[64,1],[0,1],[0,1],[0,1]]] as const;
