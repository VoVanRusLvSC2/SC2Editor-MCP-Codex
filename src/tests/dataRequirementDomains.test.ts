import test from 'node:test';
import assert from 'node:assert/strict';
import { dataDomainFromType } from '../modules/data/domains.js';
import { DataDocument } from '../modules/data/document.js';

test('native requirement nodes have a distinct catalog and typed selectors', () => {
  assert.equal(dataDomainFromType('CRequirement'), 'Requirement');
  for (const suffix of ['CountUnit','CountUpgrade','And','LT','Const','Node'])
    assert.equal(dataDomainFromType('CRequirement' + suffix), 'RequirementNode');
  const doc = new DataDocument('<Catalog><CRequirement id="Gate"><NodeArray index="Use" Link="Gate"/></CRequirement><CRequirementCountUnit id="Gate"><Count Link="Gateway" State="CompleteOnly"/></CRequirementCountUnit></Catalog>');
  assert.equal(doc.resolve({domain:'Requirement',id:'Gate'}).tag, 'CRequirement');
  assert.equal(doc.resolve({domain:'RequirementNode',id:'Gate'}).tag, 'CRequirementCountUnit');
  assert.ok(doc.references().some(ref => ref.targetDomain === 'RequirementNode' && ref.value === 'Gate'));
});
