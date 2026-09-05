/**
 * Deterministic hashing for replay verification (M5).
 *
 * FNV-1a-shaped dual-state hash over exact binary representations — never
 * formatted decimal strings. Floats are hashed as IEEE-754 Float64 bytes in
 * EXPLICIT big-endian byte order (DataView, littleEndian=false) through a
 * REUSED scratch buffer, so per-tick state hashing stays allocation-free
 * apart from the small final digest string. The byte order is explicit in
 * code — never inferred from host endianness — so the hashed byte sequence
 * is identical on every platform.
 *
 * PRECISION NOTE: the per-byte mixing step multiplies in IEEE-754 double
 * precision and truncates with `>>> 0` — it does NOT use Math.imul's exact
 * 32-bit wrapping multiply, so these digests are NOT standard FNV-1a test
 * vectors. The algorithm is intentionally FROZEN as-is: every persisted
 * replay hash depends on its exact arithmetic, and "correcting" it to
 * Math.imul would invalidate all existing tapes and the golden fixture.
 *
 * Two independent states (different offset bases, second one folding a byte
 * rotation) are maintained in ONE pass and combined into a 16-hex-char
 * digest. This is a verification hash, NOT cryptography — no crypto
 * dependency.
 */

const FNV_PRIME = 0x01000193;
const BASIS_A = 0x811c9dc5; // standard FNV-1a 32-bit offset basis
const BASIS_B = 0x84222325; // second independent basis (arbitrary odd constant)

/** Reusable scratch: float64 -> 8 bytes via an explicit-order DataView. */
const SCRATCH = new ArrayBuffer(8);
const SCRATCH_VIEW = new DataView(SCRATCH);
const SCRATCH_BYTES = new Uint8Array(SCRATCH);

export class DeterministicHasher {
  private h1 = BASIS_A;
  private h2 = BASIS_B;
  private byteCount = 0;

  public reset(): void {
    this.h1 = BASIS_A;
    this.h2 = BASIS_B;
    this.byteCount = 0;
  }

  private mixByte(b: number): void {
    this.h1 = (this.h1 ^ b) * FNV_PRIME >>> 0;
    // Second state mixes a rotated byte so digest A != digest B materially.
    const rotated = ((b << 3) | (b >>> 5)) & 0xff;
    this.h2 = (this.h2 ^ rotated) * FNV_PRIME >>> 0;
    this.byteCount += 1;
  }

  /** Hash a float by its exact IEEE-754 Float64 bytes (big-endian order). */
  public writeFloat64(value: number): void {
    // EXPLICIT big-endian store: identical bytes on every host, no
    // native-endian assumption. Forward walk 0..7 reads MSB first.
    SCRATCH_VIEW.setFloat64(0, value, false);
    for (let i = 0; i < 8; i++) this.mixByte(SCRATCH_BYTES[i] ?? 0);
  }

  public writeInt32(value: number): void {
    // Normalizes with |0, then hashes the IEEE-754 Float64 BYTES of that
    // integer value (8 bytes, big-endian) — NOT a raw 4-byte int32 bit
    // pattern. Integers and their float64 images therefore share digests
    // (writeInt32(1) === writeFloat64(1)) by construction.
    SCRATCH_VIEW.setFloat64(0, value | 0, false);
    for (let i = 0; i < 8; i++) this.mixByte(SCRATCH_BYTES[i] ?? 0);
  }

  public writeBoolean(value: boolean): void {
    this.mixByte(value ? 1 : 0);
  }

  /** Hash a string length-prefixed, byte-wise over UTF-16 code units. */
  public writeString(value: string): void {
    this.writeInt32(value.length);
    for (let i = 0; i < value.length; i++) {
      const code = value.charCodeAt(i);
      this.mixByte(code & 0xff);
      this.mixByte((code >>> 8) & 0xff);
    }
  }

  public writeNullableString(value: string | null): void {
    if (value === null) {
      this.mixByte(0);
    } else {
      this.mixByte(1);
      this.writeString(value);
    }
  }

  /** 16-hex-char digest combining both hash states. */
  public digest(): string {
    const a = this.h1 >>> 0;
    const b = (this.h2 ^ this.byteCount) >>> 0;
    this.reset();
    return a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0');
  }
}
