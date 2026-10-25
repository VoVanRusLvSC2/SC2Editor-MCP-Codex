import {valueNoise} from './geometry.js';
import type {Point2,TexturePattern} from './types.js';

/** World-space coherent texture mask. Threshold is a signed noise value, not
 * a promised surface-area percentage. Never depends on a zone's brush bounds. */
export function materialPatternWeight(point:Point2,pattern:TexturePattern):number {
 const x=point.x/pattern.wavelength,y=point.y/pattern.wavelength;
 const warpX=valueNoise(x*.47+19.7,y*.47-11.2,pattern.seed^0x4e61)*.6;
 const warpY=valueNoise(x*.47-37.3,y*.47+8.1,pattern.seed^0x7192)*.6;
 const u=x*.819152+y*.573576+warpX,v=-x*.573576+y*.819152+warpY;
 const value=valueNoise(u,v,pattern.seed)*.75+valueNoise(u*2.37+31.1,v*2.37-17.3,pattern.seed^0x41a7)*.25;
 const t=Math.max(0,Math.min(1,(value-pattern.threshold)/pattern.transition+.5));
 return t*t*(3-2*t);
}
