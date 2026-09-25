import { PRODUCTION_SHOWCASE_01 } from './levels/productionShowcase01';
import { THE_DESCENT_CLASSIC } from './levels/theDescentClassic';

/**
 * M9.4 declarative level-card metadata (presentation only — gameplay data
 * stays in `LevelDefinition`). The level selector derives its cards from
 * this list; no UI code hardcodes `if button1 -> levelA` branches.
 * Difficulty/duration labels are descriptive UI metadata only and never
 * affect mechanics.
 */
export interface LevelCardMeta {
  /** Registry id of the `LevelDefinition` this card starts. */
  levelId: string;
  /** Short badge shown on the card (e.g. ORIGINAL M8.6 / EXPERT). */
  tag: string;
  /** One-line route description. */
  subtitle: string;
  /** Descriptive difficulty label (UI only). */
  difficulty: 'Hard' | 'Expert';
  /** Approximate successful-run duration (UI only). */
  durationLabel: string;
  /** Card accent color (CSS hex). */
  accentCss: string;
  /** Two-sentence card blurb. */
  blurb: string;
}

export const PRODUCTION_LEVEL_CARDS: readonly LevelCardMeta[] = [
  {
    levelId: THE_DESCENT_CLASSIC.id,
    tag: 'ORIGINAL M8.6',
    subtitle: 'The classic high-mobility descent',
    difficulty: 'Hard',
    durationLabel: '~123 s',
    accentCss: '#2dffc4',
    blurb: 'The original M8.6 high-mobility descent — islands, gravity, Ship and Spider. ♪ Zenith of the Path.',
  },
  {
    levelId: PRODUCTION_SHOWCASE_01.id,
    tag: 'EXPERT',
    subtitle: 'High-density 3D gravity gauntlet',
    difficulty: 'Expert',
    durationLabel: '~115 s',
    accentCss: '#b44dff',
    blurb: 'The modern high-density 3D rhythm gauntlet. ♪ Gravity Lessons.',
  },
];

/** Default selected card: the latest (evolved) production level. */
export const DEFAULT_CARD_LEVEL_ID: string = PRODUCTION_SHOWCASE_01.id;
