import {GalaxyDocument} from './document.js';

export interface GalaxyTypeDiagnostic {severity:'error'|'warning';code:string;offset:number;message:string}
export interface GalaxySignature {name:string;returnType:string;parameters:string[]}

const primitiveTypes=new Set(['void','int','fixed','bool','string','text','char','byte']);
const numericTypes=new Set(['int','fixed','byte']);
const precedence:Record<string,number>={'||':1,'&&':2,'==':3,'!=':3,'<':4,'<=':4,'>':4,'>=':4,'+':5,'-':5,'*':6,'/':6,'%':6};
const typeOf=(raw:string)=>raw.trim().replace(/^(?:(?:const|static|native)\s+)*/,'').split(/\s+/)[0]?.replace(/\[.*$/,'')??'';
const compatible=(target:string,source:string)=>target===source||(target==='fixed'&&numericTypes.has(source))||(source==='null'&&!primitiveTypes.has(target));

function pieces(doc:GalaxyDocument,start:number,end:number):Array<[number,number]> {
  const out:Array<[number,number]>=[];let from=start;
  for(let i=start;i<end;i++){
    const value=doc.tokens[i].value;
    if(['(','[','{'].includes(value)){i=doc.pairs.get(i)??i;continue;}
    if(value===','){out.push([from,i]);from=i+1;}
  }
  if(from<end)out.push([from,end]);
  return out;
}

/** Verifies a bounded Galaxy subset. Any syntax we cannot bind is INCOMPLETE, never verified by implication. */
export function checkGalaxyTypes(doc:GalaxyDocument,natives:ReadonlyMap<string,GalaxySignature>,externals:GalaxySignature[]=[]){
  const diagnostics:GalaxyTypeDiagnostic[]=[],functions=new Map<string,GalaxySignature>();
  for(const fn of [...externals,...doc.symbols.filter(s=>s.kind==='function'||s.kind==='prototype').map(s=>({name:s.name,returnType:s.returnType??'',parameters:s.parameters??[]}))])functions.set(fn.name,fn);
  for(const [name,signature] of natives)if(!functions.has(name))functions.set(name,signature);
  const structTypes=new Set(doc.symbols.filter(s=>s.kind==='struct').map(s=>s.name));
  const globals=new Map(doc.symbols.filter(s=>s.kind==='global').map(s=>[s.name,typeOf(s.signature)]));
  const tokens=doc.tokens;
  let checked=0,unknown=0;
  const fail=(code:string,offset:number,message:string)=>diagnostics.push({severity:'error',code,offset,message});

  for(const fn of doc.symbols.filter(s=>s.kind==='function'&&s.bodyStart!==undefined)){
    const start=tokens.findIndex(t=>t.end===fn.bodyStart&&t.value==='{');
    const finish=tokens.findIndex(t=>t.start===fn.bodyEnd&&t.value==='}');
    if(start<0||finish<0){unknown++;continue;}
    const scopes:Array<Map<string,string>>=[new Map()];
    for(const raw of fn.parameters??[]){
      const name=/([A-Za-z_][A-Za-z_0-9]*)\s*(?:\[[^\]]*\])?\s*$/.exec(raw)?.[1],type=typeOf(raw);
      if(name&&type)scopes[0].set(name,type);
      else unknown++;
    }
    const declared=new Set(scopes[0].keys());
    const checkedCalls=new Set<number>();
    const variable=(name:string)=>{
      for(let level=scopes.length-1;level>=0;level--){const type=scopes[level].get(name);if(type)return type;}
      return globals.get(name);
    };
    const operator=(index:number,end:number):{value:string;length:number}|undefined=>{
      const token=tokens[index];if(!token||index>=end)return undefined;
      const next=tokens[index+1];
      if(next&&index+1<end&&token.end===next.start){
        const joined=token.value+next.value;
        if(joined in precedence||['+=','-=','*=','/=','%=','++','--'].includes(joined))return {value:joined,length:2};
      }
      return {value:token.value,length:1};
    };
    const infer=(begin:number,end:number):string|undefined=>{
      if(begin>=end)return 'void';
      let cursor=begin;
      const reportUnknown=()=>{unknown++;return undefined;};
      const parse=(minimum:number):string|undefined=>{
        const first=tokens[cursor];
        if(!first||cursor>=end)return reportUnknown();
        let left:string|undefined;
        const unary=operator(cursor,end);
        if(unary&&['!','+','-'].includes(unary.value)){
          cursor+=unary.length;
          const operand=parse(7);
          if(operand){
            if(unary.value==='!'&&operand!=='bool')fail('GALAXY_OPERATOR_TYPE',first.start,`! expects bool, got ${operand}`);
            if(unary.value!=='!'&&!numericTypes.has(operand))fail('GALAXY_OPERATOR_TYPE',first.start,`${unary.value} expects a number, got ${operand}`);
          }
          left=unary.value==='!'?'bool':operand;
        }else if(first.value==='('){
          const close=doc.pairs.get(cursor);
          if(close===undefined||close>=end){cursor=end;return reportUnknown();}
          left=infer(cursor+1,close);cursor=close+1;
        }else if(first.kind==='number'){
          left=first.value.includes('.')?'fixed':'int';cursor++;
        }else if(first.kind==='string'){
          left='string';cursor++;
        }else if(first.value==='true'||first.value==='false'){
          left='bool';cursor++;
        }else if(first.value==='null'){
          left='null';cursor++;
        }else if(first.kind==='identifier'){
          const name=first.value;cursor++;
          if(tokens[cursor]?.value==='('){
            const open=cursor,close=doc.pairs.get(open);
            if(close===undefined||close>=end){cursor=end;return reportUnknown();}
            const signature=functions.get(name);
            if(!checkedCalls.has(first.start)){
              checkedCalls.add(first.start);
              if(!signature)unknown++;
              else{
                const args=pieces(doc,open+1,close),expected=signature.parameters.map(typeOf);
                if(args.length!==expected.length)fail('GALAXY_CALL_ARITY',first.start,`${name}: expected ${expected.length}, got ${args.length}`);
                for(let arg=0;arg<args.length;arg++){
                  const actual=infer(...args[arg]);
                  if(actual&&expected[arg]&&!compatible(expected[arg],actual))fail('GALAXY_CALL_TYPE',tokens[args[arg][0]].start,`${name} argument ${arg+1}: expected ${expected[arg]}, got ${actual}`);
                }
                checked++;
              }
            }
            left=signature?.returnType;cursor=close+1;
          }else{
            left=variable(name);
            if(!left){if(declared.has(name))fail('GALAXY_SCOPE_UNBOUND',first.start,`${name} is outside its local scope`);else unknown++;}
          }
        }else{cursor++;return reportUnknown();}
        while(cursor<end){
          const op=operator(cursor,end);
          if(!op||!(op.value in precedence)||precedence[op.value]<minimum)break;
          const position=tokens[cursor].start;cursor+=op.length;
          const right=parse(precedence[op.value]+1);
          if(left&&right){
            if(['+','-','*','/','%','<','<=','>','>='].includes(op.value)&&(!numericTypes.has(left)||!numericTypes.has(right)))fail('GALAXY_OPERATOR_TYPE',position,`${op.value} expects numbers, got ${left} and ${right}`);
            if(['&&','||'].includes(op.value)&&(left!=='bool'||right!=='bool'))fail('GALAXY_OPERATOR_TYPE',position,`${op.value} expects bool, got ${left} and ${right}`);
            if(['==','!='].includes(op.value)&&!compatible(left,right)&&!compatible(right,left))fail('GALAXY_OPERATOR_TYPE',position,`${op.value} compares incompatible ${left} and ${right}`);
          }
          left=['<','<=','>','>=','==','!=','&&','||'].includes(op.value)?'bool':left&&right?(left==='fixed'||right==='fixed'?'fixed':'int'):undefined;
        }
        return left;
      };
      const result=parse(1);
      if(cursor!==end)return reportUnknown();
      return result;
    };
    const semicolon=(from:number)=>{
      let end=from;
      while(end<finish&&tokens[end].value!==';'){
        if(['(','[','{'].includes(tokens[end].value)){const close=doc.pairs.get(end);if(close!==undefined){end=close+1;continue;}}
        end++;
      }
      return end;
    };
    for(let i=start+1;i<finish;i++){
      const token=tokens[i],value=token.value;
      if(value==='{'){scopes.push(new Map());continue;}
      if(value==='}'){if(scopes.length>1)scopes.pop();continue;}
      if(['for','do','switch'].includes(value)){unknown++;continue;}
      if(value==='if'||value==='while'){
        if(tokens[i+1]?.value==='('){
          const close=doc.pairs.get(i+1);
          if(close!==undefined){
            const actual=infer(i+2,close);
            if(actual&&actual!=='bool')fail('GALAXY_CONDITION_TYPE',token.start,`${value} expects bool, got ${actual}`);
            checked++;
          }else unknown++;
        }else unknown++;
        continue;
      }
      if(value==='return'){
        const end=semicolon(i+1),actual=infer(i+1,end),expected=fn.returnType??'';
        if(actual&&expected&&!compatible(expected,actual))fail('GALAXY_RETURN_TYPE',token.start,`${fn.name}: expected ${expected}, got ${actual}`);
        checked++;i=end;continue;
      }
      const declStart=value==='const'?i+1:i;
      const typeToken=tokens[declStart],nameToken=tokens[declStart+1];
      if(typeToken&&nameToken?.kind==='identifier'&&(primitiveTypes.has(typeToken.value)||structTypes.has(typeToken.value))){
        if(tokens[declStart+2]?.value==='='||tokens[declStart+2]?.value===';'||tokens[declStart+2]?.value==='['){
          if(scopes.at(-1)!.has(nameToken.value))fail('GALAXY_SCOPE_DUPLICATE',nameToken.start,`${nameToken.value} is already declared in this scope`);
          scopes.at(-1)!.set(nameToken.value,typeToken.value);declared.add(nameToken.value);
          if(tokens[declStart+2]?.value==='[')unknown++;
          if(tokens[declStart+2]?.value==='='){
            const end=semicolon(declStart+3),actual=infer(declStart+3,end);
            if(actual&&!compatible(typeToken.value,actual))fail('GALAXY_ASSIGN_TYPE',nameToken.start,`${nameToken.value}: expected ${typeToken.value}, got ${actual}`);
            i=end;
          }else i=semicolon(declStart+2);
          checked++;continue;
        }
      }
      if(token.kind==='identifier'&&tokens[i+1]?.value==='('){
        const close=doc.pairs.get(i+1);
        if(close!==undefined&&tokens[close+1]?.value===';'){infer(i,close+1);i=close+1;continue;}
      }
      if(token.kind==='identifier'){
        const next=operator(i+1,finish),type=variable(value);
        if(next&&['=','+=','-=','*=','/=','%='].includes(next.value)){
          const end=semicolon(i+1+next.length),actual=infer(i+1+next.length,end);
          if(!type){if(declared.has(value))fail('GALAXY_SCOPE_UNBOUND',token.start,`${value} is outside its local scope`);else unknown++;}
          else if(actual){
            if(next.value==='='&&!compatible(type,actual))fail('GALAXY_ASSIGN_TYPE',token.start,`${value}: expected ${type}, got ${actual}`);
            if(next.value!=='='&&(!numericTypes.has(type)||!numericTypes.has(actual)))fail('GALAXY_OPERATOR_TYPE',token.start,`${next.value} expects numbers, got ${type} and ${actual}`);
          }
          checked++;i=end;continue;
        }
      }
      if(value==='['||value==='.'||(['+','-'].includes(value)&&tokens[i+1]?.value===value))unknown++;
    }
  }
  return {status:diagnostics.length?'REJECTED':unknown?'INCOMPLETE':'VERIFIED_SUBSET',diagnostics,checked,unknown,scope:'Bounded expression, local scope, if/while, assignment, return and pinned call types; arrays, members, for/do/switch and full Galaxy grammar remain unverified'};
}
