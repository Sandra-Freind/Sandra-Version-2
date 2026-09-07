from pathlib import Path

knowledge = Path('artifacts/api-server/src/lib/sandraKnowledge.ts')
text = knowledge.read_text(encoding='utf-8')
old = r'''    /\b(wetter|regen|temperatur|nachrichten|politik|sport(?:ergebnis)?|borsenkurs|aktienkurs|uhrzeit|wie spat|welches datum)\b/u.test(
      text,
    )'''
new = r'''    /\b(?:wetter|regen|temperatur|nachrichten|politik\w*|politisch\w*|partei\w*|bundesregierung|bundeskanzler|wahl(?:en|kampf)?|krieg\w*|geopolitik\w*|regierung\w*|prasident\w*|nato|ukraine|russland|borsenkurs|aktienkurs|uhrzeit|wie spat|welches datum)\b/u.test(
      text,
    )'''
if old not in text:
    raise SystemExit('Expected out-of-scope pattern not found')
knowledge.write_text(text.replace(old, new, 1), encoding='utf-8')

taxonomy = Path('artifacts/api-server/src/lib/sandraMasterTaxonomy.ts')
text = taxonomy.read_text(encoding='utf-8')
old = """export function matchSandraMasterDomains(message: string): SandraMasterDomain[] {\n  const text = message.toLocaleLowerCase('de-DE').normalize('NFD').replace(/[\\u0300-\\u036f]/gu,'').replace(/ß/gu,'ss');\n  return SANDRA_MASTER_TAXONOMY.filter(domain => domain.terms.some(term => text.includes(term.normalize('NFD').replace(/[\\u0300-\\u036f]/gu,'').replace(/ß/gu,'ss'))));\n}\n"""
new = """function normalizeTaxonomyText(value: string): string {\n  return value.toLocaleLowerCase('de-DE').normalize('NFD').replace(/[\\u0300-\\u036f]/gu, '').replace(/ß/gu, 'ss');\n}\n\nfunction taxonomyTermMatches(text: string, term: string): boolean {\n  const normalizedTerm = normalizeTaxonomyText(term).trim();\n  if (!normalizedTerm) return false;\n  const escaped = normalizedTerm.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&').replace(/\\s+/g, '\\\\s+');\n  return new RegExp(`(?:^|[^\\p{L}\\p{N}])${escaped}(?=$|[^\\p{L}\\p{N}])`, 'u').test(text);\n}\n\nexport function matchSandraMasterDomains(message: string): SandraMasterDomain[] {\n  const text = normalizeTaxonomyText(message);\n  return SANDRA_MASTER_TAXONOMY.filter(domain =>\n    domain.terms.some(term => taxonomyTermMatches(text, term)),\n  );\n}\n"""
if old not in text:
    raise SystemExit('Expected taxonomy matcher not found')
taxonomy.write_text(text.replace(old, new, 1), encoding='utf-8')

route = Path('artifacts/api-server/src/routes/sandra.ts')
text = route.read_text(encoding='utf-8')
old = '''  const session = sessionKey(req);\n  const originalMessage = req.body.message;\n  await hydrateSessionContext(req);'''
new = '''  const session = sessionKey(req);\n  const originalMessage = req.body.message;\n\n  // Block forbidden/general/off-scope requests before they can mutate local\n  // search state or inherit a previous local place/region.\n  const earlyUnsupportedReply = outOfScopeReply(originalMessage);\n  if (earlyUnsupportedReply) {\n    res.json({ reply: earlyUnsupportedReply, maps: [] });\n    return;\n  }\n\n  await hydrateSessionContext(req);'''
if old not in text:
    raise SystemExit('Expected chat prelude not found')
text = text.replace(old, new, 1)
old = '''  const unsupportedReply = outOfScopeReply(originalMessage);\n  if (unsupportedReply) {\n    res.json({ reply: unsupportedReply, maps: [] });\n    return;\n  }\n'''
if old not in text:
    raise SystemExit('Expected late out-of-scope block not found')
route.write_text(text.replace(old, '', 1), encoding='utf-8')

assert 'politisch\\w*' in knowledge.read_text(encoding='utf-8')
assert 'taxonomyTermMatches' in taxonomy.read_text(encoding='utf-8')
r = route.read_text(encoding='utf-8')
assert r.index('earlyUnsupportedReply') < r.index('await hydrateSessionContext(req)')
print('SANDRA_SCOPE_HARDENING_PATCH_OK')
