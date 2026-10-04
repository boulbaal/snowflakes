#!/usr/bin/env python3
"""Vult Snowflakes met de sneeuwvlokfoto's van Wilson Bentley (1865-1931), publiek domein.

Bron: Wikimedia Commons, categorie "Wilson Bentley Snow Crystals". We nemen alleen
bestanden met licentie "Public domain", "No restrictions" of "CC0"; de rest (bv. CC BY-SA)
slaan we over. Elke foto wordt verkleind (max 1600 px, klein 480 px) en opnieuw als JPEG
opgeslagen zonder metadata, en via POST /api/seed ingeladen met naamsvermelding en bronlink.

Gebruik (op een pc met internet):
  SEED_TOKEN=... python3 tools/seed_bentley.py https://snowflakes.vanali.workers.dev
De server slaat dezelfde bron nooit twee keer op, dus opnieuw draaien kan geen kwaad.
"""
import io, json, os, sys, time, urllib.parse, urllib.request, uuid
from PIL import Image

API = 'https://commons.wikimedia.org/w/api.php'
UA = 'SnowflakesSeed/1.0 (https://github.com/boulbaal/snowflakes)'
CATEGORIE = 'Category:Wilson_Bentley_Snow_Crystals'
VRIJ = {'Public domain', 'No restrictions', 'CC0'}
CREDIT = 'Wilson Bentley · public domain'


def haal(url, data=None, headers=None, pogingen=4):
    for i in range(pogingen):
        try:
            req = urllib.request.Request(url, data=data, headers={'User-Agent': UA, **(headers or {})})
            with urllib.request.urlopen(req, timeout=60) as r:
                return r.status, r.read()
        except urllib.error.HTTPError as e:
            if e.code < 500 and e.code != 429:
                return e.code, e.read()
        except Exception:
            pass
        time.sleep(2 * (i + 1))
    raise RuntimeError('mislukt: ' + url)


def bestanden():
    params = {
        'action': 'query', 'format': 'json', 'generator': 'categorymembers', 'gcmtitle': CATEGORIE,
        'gcmtype': 'file', 'gcmlimit': '200', 'prop': 'imageinfo', 'iiprop': 'url|size|extmetadata|mime',
        'iiurlwidth': '1600', 'iiextmetadatafilter': 'LicenseShortName',
    }
    uit = []
    while True:
        _, body = haal(API + '?' + urllib.parse.urlencode(params))
        d = json.loads(body)
        for p in d.get('query', {}).get('pages', {}).values():
            ii = (p.get('imageinfo') or [{}])[0]
            lic = ii.get('extmetadata', {}).get('LicenseShortName', {}).get('value', '')
            uit.append({'titel': p['title'], 'licentie': lic, 'mime': ii.get('mime'),
                        'url': ii.get('thumburl') or ii.get('url'), 'bron': ii.get('descriptionurl')})
        if 'continue' not in d:
            return uit
        params.update(d['continue'])


def jpeg(im, max_px, max_bytes):
    im = im.copy()
    im.thumbnail((max_px, max_px), Image.LANCZOS)
    for q in (88, 82, 75, 68, 60):
        b = io.BytesIO()
        im.save(b, 'JPEG', quality=q, optimize=True)   # zonder exif=: geen metadata
        if b.tell() <= max_bytes:
            return b.getvalue()
    raise ValueError('te groot')


def multipart(velden):
    grens = uuid.uuid4().hex
    delen = []
    for naam, waarde in velden.items():
        if isinstance(waarde, bytes):
            delen.append(f'--{grens}\r\nContent-Disposition: form-data; name="{naam}"; filename="{naam}.jpg"\r\nContent-Type: image/jpeg\r\n\r\n'.encode() + waarde + b'\r\n')
        else:
            delen.append(f'--{grens}\r\nContent-Disposition: form-data; name="{naam}"\r\n\r\n{waarde}\r\n'.encode())
    delen.append(f'--{grens}--\r\n'.encode())
    return b''.join(delen), 'multipart/form-data; boundary=' + grens


def main():
    site = (sys.argv[1] if len(sys.argv) > 1 else '').rstrip('/')
    token = os.environ.get('SEED_TOKEN', '')
    if not site or len(token) < 32:
        sys.exit('gebruik: SEED_TOKEN=... python3 tools/seed_bentley.py https://snowflakes.vanali.workers.dev')
    lijst = bestanden()
    vrij = [b for b in lijst if b['licentie'] in VRIJ and b['mime'] in ('image/jpeg', 'image/png', 'image/tiff') and b['url']]
    print(f'{len(lijst)} bestanden, {len(vrij)} vrij te gebruiken')
    nieuw = al = fout = 0
    for i, b in enumerate(vrij, 1):
        try:
            _, ruw = haal(b['url'])
            im = Image.open(io.BytesIO(ruw)).convert('RGB')
            if min(im.size) < 200:
                print('  te klein:', b['titel']); continue
            data, ctype = multipart({'full': jpeg(im, 1600, 1_450_000), 'thumb': jpeg(im, 480, 190_000),
                                     'credit': CREDIT, 'source': b['bron']})
            status, body = haal(site + '/api/seed', data=data,
                                headers={'Authorization': 'Bearer ' + token, 'Content-Type': ctype})
            antwoord = json.loads(body or b'{}')
            if status == 201: nieuw += 1
            elif status == 200 and antwoord.get('existing'): al += 1
            else:
                fout += 1; print('  fout', status, antwoord, b['titel'])
        except Exception as e:
            fout += 1; print('  fout', e, b['titel'])
        if i % 10 == 0:
            print(f'  {i}/{len(vrij)}')
        time.sleep(0.4)   # vriendelijk voor Wikimedia
    print(f'klaar: {nieuw} nieuw, {al} stonden er al, {fout} mislukt')


if __name__ == '__main__':
    main()
