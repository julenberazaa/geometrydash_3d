/**
 * Door-gap detection (M9.6.1) — pure geometry, THREE-free.
 *
 * Maze/door readability hinges on the OPENING, not the wall: this module
 * groups same-plane `killFront` blocks into gates and computes the
 * committable gaps between them, so the renderer can frame each gap
 * (pre-attentive "go here") and the auditor can watch gap visibility.
 * No level ids, no coordinates — purely structural.
 */

export interface DoorBlockInput {
  center: { x: number; y: number; z: number };
  halfExtents: { x: number; y: number; z: number };
}

/** One gate: coplanar blocks sharing a height band. */
export interface DoorGate {
  z: number;
  y0: number;
  y1: number;
  /** Covered x intervals (sorted, merged). */
  covered: { x0: number; x1: number }[];
}

/** One committable opening inside a gate. */
export interface DoorGap {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  z: number;
}

/** Minimum gap width that counts as a lane opening (edge slivers at deck
 *  borders teeter into falls — never committable lanes). */
export const DOOR_GAP_MIN_WIDTH = 2.0;

/**
 * Corridor half-width for gap framing (single owner — LevelView and the
 * auditor share it): outermost lane plus one lane spacing of margin, so
 * edge openings read across the full playable width.
 */
export const corridorHalfWidth = (laneCenters: readonly number[]): number => {
  const laneMax = laneCenters.length > 0
    ? Math.max(...laneCenters.map((c) => Math.abs(c)))
    : 2.6;
  return laneMax + 2.8;
};

/**
 * Group wall blocks into gates: same z plane (±1.0) with overlapping
 * height bands. Returns gates sorted by z.
 */
export const groupDoorBlocks = (
  blocks: readonly DoorBlockInput[],
  zTolerance = 1.0,
): DoorGate[] => {
  const sorted = [...blocks].sort((a, b) => a.center.z - b.center.z);
  const gates: DoorGate[] = [];
  for (const b of sorted) {
    const y0 = b.center.y - b.halfExtents.y;
    const y1 = b.center.y + b.halfExtents.y;
    const x0 = b.center.x - b.halfExtents.x;
    const x1 = b.center.x + b.halfExtents.x;
    const gate = gates[gates.length - 1];
    if (
      gate !== undefined &&
      Math.abs(b.center.z - gate.z) <= zTolerance &&
      y0 <= gate.y1 &&
      y1 >= gate.y0
    ) {
      gate.y0 = Math.min(gate.y0, y0);
      gate.y1 = Math.max(gate.y1, y1);
      gate.covered.push({ x0, x1 });
    } else {
      gates.push({ z: b.center.z, y0, y1, covered: [{ x0, x1 }] });
    }
  }
  // Merge overlapping covered intervals per gate.
  for (const gate of gates) {
    gate.covered.sort((a, b) => a.x0 - b.x0);
    const merged: { x0: number; x1: number }[] = [];
    for (const iv of gate.covered) {
      const last = merged[merged.length - 1];
      if (last !== undefined && iv.x0 <= last.x1) {
        last.x1 = Math.max(last.x1, iv.x1);
      } else {
        merged.push({ ...iv });
      }
    }
    gate.covered = merged;
  }
  return gates;
};

/**
 * Openings inside a gate across the corridor span. Only gaps at least
 * DOOR_GAP_MIN_WIDTH wide count (slivers are not committable lanes).
 */
export const findDoorGaps = (gate: DoorGate, corridorHalfWidth: number): DoorGap[] => {
  const gaps: DoorGap[] = [];
  let cursor = -corridorHalfWidth;
  const push = (x0: number, x1: number): void => {
    if (x1 - x0 >= DOOR_GAP_MIN_WIDTH) {
      gaps.push({ x0, x1, y0: gate.y0, y1: gate.y1, z: gate.z });
    }
  };
  for (const iv of gate.covered) {
    push(cursor, iv.x0);
    cursor = Math.max(cursor, iv.x1);
  }
  push(cursor, corridorHalfWidth);
  return gaps;
};
