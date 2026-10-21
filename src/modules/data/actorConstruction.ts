import type {DataObject} from './types.js';
/** Narrow observed failure: concrete native actor + a second unit Create binding.
 * Does not simulate the full native event/alias registration system. */
export function concreteActorCreateConflict(object:DataObject,parents:DataObject[]) {
 if(!['CActorUnit','CActorMissile'].includes(object.ctype)||!object.attrs.unitName)return false;
 const concrete=parents.some(p=>!p.isDefault&&p.attrs.unitName&&p.attrs.unitName!==object.attrs.unitName&&['CActorUnit','CActorMissile'].includes(p.ctype));
 return concrete&&object.fields.some(f=>f.name==='On'&&f.attrs.Terms==='UnitBirth.'+object.attrs.unitName&&f.attrs.Send==='Create'&&!f.attrs.Target);
}
