const fs = require('fs');
const path = require('path');

// Minimal WAV: 8kHz, 16-bit mono, ~0.15 sec beep (440 Hz approximation)
const sampleRate = 8000;
const duration = 0.15;
const numSamples = Math.floor(sampleRate * duration);
const dataSize = numSamples * 2;
const headerSize = 44;
const fileSize = headerSize + dataSize;

const buffer = Buffer.alloc(headerSize + dataSize);
let offset = 0;

function writeStr(s) {
  buffer.write(s, offset);
  offset += s.length;
}
function writeU32(n) {
  buffer.writeUInt32LE(n, offset);
  offset += 4;
}
function writeU16(n) {
  buffer.writeUInt16LE(n, offset);
  offset += 2;
}

writeStr('RIFF');
writeU32(fileSize - 8);
writeStr('WAVE');
writeStr('fmt ');
writeU32(16);
writeU16(1); // PCM
writeU16(1); // mono
writeU32(sampleRate);
writeU32(sampleRate * 2);
writeU16(2);
writeU16(16);
writeStr('data');
writeU32(dataSize);

for (let i = 0; i < numSamples; i++) {
  const t = i / sampleRate;
  const sample = Math.sin(2 * Math.PI * 440 * t) * 8000;
  buffer.writeInt16LE(Math.max(-32768, Math.min(32767, sample)), offset);
  offset += 2;
}

const outPath = path.join(__dirname, '..', 'src', 'assets', 'sounds', 'beep.wav');
fs.writeFileSync(outPath, buffer);
console.log('Created', outPath);
