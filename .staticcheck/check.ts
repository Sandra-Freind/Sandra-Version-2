import {detectRegion, extractLocalSearchIntent, unsupportedRegionReply, outOfScopeReply, greetingReply, courtesyReply, companionIdentityReply} from '../artifacts/api-server/src/lib/sandraKnowledge.ts';
const cases:any[] = [
 ['Jomtien', detectRegion('Ich bin in Jomtien')],
 ['Naklua', detectRegion('Ich bin in Naklua')],
 ['Wongamat', detectRegion('Ich suche etwas in Wongamat')],
 ['Central', detectRegion('Central Pattaya')],
 ['Pratumnak', detectRegion('Pratumnak')],
 ['Darkside', detectRegion('Darkside Pattaya')],
 ['Na Jomtien excluded', detectRegion('Na Jomtien')],
 ['Sattahip unsupported', unsupportedRegionReply('Ich brauche ein Restaurant in Sattahip')],
 ['intent pharmacy', extractLocalSearchIntent('Ich suche eine günstige Apotheke in Jomtien')],
 ['greeting', greetingReply('Hallo Sandra')],
 ['courtesy', courtesyReply('Danke')],
 ['identity', companionIdentityReply('Wer bist du?')],
];
for(const c of cases) console.log(JSON.stringify(c));
