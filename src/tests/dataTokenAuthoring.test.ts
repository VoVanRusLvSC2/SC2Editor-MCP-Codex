import test from 'node:test';
import assert from 'node:assert/strict';
import {DataDocument} from '../modules/data/document.js';
import {validateDataAuthoring} from '../modules/data/authoringValidation.js';

test('native inherited token attributes retain catalog type and reject typos or unresolved targets',()=>{
 const native=new DataDocument('<Catalog><CActorUnit id="GenericUnitBase"><?token id="unitName" type="CUnitLink" value=""?></CActorUnit><CUnit id="Marine"/></Catalog>');
 const before=DataDocument.create(),make=(attrs:string)=>new DataDocument('<Catalog><CActorUnit id="HeroActor" parent="GenericUnitBase" '+attrs+'/></Catalog>');
 assert.equal(native.objects()[0].tokenTypes?.unitName,'CUnitLink');
 const check=(after:DataDocument)=>validateDataAuthoring('ActorData.xml',before,after,[{file:'Native.xml',layer:'dependency',engineActive:true,document:native},{file:'ActorData.xml',layer:'workspace',engineActive:true,document:after}],[]);
 assert.equal(check(make('unitName="Marine"')).accepted,true);
 assert.ok(check(make('unitName="MissingUnit"')).diagnostics.some(d=>d.code==='DATA_AUTHOR_REFERENCE_MISSING'));
 assert.ok(check(make('unitNmae="Marine"')).diagnostics.some(d=>d.code==='DATA_AUTHOR_ATTRIBUTE_UNKNOWN'));
 assert.ok(check(new DataDocument('<Catalog><CActorUnit id="UnrelatedActor" unitName="Marine"/></Catalog>')).diagnostics.some(d=>d.code==='DATA_AUTHOR_ATTRIBUTE_UNKNOWN'));
});

test('token declarations without a default are retained; commented/CDATAd declarations do not authorize attributes',()=>{
 const doc=new DataDocument('<Catalog><CActorUnit id="Generic"><?token id="unitName" type="CUnitLink"?><!--<?token id="commented" type="CUnitLink"?>--><![CDATA[<?token id="quoted" type="CUnitLink"?>]]></CActorUnit></Catalog>');
 assert.deepEqual(doc.objects()[0].tokenTypes,{unitName:'CUnitLink'});
});
