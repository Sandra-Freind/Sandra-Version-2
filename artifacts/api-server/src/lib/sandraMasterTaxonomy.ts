export type SandraMasterDomain = {
  id: string;
  label: string;
  terms: string[];
};

// Internal understanding vocabulary for Sandra. These are not UI menu items.
// The user should be able to ask naturally; Sandra maps the need to a Pattaya helper domain.
export const SANDRA_MASTER_TAXONOMY: SandraMasterDomain[] = [
  { id:'food', label:'Essen, Trinken & Gastronomie', terms:['restaurant','essen','frühstück','brunch','café','bäckerei','konditorei','streetfood','food court','seafood','steak','burger','pizza','vegan','vegetarisch','halal','buffet','lieferservice','catering','strandrestaurant','rooftop'] },
  { id:'shopping', label:'Geschäfte, Einkaufen & Produkte', terms:['supermarkt','markt','nachtmarkt','einkaufszentrum','kleidung','schuhe','schmuck','uhr','optiker','drogerie','haushaltswaren','möbel','matratze','baumarkt','werkzeug','elektronik','sportgeschäft','tierbedarf','blumen','gartencenter','souvenir','spielwaren','babybedarf'] },
  { id:'health', label:'Medizinische Grundversorgung', terms:['arzt','hausarzt','klinik','krankenhaus','notaufnahme','apotheke','hausbesuch','gesundheitscheck','blutuntersuchung','impfung','wundversorgung','infusion','verband'] },
  { id:'specialists', label:'Fachärzte & Spezialkliniken', terms:['internist','kardiologe','neurologe','orthopäde','chirurg','lungenarzt','pneumologe','hno','augenarzt','hautarzt','allergologe','urologe','nephrologe','gastroenterologe','endokrinologe','diabetologe','rheumatologe','onkologe','hämatologe','tropenmediziner','gynäkologe','kinderarzt','geriater','sportmediziner'] },
  { id:'dental', label:'Zahnmedizin', terms:['zahnarzt','zahnreinigung','füllung','krone','brücke','implantat','wurzelbehandlung','kieferorthopädie','zahnspange','oralchirurgie','weisheitszahn','zahnnotdienst','zahnschmerzen','prothese'] },
  { id:'diagnostics', label:'Diagnostik & Untersuchungen', terms:['röntgen','ultraschall','mrt','ct','ekg','herzultraschall','lungenfunktion','endoskopie','darmspiegelung','blutdruck','blutzucker','cholesterin','sehtest','hörtest','schlafdiagnostik','allergietest','sti test','hiv test'] },
  { id:'rehab', label:'Therapie & Rehabilitation', terms:['physiotherapie','ergotherapie','logopädie','chiropraktik','osteopathie','akupunktur','rehabilitation','reha','sportverletzung','schmerztherapie','beckenbodentraining','atemtherapie','herzrehabilitation','lungenrehabilitation'] },
  { id:'mental_health', label:'Psychische Gesundheit', terms:['psychologe','psychotherapeut','psychiater','krisenberatung','angst','panik','depression','trauma','paarberatung','trauerbegleitung','burnout','suchtberatung','selbsthilfegruppe'] },
  { id:'care', label:'Pflege & medizinische Unterstützung', terms:['häusliche krankenpflege','seniorenpflege','tagespflege','kurzzeitpflege','pflegeheim','betreutes wohnen','palliativ','hospiz','wundpflege','behindertentransport','rollstuhl','pflegebett','sauerstoffgerät','hörgerät','orthopädisches hilfsmittel'] },
  { id:'wellness', label:'Wellness, Beauty & Körperpflege', terms:['massage','thai massage','spa','sauna','onsen','wellness','friseur','barber','nagelstudio','maniküre','pediküre','kosmetik','tattoo','piercing','haarentfernung'] },
  { id:'fitness', label:'Fitness & Sport', terms:['fitnessstudio','personal trainer','krafttraining','crossfit','functional training','seniorensport','rückentraining','yoga','pilates','zumba','joggen','walking','radfahren','schwimmen','fußball','futsal','basketball','volleyball','tennis','badminton','tischtennis','squash','pickleball','padel','golf','driving range','bowling','billard','snooker','darts','muay thai','boxen','kickboxen','mma','jiu jitsu','tauchen','schnorcheln','jetski','wakeboard','wasserski','kitesurfen','kajak','stand up paddling','segeln','parasailing','angeln','kartfahren','motocross','klettern','zipline','reiten','bogenschießen'] },
  { id:'leisure', label:'Freizeit, Ausflüge & Unterhaltung', terms:['strand','insel','tagesausflug','bootstour','yacht','sonnenuntergang','sightseeing','tempel','museum','galerie','aussichtspunkt','park','botanischer garten','zoo','tierpark','aquarium','wasserpark','freizeitpark','kino','theater','show','konzert','live musik','festival','karaoke','escape room','spielhalle','gaming','e sport','kochkurs','sprachkurs','töpfern','bibliothek','familienausflug','spielplatz','regen','kostenlos unternehmen'] },
  { id:'nightlife', label:'Nachtleben & Abendunterhaltung', terms:['bar','pub','sports bar','cocktailbar','rooftop bar','beach bar','nachtclub','disco','live musik','karaoke','walking street','lk metro','soi buakhao'] },
  { id:'transport', label:'Transport, Reisen & Transfers', terms:['taxi','bolt','grab','baht bus','motorradtaxi','privater fahrer','chauffeur','minibus','busbahnhof','flughafentransfer','suvarnabhumi','don mueang','u tapao','fähre','speedboat','reisebüro','touranbieter','reiseführer','gepäcktransport'] },
  { id:'vehicle', label:'Auto, Motorrad & Fahrzeughilfe', terms:['autowerkstatt','motorradwerkstatt','reifen','batterie','ölwechsel','bremsen','fahrwerk','karosserie','lackierung','autowäsche','detailing','abschleppdienst','pannenhilfe','tankstelle','ev laden','fahrschule','führerschein','autovermietung','motorradvermietung','gebrauchtwagen','roller kaufen'] },
  { id:'home_services', label:'Handwerker, Reparatur & Hausservice', terms:['elektriker','klempner','sanitär','rohrreinigung','wasserpumpe','wasserfilter','klimaanlage','aircon','kühlschrankreparatur','waschmaschinenreparatur','tv reparatur','poolservice','poolreparatur','gartenservice','schädlingsbekämpfung','termite','schlüsseldienst','glaser','schreiner','maler','fliesenleger','maurer','dachdecker','abdichtung','renovierung','trockenbau','cctv','alarmanlage','smart home'] },
  { id:'household', label:'Haushalt & tägliche Dienstleistungen', terms:['putzfrau','haushälter','reinigung','fensterreinigung','teppichreinigung','polsterreinigung','wäscherei','waschsalon','bügelservice','chemische reinigung','schuhreparatur','schneiderei','entrümpelung','umzugshelfer','möbeltransport','lagerung','self storage','concierge','housesitting'] },
  { id:'property', label:'Immobilien & Wohnen', terms:['condo mieten','condo kaufen','haus mieten','haus kaufen','villa','poolvilla','grundstück','gewerbeimmobilie','makler','property management','mietverwaltung','juristic person','hausverwaltung','immobilienbewertung','innenarchitekt','umzug','stromanschluss','wasseranschluss'] },
  { id:'government', label:'Behörden, Visa & Aufenthalt', terms:['immigration','visum','visa','visa verlängerung','retirement','marriage visa','dtv','90 day','tm30','re entry','residence certificate','work permit','land office','amphoe','city hall','tourist police','botschaft','konsulat','dokumentbeglaubigung'] },
  { id:'legal_finance', label:'Recht, Banken, Steuern & Versicherungen', terms:['anwalt','rechtsanwalt','notarial','testament','patientenverfügung','familienrecht','erbrecht','gesellschaftsrecht','strafrecht','verkehrsrecht','steuerberater','buchhalter','krankenversicherung','reiseversicherung','autoversicherung','gebäudeversicherung','bank','geldautomat','geldwechsel','überweisung'] },
  { id:'tech', label:'Handy, Computer, Internet & Technik', terms:['handyreparatur','smartphone','display kaputt','akku','iphone service','android service','computerreparatur','laptop','mac','datenrettung','drucker','wlan','router','glasfaser','internet','sim karte','esim','mobilfunk','it support'] },
  { id:'pets', label:'Tiere & Haustiere', terms:['tierarzt','tierklinik','tiernotfall','tierfutter','tierbedarf','grooming','hundesalon','tierpension','dogsitting','catsitting','hundetrainer','tiertransport','mikrochip','tierbestattung','tierrettung','tierschutz','adoption','hundefreundlich'] },
  { id:'family', label:'Familie, Kinder & Bildung', terms:['babysitter','nanny','kindergarten','nursery','internationale schule','privatschule','sprachschule','nachhilfe','musikschule','tanzschule','schwimmunterricht','kindersport','ferienprogramm','indoor spielplatz','kindergeburtstag','babybedarf'] },
  { id:'business', label:'Arbeit, Firmen & Business Services', terms:['firmengründung','company registration','dbd','business visa','buchhaltung','payroll','unternehmensberatung','personalvermittlung','job','recruitment','coworking','meetingraum','virtuelles büro','marketing','webdesign','seo','grafikdesign','videoproduktion','druckerei'] },
  { id:'postal', label:'Post, Versand, Druck & Büroservice', terms:['post','paketdienst','kurier','paketversand','dokumentversand','spedition','fracht','copyshop','kopieren','drucken','scannen','laminieren','passfoto','visitenkarte','schild','aufkleber','stempel'] },
  { id:'events', label:'Feiern, Veranstaltungen & besondere Anlässe', terms:['eventlocation','hochzeit','hochzeitsplaner','geburtstag','jubiläum','firmenfeier','partyservice','dj','band','fotograf','videograf','blumen','dekoration','torte','veranstaltungstechnik','lichttechnik','tontechnik'] },
  { id:'social', label:'Gemeinschaft, Religion & Soziales', terms:['kirche','moschee','tempel','gemeinde','expat treffen','stammtisch','verein','hobbygruppe','seniorengruppe','ehrenamt','freiwilligenarbeit','soziales projekt'] },
  { id:'language', label:'Sprache, Übersetzung & Kommunikation', terms:['übersetzer','dolmetscher','thai deutsch','deutsch thai','medizinische übersetzung','dokumentübersetzung','thai kurs','englisch kurs','deutsch kurs'] },
  { id:'emergency', label:'Notfall & Sicherheit', terms:['notfall','unfall','polizei','tourist police','rettungsdienst','feuerwehr','pass verloren','handy gestohlen','wallet gestohlen','panne','abschleppen','tiernotfall','versicherungsschaden'] },
];

function normalizeTaxonomyText(value: string): string {
  return value.toLocaleLowerCase('de-DE').normalize('NFD').replace(/[\u0300-\u036f]/gu, '').replace(/ß/gu, 'ss');
}

function taxonomyTermMatches(text: string, term: string): boolean {
  const normalizedTerm = normalizeTaxonomyText(term).trim();
  if (!normalizedTerm) return false;
  const escaped = normalizedTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
  // Double escaping is intentional: RegExp() receives the Unicode property
  // escapes literally. Without it, "spa" matched the prefix of "spater".
  return new RegExp(`(?:^|[^\\p{L}\\p{N}])${escaped}(?=$|[^\\p{L}\\p{N}])`, 'u').test(text);
}

export function matchSandraMasterDomains(message: string): SandraMasterDomain[] {
  const text = normalizeTaxonomyText(message);
  return SANDRA_MASTER_TAXONOMY.filter(domain =>
    domain.terms.some(term => taxonomyTermMatches(text, term)),
  );
}
