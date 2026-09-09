/**
 * Shared server/browser limits for FAQ metadata. Depth starts at zero for the
 * root object, and the node budget includes containers and scalar values.
 */
export const FAQ_METADATA_LIMITS = Object.freeze({
  maxDepth: 8,
  maxNodes: 256,
  maxObjectKeys: 64,
  maxKeyLength: 100,
  maxStringLength: 2_000,
  maxArrayLength: 100,
  // Retains the pre-existing effective request ceiling from express.json({ limit: '1mb' }).
  maxSerializedBytes: 1 * 1_024 * 1_024
});

const messages = Object.freeze({
  METADATA_ROOT_OBJECT: 'Metadata harus berupa object JSON.',
  METADATA_PLAIN_OBJECT: 'Metadata hanya boleh memuat object JSON biasa.',
  METADATA_CYCLE: 'Metadata tidak boleh memuat referensi berulang yang membentuk siklus.',
  METADATA_DEPTH: `Kedalaman metadata maksimal ${FAQ_METADATA_LIMITS.maxDepth} tingkat.`,
  METADATA_NODES: `Metadata maksimal memuat ${FAQ_METADATA_LIMITS.maxNodes} nilai.`,
  METADATA_OBJECT_KEYS: `Setiap object metadata maksimal memiliki ${FAQ_METADATA_LIMITS.maxObjectKeys} key.`,
  METADATA_KEY_LENGTH: `Panjang key metadata maksimal ${FAQ_METADATA_LIMITS.maxKeyLength} karakter.`,
  METADATA_STRING_LENGTH: `Panjang nilai string metadata maksimal ${FAQ_METADATA_LIMITS.maxStringLength} karakter.`,
  METADATA_ARRAY_LENGTH: `Panjang array metadata maksimal ${FAQ_METADATA_LIMITS.maxArrayLength} item.`,
  METADATA_BYTES: `Ukuran metadata maksimal ${FAQ_METADATA_LIMITS.maxSerializedBytes} byte.`,
  METADATA_NUMBER: 'Metadata hanya boleh memuat angka finite.',
  METADATA_VALUE_TYPE: 'Metadata memuat tipe nilai yang tidak didukung JSON.',
  METADATA_PROPERTY: 'Metadata memuat property yang tidak didukung JSON.',
  METADATA_SERIALIZATION: 'Metadata tidak dapat diserialisasi sebagai JSON.',
  METADATA_JSON_SYNTAX: 'Metadata bukan JSON yang valid.'
});

function failure(code) {
  return { ok: false, code, message: messages[code] };
}

function hasExpectedPrototype(value, expectedPrototype) {
  try {
    return Object.getPrototypeOf(value) === expectedPrototype;
  } catch {
    return false;
  }
}

function ownKeys(value) {
  try {
    return Reflect.ownKeys(value);
  } catch {
    return null;
  }
}

function ownDescriptor(value, key) {
  try {
    return Object.getOwnPropertyDescriptor(value, key);
  } catch {
    return null;
  }
}

function validateScalar(value) {
  if (value === null || typeof value === 'boolean') return null;

  if (typeof value === 'string') {
    return value.length <= FAQ_METADATA_LIMITS.maxStringLength
      ? null
      : failure('METADATA_STRING_LENGTH');
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) ? null : failure('METADATA_NUMBER');
  }

  return failure('METADATA_VALUE_TYPE');
}

/**
 * Iteratively validates a metadata value without trusting JSON.stringify for
 * structural checks. The root and every nested object must use the standard
 * Object/Array prototype; cycles, accessors, symbols, and non-JSON values fail.
 *
 * @returns {{ok: true, value: object}|{ok: false, code: string, message: string}}
 */
