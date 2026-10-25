/** Preserve the v1 execution envelope separately from native semantic evidence. */
export function nativeOutcome(value:Record<string,any>):'completed'|'failed'|'incomplete'|'pending'|'cancelled'|undefined{
 if(value.status==='CANCELLED'||value.outcome==='cancelled')return 'cancelled';
 if(value.isError===true||['FAILED','TIMED_OUT','INTERRUPTED'].includes(value.status)||value.outcome==='failed')return 'failed';
 if(value.validationPassed===null||value.nativeConfirmed===false||value.status==='NOT_CONFIRMED'||value.outcome==='incomplete')return 'incomplete';
 if(value.validationPassed===false)return 'failed';
 if(value.outcome!==undefined)return ['completed','pending'].includes(value.outcome)?value.outcome:'incomplete';
 // Historical/mocked responses have no v1 envelope. Callers retain their legacy
 // checks; new document-free operations require an explicit complete envelope.
 return undefined;
}
