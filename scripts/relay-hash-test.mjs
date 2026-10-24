import assert from 'node:assert/strict';
import { sha256 } from '@noble/hashes/sha256';

function hex(bytes) {
  return Buffer.from(bytes).toString('hex');
}

const expectedAbc = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';
const expectedEmpty = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

assert.equal(hex(sha256('abc')), expectedAbc);
assert.equal(hex(sha256(new Uint8Array())), expectedEmpty);

const incremental = sha256.create();
incremental.update(new Uint8Array([0x61]));
incremental.update(new Uint8Array([0x62, 0x63]));
assert.equal(hex(incremental.digest()), expectedAbc);

console.log('RELAY_HASH_OK');
