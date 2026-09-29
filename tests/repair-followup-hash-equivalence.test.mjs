// Performance (installed long-chat profile 2026-09-29): hashing turn records for checkpoints spent seconds in the
// array-based UTF-8 + SHA-256 of browser-runtime-utils. The typed-array version must give byte-identical UTF-8 and
// identical digests (hashes are persisted identities), including for lone surrogates, which TextEncoder would replace.
// The reference below is the previous implementation, verbatim.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { sha256Hex, utf8Bytes, utf8ByteLength, stableHash } from '../src/browser-runtime-utils.js';

const legacy = (() => {
function rotr(x,n){return(x>>>n)|(x<<(32-n));}
const K=[
0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
function utf8Bytes(value){const out=[];for(const ch of String(value)){const cp=ch.codePointAt(0);if(cp<=0x7f)out.push(cp);else if(cp<=0x7ff)out.push(0xc0|(cp>>6),0x80|(cp&0x3f));else if(cp<=0xffff)out.push(0xe0|(cp>>12),0x80|((cp>>6)&0x3f),0x80|(cp&0x3f));else out.push(0xf0|(cp>>18),0x80|((cp>>12)&0x3f),0x80|((cp>>6)&0x3f),0x80|(cp&0x3f));}return out;}
function utf8ByteLength(value){return utf8Bytes(value).length;}
function sha256Hex(value){const bytes=utf8Bytes(value);const bitLen=bytes.length*8;bytes.push(0x80);while(bytes.length%64!==56)bytes.push(0);const hi=Math.floor(bitLen/0x100000000),lo=bitLen>>>0;for(let i=3;i>=0;i--)bytes.push((hi>>>(i*8))&0xff);for(let i=3;i>=0;i--)bytes.push((lo>>>(i*8))&0xff);let h0=0x6a09e667,h1=0xbb67ae85,h2=0x3c6ef372,h3=0xa54ff53a,h4=0x510e527f,h5=0x9b05688c,h6=0x1f83d9ab,h7=0x5be0cd19;const w=new Uint32Array(64);for(let offset=0;offset<bytes.length;offset+=64){for(let i=0;i<16;i++){const j=offset+i*4;w[i]=((bytes[j]<<24)|(bytes[j+1]<<16)|(bytes[j+2]<<8)|bytes[j+3])>>>0;}for(let i=16;i<64;i++){const x=w[i-15],y=w[i-2],s0=rotr(x,7)^rotr(x,18)^(x>>>3),s1=rotr(y,17)^rotr(y,19)^(y>>>10);w[i]=(w[i-16]+s0+w[i-7]+s1)>>>0;}let a=h0,b=h1,c=h2,d=h3,e=h4,f=h5,g=h6,h=h7;for(let i=0;i<64;i++){const S1=rotr(e,6)^rotr(e,11)^rotr(e,25),ch=(e&f)^((~e)&g),t1=(h+S1+ch+K[i]+w[i])>>>0,S0=rotr(a,2)^rotr(a,13)^rotr(a,22),maj=(a&b)^(a&c)^(b&c),t2=(S0+maj)>>>0;h=g;g=f;f=e;e=(d+t1)>>>0;d=c;c=b;b=a;a=(t1+t2)>>>0;}h0=(h0+a)>>>0;h1=(h1+b)>>>0;h2=(h2+c)>>>0;h3=(h3+d)>>>0;h4=(h4+e)>>>0;h5=(h5+f)>>>0;h6=(h6+g)>>>0;h7=(h7+h)>>>0;}return[h0,h1,h2,h3,h4,h5,h6,h7].map(x=>x.toString(16).padStart(8,'0')).join('');}
return { utf8Bytes, utf8ByteLength, sha256Hex };
})();

function rng(seed) { let x = seed >>> 0; return () => { x = (x * 1664525 + 1013904223) >>> 0; return x / 2 ** 32; }; }
function randomText(random, length) {
  const pools = [[0x20, 0x7e], [0x80, 0x7ff], [0x800, 0xd7ff], [0xe000, 0xfffd], [0x10000, 0x10ffff], [0xd800, 0xdfff]];
  let out = '';
  for (let i = 0; i < length; i += 1) {
    const [lo, hi] = pools[Math.floor(random() * pools.length)];
    const cp = lo + Math.floor(random() * (hi - lo + 1));
    out += cp >= 0xd800 && cp <= 0xdfff ? String.fromCharCode(cp) : String.fromCodePoint(cp);
  }
  return out;
}

test('UTF-8 bytes, byte length and SHA-256 are identical to the previous implementation', () => {
  const random = rng(7);
  const samples = ['', 'abc', 'é', '€', '😀', '\uD800', '\uDC00', 'a\uD800b', '\uDC00\uD800', '😀\uD83D', 'x'.repeat(55), 'x'.repeat(56), 'x'.repeat(63), 'x'.repeat(64), 'x'.repeat(119), 123, null, undefined, { a: 1 }];
  for (let i = 0; i < 400; i += 1) samples.push(randomText(random, Math.floor(random() * 300)));
  for (const value of samples) {
    assert.deepEqual(utf8Bytes(value), legacy.utf8Bytes(value), JSON.stringify(String(value)).slice(0, 40));
    assert.equal(utf8ByteLength(value), legacy.utf8ByteLength(value));
    assert.equal(sha256Hex(value), legacy.sha256Hex(value));
  }
  // And both agree with a reference SHA-256 on well-formed text.
  for (const value of ['', 'abc', 'Akira guards the blade. 😀 é €', 'x'.repeat(1000)]) assert.equal(sha256Hex(value), createHash('sha256').update(value, 'utf8').digest('hex'));
  assert.equal(stableHash({ b: 1, a: ['\uD800', 2] }), legacy.sha256Hex(JSON.stringify({ a: ['\uD800', 2], b: 1 })));
});

test('hashing a large record is fast', () => {
  const text = JSON.stringify(Array.from({ length: 2000 }, (_, i) => ({ id: 'candidate:' + i, text: 'Akira guards the blade near the north gate. '.repeat(4) })));
  const started = performance.now();
  for (let i = 0; i < 5; i += 1) sha256Hex(text);
  const elapsed = (performance.now() - started) / 5;
  assert.ok(elapsed < 60, 'about ' + Math.round(elapsed) + ' ms per ' + Math.round(text.length / 1024) + ' KB');
});
