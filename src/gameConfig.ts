/**
 * Pixel Breaker - Game Configuration
 * All tuning numbers and gameplay constants are centralized here.
 */

export const CONFIG = {
  // Virtual Coordinate Space (9:16 portrait aspect ratio)
  CANVAS_WIDTH: 576,
  CANVAS_HEIGHT: 1024,

  // Arena Boundaries & Frame
  ARENA: {
    TOP_WALL_Y: 56, // Top boundary for ball bounce
    BOTTOM_OPEN_Y: 630, // Bottom of the indestructible gray frame (open below)
    FRAME_LEFT_X: 20, // Outer left boundary
    FRAME_RIGHT_X: 556, // Outer right boundary
    FRAME_THICKNESS: 20, // Thickness of outer frame walls (0 to 20 on left, 556 to 576 on right)
    
    // Level 1 launch chute specifics
    CHUTE_OUTER_X: 20,
    CHUTE_INNER_X: 68,
    CHUTE_WIDTH: 44,
    CHUTE_TOP_OPENING_Y: 100, // Entrance slot leading into brick field
    CHUTE_RAMP_BOTTOM_Y: 620,
  },

  // Brick Mosaic Grid inside the top ~60% box
  BRICKS: {
    COLUMNS: 50,
    ROWS: 45,
    GRID_LEFT: 76, // Left start of brick matrix
    GRID_TOP: 68, // Top start of brick matrix
    GRID_WIDTH: 472, // Total width of brick area
    GRID_HEIGHT: 530, // Total height of brick area
    BRICK_WIDTH: 8.44, // Individual brick width (~5-6px visually + padding)
    BRICK_HEIGHT: 10.7, // Individual brick height
    BRICK_GAP: 1.0, // 1px pixel separation
  },

  // Paddle Physics & Controls
  PADDLE: {
    Y: 860, // Raised from 935 for ergonomic play and thumb comfort
    HEIGHT: 14,
    BASE_WIDTH: 140, // Level 1 width
    MIN_WIDTH: 70, // Max difficulty width cap
    EXPAND_WIDTH_MULTIPLIER: 1.45,
    SHRINK_WIDTH_MULTIPLIER: 0.7,
    MOVE_SMOOTHING: 0.70, // Snappy & silky-smooth touch/mouse lerp factor
    COLOR: '#ff3700',
    GLOW_COLOR: '#ff5500',
    BORDER_COLOR: '#ffaa00',
    CORNER_RADIUS: 7,
  },

  // Ball Physics
  BALL: {
    RADIUS: 3.2,
    BASE_SPEED: 4.2, // Level 1 speed
    MAX_SPEED_CAP: 8.5, // Max difficulty speed cap
    SUB_STEPS: 4, // 4 sub-steps per frame: silky-smooth 60 FPS with zero tunneling
    COLOR: '#ffffff',
    GLOW_COLOR: '#00ffff',
    SMASH_COLOR: '#ff9900',
    SMASH_RADIUS: 5.5,
    MAX_COUNT: 150, // Optimal swarm size for high performance on both mobile & desktop
  },

  // Brick Colors & Health
  COLORS: {
    BACKGROUND: '#000000',
    ARENA_BG: '#020208',
    PLAY_AREA_BG: '#000000',
    WALL_FRAME: '#475569', // Gray indestructible frame
    WALL_FRAME_BORDER: '#64748b',
    WALL_HIGHLIGHT: '#94a3b8',
    
    // Normal Bricks by HP
    HP1: '#00c3ff', // Bright blue
    HP1_BORDER: '#38bdf8',
    HP2: '#10b981', // Emerald green
    HP2_BORDER: '#34d399',
    HP3: '#ef4444', // Bright red
    HP3_BORDER: '#f87171',
    HP4: '#a855f7', // Neon purple
    HP4_BORDER: '#c084fc',
    
    // Target Picture Bricks (Must clear all of these!)
    YELLOW: '#ffd700', // Gold yellow
    YELLOW_BORDER: '#fef08a',
    YELLOW_GLOW: '#eab308',

    // Indestructible gray blocks
    INDESTRUCTIBLE: '#6b7280',
    INDESTRUCTIBLE_BORDER: '#9ca3af',
  },

  // Difficulty Progression (n = level, 1 to Infinity)
  DIFFICULTY: {
    MAX_RAMP_LEVELS: 500, // t = min(1, (n - 1) / 499)
    BASE_DROP_RATE: 0.08, // 8% at level 1
    MIN_DROP_RATE: 0.02, // 2% at level 500+
    SECRET_BONUS_RATE: 0.025, // 2.5% chance a brick hides a secret bonus
    BAD_POWERUP_START_LEVEL: 301,
    MAX_BAD_POWERUP_SHARE: 0.30, // 30% of drops from level 301+
    BOSS_INTERVAL: 25, // Every 25th level is a boss level
    BOSS_TIME_LIMIT: 90, // 90 seconds
    REGEN_INTERVAL_SECONDS: 4.5, // Level 151+ regenerating bricks
  },

  // Power-up Tuning
  POWERUPS: {
    FALL_SPEED: 2.2,
    ORB_RADIUS: 10,
    DURATION_SMASH: 5.0, // 5 seconds
    DURATION_WIDE: 10.0, // 10 seconds
    DURATION_SLOW: 8.0, // 8 seconds
    DURATION_REVERSE: 5.0, // 5 seconds (bad)
    DURATION_FAST: 7.0, // 7 seconds (bad)
    DURATION_SHRINK: 8.0, // 8 seconds (bad)
    LASER_BEAM_WIDTH: 24,
    LASER_DURATION: 0.4,
  },

  // Visual Effects
  FX: {
    MAX_PARTICLES: 350,
    SHAKE_DECAY: 0.88,
    MAX_SHAKE: 16,
  },

  // Scoring
  SCORE: {
    BRICK_BASE: 10,
    YELLOW_BRICK_BASE: 25,
    MULTI_HP_BONUS: 15,
    POWERUP_BONUS: 50,
    LEVEL_CLEAR_BASE: 1000,
  },

  // Audio settings
  AUDIO: {
    MASTER_VOLUME: 0.65,
  },
} as const;

export type PowerUpType =
  | 'triple' // Cyan "x3": triples all balls
  | 'life' // Pink heart: +1 life
  | 'smash' // Orange star: big smash ball for 5s
  | 'wide' // Green "<->": wider paddle for 10s
  | 'slow' // Lime "-3": slower balls for 8s
  | 'laser' // Purple laser: destroys vertical column
  // Bad power-ups (Level 301+)
  | 'shrink' // Bad: narrower paddle
  | 'fast' // Bad: faster balls
  | 'reverse'; // Bad: reverse left/right touch
