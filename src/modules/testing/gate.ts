/** One workflow leases the retained bridges; unrelated mutable calls fail clearly. */
export class NativeWorkflowGate {
 private owner?:string;
 acquire(owner:string){if(this.owner)throw Error('NATIVE_WORKFLOW_BUSY: '+this.owner);this.owner=owner;return ()=>{if(this.owner===owner)this.owner=undefined;};}
 get busy(){return this.owner??null;}
 protect<T extends object>(bridge:T):T {
  const owner=()=>this.owner;
  return new Proxy(bridge,{get(target,key){const value=Reflect.get(target,key);if(typeof value!=='function')return value;
   return (...args:unknown[])=>{const read=key==='configuration'||key==='job'||key==='details'||key==='status'&&args[0]!==true;
    if(owner()&&!read)throw Error('NATIVE_WORKFLOW_BUSY: '+owner()+'; use project.test.status/report');
    return value.apply(target,args);
   };
  }});
 }
}
