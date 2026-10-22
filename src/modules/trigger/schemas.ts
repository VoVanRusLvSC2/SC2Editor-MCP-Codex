import * as z from 'zod/v4';
import {folderPath,organizationSchema} from './organization.js';
import { GUI_VARIABLE_TYPES, type GuiValue, type GuiCall } from './authoring.js';
const name=z.string().min(1).max(128).refine(v=>!/[\0\r\n]/.test(v),'Invalid GUI name');
const locale=z.enum(['enUS','ruRU','deDE','frFR','esES','esMX','itIT','koKR','plPL','ptBR','zhCN','zhTW']);
const translations=z.partialRecord(locale,z.string().max(16384)).refine(v=>Object.keys(v).length<=12);
export const guiValueSchema:z.ZodType<GuiValue>=z.lazy(()=>z.discriminatedUnion('kind',[
 z.object({kind:z.literal('literal'),type:z.enum(GUI_VARIABLE_TYPES),value:z.union([z.string().max(16384),z.number().finite(),z.boolean(),z.null()])}).strict(),
 z.object({kind:z.literal('variable'),library:z.string().max(128).optional(),id:name.optional(),name:name.optional(),indices:z.array(guiValueSchema).max(4).optional(),members:z.array(z.object({field:name,indices:z.array(guiValueSchema).max(4).optional()}).strict()).max(16).optional()}).strict().refine(v=>!!v.id||!!v.name,'Variable ID or name required'),
 z.object({kind:z.literal('parameter'),id:name.optional(),name:name.optional(),indices:z.array(guiValueSchema).max(4).optional(),members:z.array(z.object({field:name,indices:z.array(guiValueSchema).max(4).optional()}).strict()).max(16).optional()}).strict().refine(v=>!!v.id||!!v.name,'Parameter ID or name required'),
 z.object({kind:z.literal('preset'),id:name.optional(),name:name.optional(),library:z.string().max(128).optional(),preset:name.optional()}).strict().refine(v=>!!v.id||!!v.name,'Preset ID or name required'),
 z.object({kind:z.literal('presetBits'),preset:name,values:z.array(name).max(32),library:z.string().max(128).optional()}).strict(),
 z.object({kind:z.literal('gamelink'),domain:name,id:name}).strict(),
 z.object({kind:z.literal('unit'),objectId:z.number().int().min(1).max(0xffffffff)}).strict(),
 z.object({kind:z.literal('trigger'),id:name.optional(),name:name.optional(),library:z.string().max(128).optional()}).strict().refine(v=>!!v.id||!!v.name,'Trigger ID or name required'),
 z.object({kind:z.literal('text'),value:z.string().max(16384),translations:translations.optional()}).strict(),
 z.object({kind:z.literal('nativeCall'),function:name}).strict(),
 z.object({kind:z.literal('call'),function:name,args:z.record(z.string(),z.union([guiValueSchema,z.array(guiValueSchema).max(100)])).default({}),children:z.array(z.object({role:name,call:guiCallSchema}).strict()).max(100).optional()}).strict(),
 z.object({kind:z.enum(['block','customScript']),source:z.string().max(16384)}).strict()
]));
export const guiCallSchema:z.ZodType<GuiCall>=z.lazy(()=>z.discriminatedUnion('kind',[
 z.object({kind:z.enum(['Event','Condition','Action']),function:name,args:z.record(z.string(),z.union([guiValueSchema,z.array(guiValueSchema).max(100)])).default({}),children:z.array(z.object({role:name,call:guiCallSchema}).strict()).max(100).optional()}).strict(),
 z.object({kind:z.literal('Registration'),function:name,trigger:guiValueSchema,args:z.record(z.string(),z.union([guiValueSchema,z.array(guiValueSchema).max(100)])).default({})}).strict()
]));
const identifier=z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/).max(128);
const typed={type:z.enum(GUI_VARIABLE_TYPES),gameType:name.optional(),typeElement:z.object({type:z.enum(['Preset','Structure']).optional(),library:z.string().max(128).optional(),id:name.optional(),name:name.optional()}).strict().refine(v=>!!v.id||!!v.name).optional()};
const validType=(v:{type:string;gameType?:string;typeElement?:unknown})=>(v.type==='gamelink'?!!v.gameType:!v.gameType)&&(['preset','struct'].includes(v.type)?!!v.typeElement:!v.typeElement);
export const guiVariableSchema=z.object({name,...typed,scope:z.enum(['global','local']).default('global'),initial:guiValueSchema.optional(),constant:z.boolean().optional(),arraySizes:z.array(z.union([z.number().int().min(1).max(2147483647),z.object({variable:name,library:z.string().max(128).optional()}).strict()])).max(4).optional(),translations:translations.optional()}).strict().refine(validType,'GameType is required only for gamelink');
export const guiFunctionSchema=z.object({
 name:identifier,kind:z.enum(['Action','Condition','Event','Function']),translations:translations.optional(),flags:z.array(z.enum(['CreateThread','Hidden','NoScriptPrefix'])).max(3).optional(),grammar:z.string().max(4096).optional(),hint:z.string().max(4096).optional(),
 parameters:z.array(z.object({name:identifier,...typed,default:guiValueSchema.optional(),limits:z.string().regex(/^[^,]*,[^,]*$/).max(64).optional(),reference:z.boolean().optional(),multiple:z.boolean().optional(),variableOnly:z.boolean().optional(),preload:z.boolean().optional(),matchConstant:z.boolean().optional(),alternateDisplay:z.boolean().optional(),translations:translations.optional()}).strict().refine(validType)).max(32).default([]),
 returnType:z.object(typed).strict().refine(validType).optional(),
 variables:z.array(z.object({name:identifier,...typed,scope:z.literal('local').default('local'),initial:guiValueSchema.optional(),constant:z.boolean().optional(),arraySizes:z.array(z.union([z.number().int().min(1).max(2147483647),z.object({variable:name,library:z.string().max(128).optional()}).strict()])).max(4).optional(),translations:translations.optional()}).strict().refine(validType)).max(64).default([]),
 calls:z.array(guiCallSchema).max(100).default([]),returns:guiValueSchema.optional()
}).strict();
export const triggerPlanSchema=z.object({
 stringFiles:z.array(z.string().min(1)).max(16).optional(),targetTrigger:name.optional(),
 create:z.object({library:z.string().max(128).default(''),identifier:name,category:name.optional(),folder:folderPath.optional(),genre:organizationSchema.shape.genre.optional(),translations:translations.optional()}).strict().optional(),
 calls:z.array(guiCallSchema).max(100).default([]),
 variables:z.array(guiVariableSchema).max(64).default([]),
 functions:z.array(guiFunctionSchema).max(32).default([]),
 presets:z.array(z.object({name:identifier,baseType:z.enum(['int','fixed','bool','string']),integer:z.boolean().optional(),asBits:z.boolean().optional(),generateConstants:z.boolean().optional(),translations:translations.optional(),values:z.array(z.object({name:identifier,value:z.union([z.string().max(16384),z.number().finite(),z.boolean()]).optional(),default:z.boolean().optional(),translations:translations.optional()}).strict()).min(1).max(128)}).strict()).max(32).default([]),
 structures:z.array(z.object({name:identifier,translations:translations.optional(),fields:z.array(z.object({name:identifier,...typed,scope:z.literal('local').optional(),initial:guiValueSchema.optional(),constant:z.boolean().optional(),arraySizes:z.array(z.union([z.number().int().min(1).max(2147483647),z.object({variable:name,library:z.string().max(128).optional()}).strict()])).max(4).optional(),translations:translations.optional()}).strict().refine(validType)).min(1).max(64)}).strict()).max(32).default([])
}).strict().refine(v=>!!v.create||!!v.targetTrigger||!!v.variables?.length||!!v.functions?.length||!!v.presets?.length||!!v.structures?.length,'A trigger, variable or function declaration is required');
