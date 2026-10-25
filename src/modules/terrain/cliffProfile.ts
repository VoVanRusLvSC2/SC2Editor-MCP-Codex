/** Measured f=1, one-level native cliff cells. Corners: LL, LR, UR, UL.
 * Output: four CLIF words in row-major order. Three high corners close the low
 * corner in the sync cells; sampling the upper-right fine vertex is incorrect.
 * Diagonal high corners use the measured all-high CLIF closure as well.
 * This profile does not establish rendered closure or rebuild engine navigation.
 */
export function nativeCliffSyncLevels(corners:readonly number[]):number[]{
 if(corners.length!==4||corners.some(v=>!Number.isInteger(v)||v<0||v>3))throw Error('NATIVE_CLIFF_CORNER_PROFILE_UNSUPPORTED');
 const lo=Math.min(...corners),hi=Math.max(...corners);
 if(lo===hi)return Array(4).fill(lo*64);
 if(lo<1||hi-lo!==1)throw Error('NATIVE_CLIFF_MULTI_LEVEL_OR_VOID_JUNCTION_UNSUPPORTED');
 const high=corners.map(v=>v===hi),count=high.filter(Boolean).length;
 const saddle=count===2&&high[0]===high[2];
 return (count===3||saddle?Array(4).fill(hi):[corners[0],corners[1],corners[3],corners[2]]).map(v=>v*64);
}

/** One observed canonical 3x3 HMAP level pattern per supported orientation.
 * Straight edges have several native midpoint variants; choose the measured
 * high-edge variant consistently on shared edges. Coarse corners are preserved.
 */
export function nativeCliffFineLevels(corners:readonly number[]):number[]{
 nativeCliffSyncLevels(corners);
 const [ll,lr,ur,ul]=corners,lo=Math.min(...corners),hi=Math.max(...corners);
 const count=corners.filter(v=>v===hi).length,saddle=count===2&&ll===ur;
 const center=saddle?lo:count>=2?hi:lo;
 return [ll,Math.max(ll,lr),lr,Math.max(ll,ul),center,Math.max(lr,ur),ul,Math.max(ul,ur),ur];
}

/** Native saddle SMAP centers follow the high cliff closure although their
 * HMAP center retains the low level. Other positions keep the existing sampled
 * height profile; this does not claim byte identity to native edge smoothing.
 */
export function nativeCliffFineSyncLevels(corners:readonly number[]):number[]{
 const fine=nativeCliffFineLevels(corners),hi=Math.max(...corners);
 if(corners.filter(v=>v===hi).length===2&&corners[0]===corners[2])fine[4]=hi;
 return fine;
}
