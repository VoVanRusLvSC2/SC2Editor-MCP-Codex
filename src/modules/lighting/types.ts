/** Shared native global lighting state for map and cutscene preview.
 * ambient is the effective legacy RGB fallback, including its existing HDR preview factor;
 * it is not the selected shader uniform. The environment scalar stays independent. */
export interface ColorVariation {command:number;sensitivity:number;region:number}
/** Presence records resolved native catalog metadata, including false/empty defaults. */
export interface GlobalColorization {colorize:boolean;variations:ColorVariation[]}
export interface GlobalLighting {environmentMap?:string;environmentCube?:{size:number;faces:string[];sha256:string};environmentSH?:number[][];operatorHDR?:number;colorization?:GlobalColorization;preset:string;requested?:string;found?:boolean;ambient:number[];ambientEnvironmentMultiplier?:number;directional:Array<{name:string;direction:number[];color:number[];specular:number[]}>;fogDensity:0;source?:string;parameters?:Record<string,number>}
