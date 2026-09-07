import test from 'node:test';
import assert from 'node:assert/strict';
import { classifySandraPolicy, explicitOutsidePattayaReply } from './sandraPolicy';

const outsideCases = [
  'Restaurant in Bangkok',
  'Hotel in Phuket',
  'Apotheke in Chiang Mai',
  'Zahnarzt in Hua Hin',
  'Ich brauche einen Arzt in Krabi',
  'Suche ein Hotel auf Koh Samui',
];

test('explicit outside-Pattaya places are blocked before local search', () => {
  for (const message of outsideCases) {
    const decision = classifySandraPolicy(message);
    assert.equal(decision.kind, 'unsupported_region', message);
    assert.equal(decision.code, 'OUTSIDE_PATTAYA_REGION', message);
    assert.ok(decision.reply?.includes('außerhalb'), message);
  }
});

test('all six supported regions remain allowed by the central policy', () => {
  for (const region of ['Naklua', 'Wongamat', 'Central Pattaya', 'Pratumnak', 'Jomtien', 'Darkside']) {
    const decision = classifySandraPolicy(`Ich suche ein Restaurant in ${region}`);
    assert.equal(decision.kind, 'allow', region);
  }
});

test('policy priority is deterministic for emergency, entertainment and politics', () => {
  assert.equal(classifySandraPolicy('Ich bekomme keine Luft und habe starke Brustschmerzen').kind, 'emergency');
  assert.equal(classifySandraPolicy('Erzähl mir einen Witz').kind, 'blocked');
  assert.equal(classifySandraPolicy('Was gibt es politisch Neues?').kind, 'blocked');
});

test('Pattaya itself and Chonburi address wording are not falsely treated as outside', () => {
  assert.equal(explicitOutsidePattayaReply('Restaurant in Pattaya'), null);
  assert.equal(explicitOutsidePattayaReply('Adresse in Pattaya, Chonburi 20150'), null);
});
