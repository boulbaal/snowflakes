// Losse onderdelen van de worker: bijnamen en JPEG-controle.
import test from 'node:test';
import assert from 'node:assert/strict';
import { bijnaamFout, bijnaamSleutel, jpegMaat, heeftExif } from '../../src/worker.js';

test('bijnamen', () => {
  assert.equal(bijnaamFout('Ali'), null);
  assert.equal(bijnaamFout('Sneeuw Vlok_2026'), null);
  assert.equal(bijnaamFout('ثلج'), null);
  assert.equal(bijnaamFout('雪の結晶'), null);
  assert.equal(bijnaamFout('ab'), 'nick_short');
  assert.equal(bijnaamFout('a'.repeat(25)), 'nick_long');
  assert.equal(bijnaamFout('<script>'), 'nick_chars');
  assert.equal(bijnaamFout(' -hoi'), 'nick_chars');
  assert.equal(bijnaamFout('admin'), 'nick_taken');
  assert.equal(bijnaamFout('ADMIN'), 'nick_taken');
  assert.equal(bijnaamFout(42), 'nick_invalid');
  assert.equal(bijnaamSleutel('  Sneeuw   VLOK '), 'sneeuw vlok');
});

// minimale JPEG-kop: SOI, (APP1 Exif), SOF0 met hoogte/breedte, SOS
function jpeg(w, h, metExif = false) {
  const delen = [0xff, 0xd8];
  if (metExif) delen.push(0xff, 0xe1, 0x00, 0x08, 0x45, 0x78, 0x69, 0x66, 0x00, 0x00);
  delen.push(0xff, 0xc0, 0x00, 0x11, 0x08, h >> 8, h & 255, w >> 8, w & 255, 0x03, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1);
  delen.push(0xff, 0xda, 0x00, 0x02, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00);
  return new Uint8Array(delen);
}
test('JPEG-maat en EXIF', () => {
  assert.deepEqual(jpegMaat(jpeg(1600, 1200)), { w: 1600, h: 1200 });
  assert.equal(jpegMaat(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0, 0, 0, 0, 0])), null);   // PNG
  assert.equal(heeftExif(jpeg(10, 10)), false);
  assert.equal(heeftExif(jpeg(10, 10, true)), true);
  assert.deepEqual(jpegMaat(jpeg(800, 600, true)), { w: 800, h: 600 });
});
