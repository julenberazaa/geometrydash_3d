/**
 * Deterministic hashing for replay verification (M5).
 *
 * FNV-1a over exact binary representations — never formatted decimal strings.
 * Floats are hashed as IEEE-754 Float64 bytes in a fixed (big-endian) byte
 * order through a REUSED scratch buffer, so per-tick state hashing stays
 * allocation-free apart from the small final digest string.
 *
 * Two independent FNV-1a states (different offset bases, second one folding a
 * byte rotation) are maintained in ONE pass and combined into a 16-hex-char
 * digest. This is a verification hash, NOT cryptography — no crypto dependency.
 */

const FNV_PRIME = 0x01000193;
const BASIS_A = 0x811c9dc5; // standard FNV-1a 32-bit offset basis
const BASIS_B = 0x84222325; // second independent basis (arbitrary odd constant)

/** Reusable scratch: float64 -> 8 bytes. Shared module-level buffer. */
const SCRATCH = new ArrayBuffer(8);
const SCRATCH_F64 = new Float64Array(SCRATCH);
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
    SCRATCH_F64[0] = value;
    // DataView-free byte walk: Float64Array storage is little-endian on all
    // mainstream platforms, so read backwards for a stable big-endian order.
    for (let i = 7; i >= 0; i--) this.mixByte(SCRATCH_BYTES[i] ?? 0);
  }

  public writeInt32(value: number): void {
    // Exact int32 bit pattern via the same float scratch (|0 to normalize).
    SCRATCH_F64[0] = value | 0;
    for (let i = 7; i >= 0; i--) this.mixByte(SCRATCH_BYTES[i] ?? 0);
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

  /** 16-hex-char digest combining both FNV-1a states. */
  public digest(): string {
    const a = this.h1 >>> 0;
    const b = (this.h2 ^ this.byteCount) >>> 0;
    this.reset();
    return a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0');
  }
}
