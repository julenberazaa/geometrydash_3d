import { describe, expect, it } from 'vitest';
import { DeterministicHasher } from '../src/replay/hash';

/**
 * M5 hardening: pinned hash byte-contract regression tests.
 *
 * The replay hashing contract is an EXPLICIT big-endian IEEE-754 byte
 * sequence hashed with a frozen (deliberately non-Math.imul) mixing step.
 * These pins were captured on the little-endian baseline BEFORE the
 * Float64Array -> DataView portability fix and verified byte-identical
 * AFTER it — any future drift in byte order, field encoding, or mixing
 * arithmetic fails here instead of silently invalidating tapes.
 * (The committed golden replay in replayGolden.test.ts is the end-to-end
 * counterpart; it must keep verifying with the fixture UNCHANGED.)
 */

const digestOf = (fn: (h: DeterministicHasher) => void): string => {
  const hasher = new DeterministicHasher();
  fn(hasher);
  return hasher.digest();
};

describe('DeterministicHasher byte contract (pinned)', () => {
  it('pins the empty digest (both offset bases, zero bytes mixed)', () => {
    expect(digestOf(() => {})).toBe('811c9dc584222325');
  });

  it('pins float64 digests, including signed zero and NaN', () => {
    expect(digestOf((h) => { h.writeFloat64(0); })).toBe('d036ce60a9cb9fc8');
    // +0 and -0 are distinct IEEE-754 values and MUST hash distinctly.
    expect(digestOf((h) => { h.writeFloat64(-0); })).toBe('1f873de034462334');
    expect(digestOf((h) => { h.writeFloat64(1); })).toBe('89b36e2030146be0');
    expect(digestOf((h) => { h.writeFloat64(-1.5); })).toBe('d10bc078729115f4');
    expect(digestOf((h) => { h.writeFloat64(Math.PI); })).toBe('bc89d46015cd1b10');
    expect(digestOf((h) => { h.writeFloat64(1e100); })).toBe('c4b8d5ef554a45a8');
    expect(digestOf((h) => { h.writeFloat64(NaN); })).toBe('a95810380f801944');
  });

  it('hashes floats as explicit big-endian IEEE-754 bytes', () => {
    // The byte contract itself, independent of the hasher: 1.0 is
    // 0x3FF0000000000000, MSB first.
    const view = new DataView(new ArrayBuffer(8));
    view.setFloat64(0, 1, false);
    expect(Array.from(new Uint8Array(view.buffer))).toEqual([0x3f, 0xf0, 0, 0, 0, 0, 0, 0]);
    // And the hasher pin above ties writeFloat64(1) to exactly those bytes.
    // A low-byte-only change must flip the digest (no byte is skipped).
    expect(digestOf((h) => { h.writeFloat64(1 + Number.EPSILON); })).not.toBe(
      digestOf((h) => { h.writeFloat64(1); }),
    );
  });

  it('pins int32 digests and documents the float64-bytes encoding', () => {
    expect(digestOf((h) => { h.writeInt32(0); })).toBe('d036ce60a9cb9fc8');
    expect(digestOf((h) => { h.writeInt32(-1); })).toBe('2e60d8a05d39d734');
    expect(digestOf((h) => { h.writeInt32(0x7fffffff); })).toBe('fef5886067bc3fe8');
    // |0 normalization happens BEFORE float64 encoding: 1.9 hashes as 1,
    // and every integer shares its float64 image's digest by construction
    // (this is 8-byte float encoding, NOT a raw 4-byte int32 pattern).
    expect(digestOf((h) => { h.writeInt32(1.9); })).toBe(digestOf((h) => { h.writeFloat64(1); }));
    expect(digestOf((h) => { h.writeInt32(1); })).toBe('89b36e2030146be0');
  });

  it('pins boolean, string, and nullable-string digests', () => {
    expect(digestOf((h) => { h.writeBoolean(true); h.writeBoolean(false); })).toBe(
      'eb741d646c1de10a',
    );
    // Empty string writes only its zero length prefix (as int32).
    expect(digestOf((h) => { h.writeString(''); })).toBe('d036ce60a9cb9fc8');
    expect(digestOf((h) => { h.writeString('abc'); })).toBe('92eca7381e3330e6');
    expect(digestOf((h) => { h.writeString('A-zµ'); })).toBe('f545807cd6535c1c');
    expect(digestOf((h) => { h.writeNullableString(null); })).toBe('050c5d2026bd5341');
    expect(digestOf((h) => { h.writeNullableString('hi'); })).toBe('94f3f7f41181b08d');
    // Null and empty-string encodings must not collide.
    expect(digestOf((h) => { h.writeNullableString(null); })).not.toBe(
      digestOf((h) => { h.writeNullableString(''); }),
    );
  });

  it('pins a mixed multi-field digest (fingerprint-shaped traffic)', () => {
    expect(
      digestOf((h) => {
        h.writeFloat64(258.5);
        h.writeInt32(42);
        h.writeBoolean(true);
        h.writeString('validation-02');
      }),
    ).toBe('8bca28b87ec2f1fb');
  });

  it('is deterministic, order-sensitive, and resets on digest()', () => {
    const writeAB = (h: DeterministicHasher): void => {
      h.writeFloat64(1);
      h.writeString('ab');
    };
    const writeBA = (h: DeterministicHasher): void => {
      h.writeString('ab');
      h.writeFloat64(1);
    };
    expect(digestOf(writeAB)).toBe(digestOf(writeAB));
    expect(digestOf(writeAB)).not.toBe(digestOf(writeBA));

    const hasher = new DeterministicHasher();
    writeAB(hasher);
    const first = hasher.digest();
    // digest() resets: re-hashing the same traffic reproduces the digest.
    writeAB(hasher);
    expect(hasher.digest()).toBe(first);
  });

  it('always emits a 16-hex-char digest', () => {
    for (const digest of [
      digestOf(() => {}),
      digestOf((h) => { h.writeFloat64(-1.5); }),
      digestOf((h) => { h.writeString('validation-02'); }),
    ]) {
      expect(digest).toMatch(/^[0-9a-f]{16}$/);
    }
  });
});
