import assert from 'node:assert/strict';
import test from 'node:test';
import {
  FAQ_METADATA_LIMITS,
  formatFaqMetadata,
  parseFaqMetadataInput,
  validateFaqMetadata
} from '../public/admin/faq-metadata.js';

function assertRejected(value, expectedCode) {
  const result = validateFaqMetadata(value);
  assert.equal(result.ok, false);
  assert.equal(result.code, expectedCode);
  assert.equal(typeof result.message, 'string');
  assert.ok(result.message.length > 0);
}

test('metadata limits diekspor sebagai integer positif dan tidak dapat dimutasi', () => {
  assert.equal(Object.isFrozen(FAQ_METADATA_LIMITS), true);
  assert.deepEqual(Object.keys(FAQ_METADATA_LIMITS), [
    'maxDepth',
    'maxNodes',
    'maxObjectKeys',
    'maxKeyLength',
    'maxStringLength',
    'maxArrayLength',
    'maxSerializedBytes'
  ]);

  for (const limit of Object.values(FAQ_METADATA_LIMITS)) {
    assert.equal(Number.isSafeInteger(limit), true);
    assert.ok(limit > 0);
  }
  assert.equal(FAQ_METADATA_LIMITS.maxSerializedBytes, 1_048_576);
});

test('validator menerima root plain object dan seluruh tipe nilai JSON yang didukung', () => {
  const shared = { campus: 'utama' };
  const metadata = {
    string: 'mahasiswa 🎓',
    number: -12.5,
    boolean: true,
    nil: null,
    array: [false, 0, 'nilai', { nested: [1, 2] }],
    sharedOne: shared,
    sharedTwo: shared
  };

  assert.deepEqual(validateFaqMetadata(metadata), { ok: true, value: metadata });
});

test('validator mewajibkan root plain object dan menolak prototype non-JSON', () => {
  class MetadataRecord {}

  for (const value of [null, [], 'metadata', 1, new Date(), new MetadataRecord()]) {
    assertRejected(value, 'METADATA_ROOT_OBJECT');
  }

  assertRejected(Object.create(null), 'METADATA_ROOT_OBJECT');
  assertRejected({ nested: new Date() }, 'METADATA_PLAIN_OBJECT');
  assertRejected({ nested: Object.create(null) }, 'METADATA_PLAIN_OBJECT');
});

test('validator iteratif menolak cycle dan depth berlebih tanpa recursion overflow', () => {
  const cyclic = {};
  cyclic.self = cyclic;
  assertRejected(cyclic, 'METADATA_CYCLE');

  let atLimit = true;
  for (let depth = 0; depth < FAQ_METADATA_LIMITS.maxDepth; depth += 1) {
    atLimit = { nested: atLimit };
  }
  assert.equal(validateFaqMetadata(atLimit).ok, true);

  let farTooDeep = true;
  for (let depth = 0; depth < 10_000; depth += 1) {
    farTooDeep = { nested: farTooDeep };
  }
  assertRejected(farTooDeep, 'METADATA_DEPTH');
});

test('validator menolak node, key count, key length, string, dan array melewati batas', () => {
  const tooManyNodes = {};
  let remainingValues = FAQ_METADATA_LIMITS.maxNodes;
  let group = 0;
  while (remainingValues > 0) {
    const count = Math.min(FAQ_METADATA_LIMITS.maxArrayLength, remainingValues);
    tooManyNodes[`g${group}`] = Array.from({ length: count }, () => 0);
    remainingValues -= count;
    group += 1;
  }
  assertRejected(tooManyNodes, 'METADATA_NODES');

  const tooManyKeys = {};
  for (let index = 0; index <= FAQ_METADATA_LIMITS.maxObjectKeys; index += 1) {
    tooManyKeys[`k${index}`] = true;
  }
  assertRejected(tooManyKeys, 'METADATA_OBJECT_KEYS');

  assertRejected({
    ['k'.repeat(FAQ_METADATA_LIMITS.maxKeyLength + 1)]: true
  }, 'METADATA_KEY_LENGTH');
  assertRejected({
    value: 'x'.repeat(FAQ_METADATA_LIMITS.maxStringLength + 1)
  }, 'METADATA_STRING_LENGTH');
  assertRejected({
    values: Array.from({ length: FAQ_METADATA_LIMITS.maxArrayLength + 1 }, () => 0)
  }, 'METADATA_ARRAY_LENGTH');
});

test('validator menolak metadata yang melampaui ukuran serialized UTF-8', () => {
  const metadata = {
    values: Array.from(
      { length: FAQ_METADATA_LIMITS.maxArrayLength },
      () => '\0'.repeat(FAQ_METADATA_LIMITS.maxStringLength)
    )
  };
  assert.ok(
    new TextEncoder().encode(JSON.stringify(metadata)).byteLength
      > FAQ_METADATA_LIMITS.maxSerializedBytes
  );

  assertRejected(metadata, 'METADATA_BYTES');
});

test('validator menolak tipe non-JSON, angka non-finite, symbol key, dan property accessor', () => {
  for (const value of [
    undefined,
    () => true,
    Symbol('invalid'),
    1n,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY
  ]) {
    const expectedCode = typeof value === 'number'
      ? 'METADATA_NUMBER'
      : 'METADATA_VALUE_TYPE';
    assertRejected({ value }, expectedCode);
  }

  const symbolProperty = {};
  symbolProperty[Symbol('hidden')] = true;
  assertRejected(symbolProperty, 'METADATA_PROPERTY');

  const accessorProperty = {};
  Object.defineProperty(accessorProperty, 'value', {
    enumerable: true,
    get() {
      return true;
    }
  });
  assertRejected(accessorProperty, 'METADATA_PROPERTY');

  const nonEnumerableProperty = {};
  Object.defineProperty(nonEnumerableProperty, 'value', { value: true });
  assertRejected(nonEnumerableProperty, 'METADATA_PROPERTY');
});

test('parser memakai validator terpusat dan formatter selalu fail-safe', () => {
  assert.deepEqual(parseFaqMetadataInput('  '), { ok: true, value: {} });
  assert.deepEqual(parseFaqMetadataInput('{"audience":"mahasiswa"}'), {
    ok: true,
    value: { audience: 'mahasiswa' }
  });
  assert.equal(parseFaqMetadataInput('[]').code, 'METADATA_ROOT_OBJECT');
  assert.equal(parseFaqMetadataInput('{').code, 'METADATA_JSON_SYNTAX');

  assert.equal(formatFaqMetadata({ audience: 'mahasiswa' }), [
    '{',
    '  "audience": "mahasiswa"',
    '}'
  ].join('\n'));

  const cyclic = {};
  cyclic.self = cyclic;
  assert.equal(formatFaqMetadata(cyclic), '{}');
  assert.equal(formatFaqMetadata(new Date()), '{}');
});
