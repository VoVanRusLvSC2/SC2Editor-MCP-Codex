import type {DataDiagnostic,DataValidationReport} from './types.js';

/** Preserve only an identical finding on an untouched catalog. A baseline is
 * evidence of an existing defect, never an all-clear validation result. */
export function partitionExistingDataErrors(before:DataValidationReport,after:DataValidationReport,unchangedFiles:ReadonlySet<string>){
 const key=(d:DataDiagnostic)=>JSON.stringify([d.file,d.path,d.code,d.message,d.level,d.reference]);
 const baseline=new Set(before.diagnostics.filter(d=>d.severity==='error').map(key));
 const errors=after.diagnostics.filter(d=>d.severity==='error');
 const retained=errors.filter(d=>unchangedFiles.has(d.file)&&baseline.has(key(d)));
 const retainedKeys=new Set(retained.map(key));
 return {retained,blocking:errors.filter(d=>!retainedKeys.has(key(d)))};
}