export function validateFaqMetadata(value) {
  if (value === null
    || Array.isArray(value)
    || typeof value !== 'object'
    || !hasExpectedPrototype(value, Object.prototype)) {
    return failure('METADATA_ROOT_OBJECT');
  }

  const activeContainers = new WeakSet();
  const stack = [{ value, depth: 0, leave: false }];
  let nodeCount = 0;

  while (stack.length > 0) {
    const frame = stack.pop();

    if (frame.leave) {
      activeContainers.delete(frame.value);
      continue;
    }

    nodeCount += 1;
    if (nodeCount > FAQ_METADATA_LIMITS.maxNodes) {
      return failure('METADATA_NODES');
    }
    if (frame.depth > FAQ_METADATA_LIMITS.maxDepth) {
      return failure('METADATA_DEPTH');
    }

    const scalarFailure = validateScalar(frame.value);
    if (frame.value === null || typeof frame.value !== 'object') {
      if (scalarFailure) return scalarFailure;
      continue;
    }

    const isArray = Array.isArray(frame.value);
    const expectedPrototype = isArray ? Array.prototype : Object.prototype;
    if (!hasExpectedPrototype(frame.value, expectedPrototype)) {
      return failure('METADATA_PLAIN_OBJECT');
    }
    if (activeContainers.has(frame.value)) {
      return failure('METADATA_CYCLE');
    }

    const keys = ownKeys(frame.value);
    if (!keys) return failure('METADATA_PROPERTY');

    if (isArray) {
      if (frame.value.length > FAQ_METADATA_LIMITS.maxArrayLength) {
        return failure('METADATA_ARRAY_LENGTH');
      }

      for (const key of keys) {
        if (key === 'length') continue;
        if (typeof key !== 'string'
          || !/^(0|[1-9]\d*)$/.test(key)
          || Number(key) >= frame.value.length) {
          return failure('METADATA_PROPERTY');
        }
      }
    } else {
      if (keys.length > FAQ_METADATA_LIMITS.maxObjectKeys) {
        return failure('METADATA_OBJECT_KEYS');
      }
      for (const key of keys) {
        if (typeof key !== 'string') return failure('METADATA_PROPERTY');
        if (key.length > FAQ_METADATA_LIMITS.maxKeyLength) {
          return failure('METADATA_KEY_LENGTH');
        }
      }
    }

    const childValues = [];
    if (isArray) {
      for (let index = 0; index < frame.value.length; index += 1) {
        const descriptor = ownDescriptor(frame.value, String(index));
        if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) {
          return failure('METADATA_PROPERTY');
        }
        childValues.push(descriptor.value);
      }
    } else {
      for (const key of keys) {
        const descriptor = ownDescriptor(frame.value, key);
        if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) {
          return failure('METADATA_PROPERTY');
        }
        childValues.push(descriptor.value);
      }
    }

    activeContainers.add(frame.value);
    stack.push({ value: frame.value, depth: frame.depth, leave: true });
    for (let index = childValues.length - 1; index >= 0; index -= 1) {
      stack.push({
        value: childValues[index],
        depth: frame.depth + 1,
        leave: false
      });
    }
  }

  let serialized;
  try {
    serialized = JSON.stringify(value);
  } catch {
    return failure('METADATA_SERIALIZATION');
  }

  if (typeof serialized !== 'string') {
    return failure('METADATA_SERIALIZATION');
  }
  if (new TextEncoder().encode(serialized).byteLength
    > FAQ_METADATA_LIMITS.maxSerializedBytes) {
    return failure('METADATA_BYTES');
  }

  return { ok: true, value };
}

/** Parses textarea input and applies the same structural limits as the server. */
export function parseFaqMetadataInput(rawValue) {
  let input;
  try {
    input = String(rawValue ?? '').trim();
  } catch {
    return failure('METADATA_JSON_SYNTAX');
  }

  if (!input) return { ok: true, value: {} };

  let value;
  try {
    value = JSON.parse(input);
  } catch {
    return failure('METADATA_JSON_SYNTAX');
  }

  return validateFaqMetadata(value);
}

/** Returns pretty JSON for valid metadata and a safe empty object otherwise. */
export function formatFaqMetadata(value) {
  if (!validateFaqMetadata(value).ok) return '{}';

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return '{}';
  }
}
