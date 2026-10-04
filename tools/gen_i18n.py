#!/usr/bin/env python3
"""Maakt public/i18n.js uit tools/i18n/<taal>.json (+ de gedeelde doneerteksten).
Engels is de basis: elke taal moet dezelfde sleutels en {plaatshouders} hebben."""
import json, os, re, sys
HIER = os.path.dirname(os.path.abspath(__file__))
TALEN = [('en','English',False),('nl','Nederlands',False),('fr','Français',False),('de','Deutsch',False),('es','Español',False),
 ('pt','Português',False),('pl','Polski',False),('uk','Українська',False),('ru','Русский',False),('tr','Türkçe',False),
 ('ar','العربية',True),('ur','اردو',True),('hi','हिन्दी',False),('bn','বাংলা',False),('id','Bahasa Indonesia',False),
 ('vi','Tiếng Việt',False),('zh','中文',False),('ja','日本語',False),('ko','한국어',False),('sw','Kiswahili',False),
 ('zgh','ⵜⴰⵎⴰⵣⵉⵖⵜ',False),('ku','Kurdî',False),('sn','chiShona',False)]
gedeeld = json.load(open(os.path.join(HIER, 'i18n', '_gedeeld.json'), encoding='utf-8'))
teksten = {}
for code, _, _ in TALEN:
    p = os.path.join(HIER, 'i18n', code + '.json')
    if not os.path.exists(p):
        continue
    d = json.load(open(p, encoding='utf-8'))
    d.update(gedeeld[code])
    teksten[code] = d
en = teksten['en']
plaats = lambda v: sorted(set(re.findall(r'\{\w+\}', json.dumps(v, ensure_ascii=False))))
fouten = []
for code, d in teksten.items():
    for k in en:
        if k not in d: fouten.append(f'{code}: mist {k}')
        elif plaats(d[k]) != plaats(en[k]): fouten.append(f'{code}: {k} plaatshouders {plaats(d[k])} != {plaats(en[k])}')
    for k in d:
        if k not in en: fouten.append(f'{code}: extra {k}')
if fouten:
    print('\n'.join(fouten)); sys.exit(1)
talen = {c: ({'naam': n, 'rtl': True} if r else {'naam': n}) for c, n, r in TALEN if c in teksten}
uit = ("/* Snowflakes: talen en teksten. GEMAAKT door tools/gen_i18n.py uit tools/i18n/*.json, niet met de hand aanpassen. */\n"
       "'use strict';\n(function (root) {\n"
       f"  const TALEN = {json.dumps(talen, ensure_ascii=False, indent=2)};\n"
       f"  const TEKSTEN = {json.dumps(teksten, ensure_ascii=False, indent=2)};\n"
       "  root.SF_I18N = { TALEN, TEKSTEN };\n})(typeof self !== 'undefined' ? self : this);\n")
open(os.path.join(HIER, '..', 'public', 'i18n.js'), 'w', encoding='utf-8').write(uit)
print(len(teksten), 'talen,', len(en), 'sleutels')
