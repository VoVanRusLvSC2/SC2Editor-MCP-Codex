import type {StandardMaterial, SurfaceMaterial} from './types.js';

export interface PreviewMaterialSample {properties:Record<string,number|number[]>;alpha:number}

/** Serializable native material corrections and bounded preview policies.
 * Hair coverage and composite merging remain approximations, not native pass rules.
 * Source materials and native animation IDs remain untouched. */
export function createMaterialPreviewAdapter(){
    const nativeMaterials=new WeakMap<StandardMaterial,StandardMaterial>();
    const cutouts=new WeakMap<StandardMaterial,StandardMaterial>();
    const plans=new WeakMap<SurfaceMaterial,ReturnType<typeof build>>();
    const path=(value:string)=>value.toLowerCase().replaceAll('\\','/');
    function nativeMaterial(source:StandardMaterial){
        // Base98310 141f751d0: MAT flags+10 bit11 feeds BOTH
        // b_iFakeEnergyConservingSpec and b_iBlurEnvironmentMap, without inversion.
        // Older imported models derived the first boolean backwards. Raw flags
        // take precedence; keep unknown/specialized/PBR material families intact.
        const flags=source.sourceFlags;
        if(source.materialClass!==0||source.lightingModel==='pbr-metallic-roughness'||
            typeof flags!=='number'||!Number.isInteger(flags)||flags<0||flags>0xffffffff)return source;
        const enabled=(flags&0x800)!==0;
        // Base98310 141f75a9d / 141f75afe upload raw MAT bits2/27 to
        // b_iNormalBlending / b_iNormalBlendingEnableMask2. NormalBlending
        // sums the enabled masks, clamps to [-1,1], then chooses detail1 for
        // a negative result or detail2 otherwise, with squared magnitude.
        // In particular, a missing second mask must not add the legacy
        // default +1 and replace the result with detail2 at full weight.
        const slots=['normalBlend1','normalBlend2','normalBlend1Mask','normalBlend2Mask'];
        const hasDetail=slots.some(slot=>source.layers[slot]!==undefined);
        const blending=(flags&4)!==0,secondMask=(flags&0x08000000)!==0;
        const present=(slot:string)=>{const l=source.layers[slot];return !!(l&&(l.texturePath||l.constantColor));};
        // Missing detail samplers/first mask need their native disabled-layer
        // defaults; keep that unqualified input on its previous route.
        const signed=blending&&present('normalBlend1')&&present('normalBlend2')&&present('normalBlend1Mask')&&
            (!secondMask||present('normalBlend2Mask'));
        const strip=!blending&&(hasDetail||source.normalBlendPolicy!==undefined);
        const policyMatches=!signed||source.normalBlendPolicy?.mode==='signed-two-detail'&&source.normalBlendPolicy.secondMask===secondMask;
        if(source.specularEnergyConservation===enabled&&!strip&&policyMatches)return source;
        let result=nativeMaterials.get(source);
        if(!result){
            result={...source,specularEnergyConservation:enabled};
            if(strip){
                result.layers={...source.layers};for(const slot of slots)delete result.layers[slot];
                delete result.normalBlendPolicy;
            }else if(signed)result.normalBlendPolicy={mode:'signed-two-detail',secondMask};
            nativeMaterials.set(source,result);
        }
        return result;
    }
    function material(source:StandardMaterial,name:string){
        source=nativeMaterial(source);
        const alpha=source.layers.alpha1,diffuse=source.layers.diffuse;
        // A token or camel-case Hair component excludes names such as "chair".
        const hair=/(?:^|[^a-z])hair/i.test(name)||/[a-z]Hair/.test(name);
        if(!hair||source.blendMode!==1||source.alphaTestThreshold!==0||!source.twoSided||source.usesVertexAlpha||
            source.lightingModel==='pbr-metallic-roughness'||source.materialClass!==undefined&&source.materialClass!==0||
            !alpha?.texturePath||!diffuse?.texturePath||alpha.channels!==2||alpha.invert||
            path(alpha.texturePath)!==path(diffuse.texturePath))return source;
        let result=cutouts.get(source);
        if(!result){result={...source,blendMode:0,alphaTestThreshold:.3};cutouts.set(source,result);}
        return result;
    }
    function build(surface:SurfaceMaterial|undefined,defaults:StandardMaterial){
        const passes=(surface?.composite?.passes??[{material:surface?.standard??defaults}]).map(pass=>({...pass,material:material(pass.material,surface?.name??'')}));
        const [base,detail]=passes;
        const keys=detail?Object.keys(detail.material.layers):[];
        const plainAlpha=(pass:typeof base)=>[pass.alpha,pass.alphaFactor].every(value=>!value||
            value.value===1&&!value.ref&&!('track' in value&&value.track)&&!value.sequenceTracks?.length);
        const compatible=surface?.metadata?.sourceMaterialTag==='CMP_'&&passes.length===2&&base.material.layers.diffuse&&
            base.material.blendMode===0&&detail.material.blendMode===0&&!detail.material.unshaded&&
            base.material.lightingModel!=='pbr-metallic-roughness'&&detail.material.lightingModel!=='pbr-metallic-roughness'&&
            (base.material.materialClass===undefined||base.material.materialClass===0)&&(detail.material.materialClass===undefined||detail.material.materialClass===0)&&
            !detail.material.usesVertexAlpha&&!detail.material.alphaTestThreshold&&plainAlpha(base)&&plainAlpha(detail)&&
            keys.length>0&&keys.every(key=>(key==='envi'||key==='height')&&!base.material.layers[key]);
        // Cache by the complete surface, not the shared base material: different
        // reflection textures/detail layers must never reuse another surface's merge.
        const merged:StandardMaterial|undefined=compatible?{...base.material,layers:{...base.material.layers,...detail.material.layers},
            ...(detail.material.parallaxHeight!==undefined?{parallaxHeight:detail.material.parallaxHeight}:{})}:undefined;
        return {passes,merged,detailSlots:merged?keys:[]};
    }
    function plan(surface:SurfaceMaterial|undefined,defaults:StandardMaterial){
        if(!surface)return build(surface,defaults);
        let result=plans.get(surface);if(!result){result=build(surface,defaults);plans.set(surface,result);}return result;
    }
    function merge(plan:ReturnType<typeof build>,samples:PreviewMaterialSample[]){
        // Pass alpha can be animated by an external M3A even when the embedded
        // alphaFactor is constant. Preserve both authored passes during that fade.
        if(!plan.merged||samples.length!==2||samples.some(sample=>sample.alpha!==1))return undefined;
        const properties={...samples[0].properties};
        if(plan.passes[1].material.parallaxHeight!==undefined)delete properties.parallaxHeight;
        for(const [key,value]of Object.entries(samples[1].properties)){
            if(key==='parallaxHeight'||plan.detailSlots.some(slot=>key.startsWith('layers.'+slot+'.')))properties[key]=value;
        }
        return {material:plan.merged,properties,alpha:1};
    }
    function shaderProperties(source:StandardMaterial,values:Record<string,number|number[]>){
        // The sampler removes disabled detail layers before applying overrides.
        // Preserve the full native property sample for UV gradients/inspection,
        // but do not address branches that are absent from this shader pass.
        const flags=source.sourceFlags;
        const nativeDisabled=source.materialClass===0&&source.lightingModel!=='pbr-metallic-roughness'&&
            typeof flags==='number'&&Number.isInteger(flags)&&flags>=0&&flags<=0xffffffff&&!(flags&4);
        let result=values;
        for(const key of Object.keys(values)){
            const parts=key.split('.');if(parts[0]!=='layers')continue;
            const slot=parts[1],detail=['normalBlend1','normalBlend2','normalBlend1Mask','normalBlend2Mask'].includes(slot);
            if(detail&&nativeDisabled||slot==='normalBlend2Mask'&&source.normalBlendPolicy?.secondMask===false){
                if(result===values)result={...values};delete result[key];
            }
        }
        return result;
    }
    return {material,plan,merge,shaderProperties};
}
