/**
 * Pixel Breaker - Core HTML5 Canvas Game Engine
 * High-performance spatial grid, sub-stepped physics, deterministic infinite procedural levels.
 */

import { CONFIG, PowerUpType } from './gameConfig';
import { PIXEL_PICTURES, rotatePattern90, mirrorPatternHorizontal, mirrorPatternVertical } from './pixelPictures';
import { gameAudio } from './gameAudio';

// Seedable PRNG (Mulberry32) for deterministic level generation
export function createPRNG(seed: number) {
  let s = Math.imul(seed ^ 0x6d2b79f5, 1);
  return function () {
    s = Math.imul(s ^ (s >>> 15), 1 | s);
    s = (s + Math.imul(s ^ (s >>> 7), 61 | s)) ^ s;
    return ((s ^ (s >>> 14)) >>> 0) / 4294967296;
  };
}

export type BrickType = 'normal' | 'yellow' | 'indestructible' | 'barrier';

export interface Brick {
  id: number;
  row: number;
  col: number;
  x: number;
  y: number;
  w: number;
  h: number;
  type: BrickType;
  hp: number;
  maxHp: number;
  color: string;
  borderColor: string;
  isYellow: boolean;
  secretBonus?: PowerUpType;
  hasGlint?: boolean;
  glintTimer?: number;
  isRegenerating?: boolean;
  regenTimer?: number;
}

export interface Ball {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  isSmash: boolean;
  trail: { x: number; y: number }[];
}

export interface PowerUpOrb {
  id: number;
  x: number;
  y: number;
  vy: number;
  radius: number;
  type: PowerUpType;
  isBad: boolean;
}

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  color: string;
  alpha: number;
  life: number;
  maxLife: number;
}

export interface FloatingText {
  id: number;
  x: number;
  y: number;
  text: string;
  color: string;
  alpha: number;
  vy: number;
  scale: number;
}

export interface LaserBeam {
  x: number;
  width: number;
  timer: number;
  maxTimer: number;
}

export interface MovingObstacle {
  x: number;
  y: number;
  w: number;
  h: number;
  vx: number;
  vy: number;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  angle?: number;
  vRot?: number;
}

export interface LevelSnapshot {
  level: number;
  bricks: Brick[];
  totalYellowBricks: number;
  isBoss: boolean;
  bossTimeRemaining: number;
}

export interface GameEngineCallbacks {
  onScoreChange: (score: number, combo: number) => void;
  onLivesChange: (lives: number) => void;
  onYellowProgress: (progressPercent: number) => void;
  onLevelWon: (stars: number, levelScore: number) => void;
  onLevelFailed: () => void;
  onLifeLost: () => void;
  onActiveEffectsChange: (effects: { smashTime: number; wideTime: number; slowTime: number; reverseTime: number }) => void;
  onBossTimerTick?: (secondsRemaining: number) => void;
  onBallCountChange?: (count: number) => void;
}

export class PixelBreakerEngine {
  // Canvas & Context
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;

  // Level & Status
  private currentLevel: number = 1;
  private isBossLevel: boolean = false;
  private bossTimer: number = 0;
  private isRunning: boolean = false;
  private isPaused: boolean = false;
  private ballOnPaddle: boolean = true;

  // Player Stats
  private lives: number = 3;
  private score: number = 0;
  private comboMultiplier: number = 1;
  private totalYellowBricks: number = 0;
  private destroyedYellowBricks: number = 0;

  // Entities
  private paddleX: number = CONFIG.CANVAS_WIDTH / 2 - CONFIG.PADDLE.BASE_WIDTH / 2;
  private targetPaddleX: number = CONFIG.CANVAS_WIDTH / 2 - CONFIG.PADDLE.BASE_WIDTH / 2;
  private paddleWidth: number = CONFIG.PADDLE.BASE_WIDTH;
  private basePaddleWidthForLevel: number = CONFIG.PADDLE.BASE_WIDTH;
  
  private balls: Ball[] = [];
  private bricks: Brick[] = [];
  private powerUps: PowerUpOrb[] = [];
  private particles: Particle[] = [];
  private floatingTexts: FloatingText[] = [];
  private laserBeams: LaserBeam[] = [];
  private obstacles: MovingObstacle[] = [];

  // Spatial Grid for O(1) high-speed collision lookups
  private spatialGrid: Map<string, Brick[]> = new Map();
  private readonly cellSize: number = 28;

  // Active Timers & Status Effects
  private smashTimer: number = 0;
  private wideTimer: number = 0;
  private slowTimer: number = 0;
  private shrinkTimer: number = 0;
  private fastTimer: number = 0;
  private reverseTimer: number = 0;
  private lifeLostFlashTimer: number = 0;
  private screenShake: number = 0;

  // Wall collision visual feedback
  private leftWallFlash: number = 0;
  private leftWallHitY: number = 0;
  private rightWallFlash: number = 0;
  private rightWallHitY: number = 0;

  // Snapshot for "Restart Same Level" on 3rd life lost
  private levelSnapshot: LevelSnapshot | null = null;
  private nextEntityId: number = 1;

  // Callbacks
  private callbacks: GameEngineCallbacks;

  constructor(canvas: HTMLCanvasElement, callbacks: GameEngineCallbacks) {
    this.canvas = canvas;
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) throw new Error('Could not get 2D canvas context');
    this.ctx = context;
    this.callbacks = callbacks;
  }

  // -------------------------------------------------------------
  // SPATIAL GRID FOR 60 FPS BRICK COLLISION
  // -------------------------------------------------------------
  private getCellKey(cx: number, cy: number): string {
    return `${cx},${cy}`;
  }

  private rebuildSpatialGrid(): void {
    this.spatialGrid.clear();
    for (const brick of this.bricks) {
      if (brick.hp <= 0) continue;
      const minCx = Math.floor(brick.x / this.cellSize);
      const maxCx = Math.floor((brick.x + brick.w) / this.cellSize);
      const minCy = Math.floor(brick.y / this.cellSize);
      const maxCy = Math.floor((brick.y + brick.h) / this.cellSize);

      for (let cx = minCx; cx <= maxCx; cx++) {
        for (let cy = minCy; cy <= maxCy; cy++) {
          const key = this.getCellKey(cx, cy);
          let list = this.spatialGrid.get(key);
          if (!list) {
            list = [];
            this.spatialGrid.set(key, list);
          }
          list.push(brick);
        }
      }
    }
  }

  // -------------------------------------------------------------
  // DETERMINISTIC LEVEL GENERATOR
  // -------------------------------------------------------------
  public loadLevel(levelNum: number): void {
    this.currentLevel = levelNum;
    this.balls = [];
    this.powerUps = [];
    this.particles = [];
    this.floatingTexts = [];
    this.laserBeams = [];
    this.obstacles = [];
    this.comboMultiplier = 1;

    // Reset status effect timers
    this.smashTimer = 0;
    this.wideTimer = 0;
    this.slowTimer = 0;
    this.shrinkTimer = 0;
    this.fastTimer = 0;
    this.reverseTimer = 0;
    this.screenShake = 0;
    this.lifeLostFlashTimer = 0;

    // Difficulty curve t = min(1, (level - 1) / 499)
    const t = Math.min(1.0, Math.max(0, (levelNum - 1) / (CONFIG.DIFFICULTY.MAX_RAMP_LEVELS - 1)));
    
    // Paddle width decreases from 140 down to 70 at max difficulty
    this.basePaddleWidthForLevel = Math.max(CONFIG.PADDLE.MIN_WIDTH, CONFIG.PADDLE.BASE_WIDTH - 70 * t);
    this.paddleWidth = this.basePaddleWidthForLevel;

    // Boss level every 25th level
    this.isBossLevel = levelNum % CONFIG.DIFFICULTY.BOSS_INTERVAL === 0;
    this.bossTimer = this.isBossLevel ? CONFIG.DIFFICULTY.BOSS_TIME_LIMIT : 0;

    // Build the bricks for this level using seeded PRNG
    this.generateLevelBricks(levelNum, t);

    // Snapshot of level for seamless reset
    this.levelSnapshot = {
      level: levelNum,
      bricks: this.bricks.map((b) => ({ ...b })),
      totalYellowBricks: this.totalYellowBricks,
      isBoss: this.isBossLevel,
      bossTimeRemaining: this.bossTimer,
    };

    // Center paddle and reset ball
    this.paddleX = CONFIG.CANVAS_WIDTH / 2 - this.paddleWidth / 2;
    this.targetPaddleX = this.paddleX;
    this.resetBallOnPaddle();

    // Trigger initial UI updates
    this.callbacks.onLivesChange(this.lives);
    this.callbacks.onScoreChange(this.score, this.comboMultiplier);
    this.callbacks.onYellowProgress(0);
    this.emitActiveEffects();
  }

  /**
   * Generates the brick matrix, chute, walls, and pixel art picture
   */
  private generateLevelBricks(level: number, t: number): void {
    const rng = createPRNG(level);
    this.bricks = [];
    this.totalYellowBricks = 0;
    this.destroyedYellowBricks = 0;

    const cols = CONFIG.BRICKS.COLUMNS;
    const rows = CONFIG.BRICKS.ROWS;
    const gridLeft = CONFIG.BRICKS.GRID_LEFT;
    const gridTop = CONFIG.BRICKS.GRID_TOP;
    const bw = CONFIG.BRICKS.BRICK_WIDTH;
    const bh = CONFIG.BRICKS.BRICK_HEIGHT;

    // 1. Select and transform the pixel art picture
    const pictureIndex = (level - 1) % PIXEL_PICTURES.length;
    let pic = PIXEL_PICTURES[pictureIndex];
    let pattern = [...pic.pattern];

    // Levels 3+ rotate/mirror deterministically to provide endless freshness
    if (level >= 3) {
      if (rng() > 0.5) pattern = mirrorPatternHorizontal(pattern);
      if (rng() > 0.6) pattern = mirrorPatternVertical(pattern);
      const rotations = Math.floor(rng() * 4);
      for (let r = 0; r < rotations; r++) {
        pattern = rotatePattern90(pattern);
      }
    }

    const picRows = pattern.length;
    const picCols = pattern[0]?.length || 16;
    // Scale for boss level (1.5x) or normal
    const scale = this.isBossLevel ? 2 : 1;
    const startRow = Math.floor((rows - picRows * scale) / 2);
    const startCol = Math.floor((cols - picCols * scale) / 2);

    // Map picture coordinates to a fast lookup set
    const yellowCells = new Set<string>();
    for (let pr = 0; pr < picRows; pr++) {
      for (let pc = 0; pc < picCols; pc++) {
        if (pattern[pr][pc] === '#') {
          for (let sr = 0; sr < scale; sr++) {
            for (let sc = 0; sc < scale; sc++) {
              const gr = startRow + pr * scale + sr;
              const gc = startCol + pc * scale + sc;
              if (gr >= 0 && gr < rows && gc >= 0 && gc < cols) {
                yellowCells.add(`${gc},${gr}`);
              }
            }
          }
        }
      }
    }

    // 2. Determine field shape and chamber walls
    const shapes = ['arch', 'diamond', 'hexagon', 'shield', 'hourglass', 'vault', 'octagon', 'oval'];
    const shapeType = shapes[(level - 1) % shapes.length];

    // Moving obstacles in Level 151+
    if (level >= 151) {
      const obstacleCount = Math.min(3, 1 + Math.floor(t * 2.5));
      for (let i = 0; i < obstacleCount; i++) {
        const obsY = gridTop + 140 + i * 110;
        this.obstacles.push({
          x: gridLeft + 80 + i * 60,
          y: obsY,
          w: 48,
          h: 12,
          vx: (1.2 + rng() * 1.4) * (i % 2 === 0 ? 1 : -1),
          vy: 0,
          minX: gridLeft + 20,
          maxX: gridLeft + cols * bw - 70,
          minY: obsY,
          maxY: obsY,
          angle: 0,
          vRot: level >= 301 ? 0.02 * (i % 2 === 0 ? 1 : -1) : 0,
        });
      }
    }

    // Secret bonus chance & guaranteed boss drops
    let bossGuaranteedDrops = this.isBossLevel ? 3 : 0;
    let brickId = 1;

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const bx = gridLeft + c * bw;
        const by = gridTop + r * bh;

        // Level 2: Dual Chamber layout
        if (level === 2) {
          // Central dividing horizontal wall with doorway corridor
          if (r === Math.floor(rows / 2) && (c < 18 || c > 32)) {
            this.bricks.push({
              id: brickId++,
              row: r,
              col: c,
              x: bx,
              y: by,
              w: bw,
              h: bh,
              type: 'indestructible',
              hp: 999,
              maxHp: 999,
              color: CONFIG.COLORS.WALL_FRAME,
              borderColor: CONFIG.COLORS.WALL_FRAME_BORDER,
              isYellow: false,
            });
            continue;
          }
          // Vertical partition in lower section
          if (r > Math.floor(rows / 2) && c === Math.floor(cols / 2)) {
            this.bricks.push({
              id: brickId++,
              row: r,
              col: c,
              x: bx,
              y: by,
              w: bw,
              h: bh,
              type: 'indestructible',
              hp: 999,
              maxHp: 999,
              color: CONFIG.COLORS.WALL_FRAME,
              borderColor: CONFIG.COLORS.WALL_FRAME_BORDER,
              isYellow: false,
            });
            continue;
          }
        }

        // Higher levels: Procedural chamber dividing walls with deliberate gaps
        if (level >= 3) {
          const isChamberDivider = (level % 2 === 0 && r === Math.floor(rows * 0.45) && (c < 16 || c > 34)) ||
            (level % 3 === 0 && c === Math.floor(cols * 0.5) && (r < 14 || r > 30));
          if (isChamberDivider && rng() > 0.25) {
            this.bricks.push({
              id: brickId++,
              row: r,
              col: c,
              x: bx,
              y: by,
              w: bw,
              h: bh,
              type: 'indestructible',
              hp: 999,
              maxHp: 999,
              color: CONFIG.COLORS.WALL_FRAME,
              borderColor: CONFIG.COLORS.WALL_FRAME_BORDER,
              isYellow: false,
            });
            continue;
          }
        }

        // Check if point falls within level field shape
        const isInsideShape = this.checkInsideShape(shapeType, c, r, cols, rows);
        if (!isInsideShape) continue;

        // Gray Barrage border walls around shape with deliberate gaps
        const isShapeEdge = this.checkShapeEdge(shapeType, c, r, cols, rows);
        if (isShapeEdge && level > 1) {
          // Leave entrance slots so balls can enter easily
          const isEntranceSlot = (c % 12 === 0 || c % 12 === 1) || (r === 0 && c >= cols / 2 - 2 && c <= cols / 2 + 2);
          if (!isEntranceSlot) {
            this.bricks.push({
              id: brickId++,
              row: r,
              col: c,
              x: bx,
              y: by,
              w: bw,
              h: bh,
              type: 'barrier',
              hp: 999,
              maxHp: 999,
              color: CONFIG.COLORS.INDESTRUCTIBLE,
              borderColor: CONFIG.COLORS.INDESTRUCTIBLE_BORDER,
              isYellow: false,
            });
            continue;
          }
        }

        const isYellow = yellowCells.has(`${c},${r}`);
        if (isYellow) {
          this.totalYellowBricks++;
        }

        // Brick HP based on level progression & difficulty
        let baseHp = 1;
        if (isYellow) {
          baseHp = 1; // Yellow picture bricks are 1 hit (or +1 on boss)
        } else if (level === 2) {
          // Level 2 dual chamber theme: upper purple, lower green
          baseHp = r < Math.floor(rows / 2) ? 4 : 2;
        } else if (level <= 10) {
          baseHp = 1;
        } else {
          // Multi-HP bricks rise up to 40% share
          const roll = rng();
          if (roll < 0.40 * t) {
            if (level >= 301) baseHp = 4;
            else if (level >= 151) baseHp = 3;
            else baseHp = 2;
          }
        }

        // Boss level: all bricks get +1 HP
        if (this.isBossLevel) {
          baseHp += 1;
        }

        // Colors according to HP
        let col: string = CONFIG.COLORS.HP1;
        let borderCol: string = CONFIG.COLORS.HP1_BORDER;
        if (isYellow) {
          col = CONFIG.COLORS.YELLOW;
          borderCol = CONFIG.COLORS.YELLOW_BORDER;
        } else if (baseHp === 2) {
          col = CONFIG.COLORS.HP2;
          borderCol = CONFIG.COLORS.HP2_BORDER;
        } else if (baseHp === 3) {
          col = CONFIG.COLORS.HP3;
          borderCol = CONFIG.COLORS.HP3_BORDER;
        } else if (baseHp >= 4) {
          col = CONFIG.COLORS.HP4;
          borderCol = CONFIG.COLORS.HP4_BORDER;
        }

        // Secret bonus hidden inside some bricks (glint effect)
        let secretBonus: PowerUpType | undefined = undefined;
        let hasGlint = false;
        if (!isYellow && (rng() < CONFIG.DIFFICULTY.SECRET_BONUS_RATE || bossGuaranteedDrops > 0)) {
          if (bossGuaranteedDrops > 0) bossGuaranteedDrops--;
          const bonusPool: PowerUpType[] = ['triple', 'smash', 'wide', 'life', 'slow'];
          secretBonus = bonusPool[Math.floor(rng() * bonusPool.length)];
          hasGlint = true;
        }

        // Level 151+ regenerating bricks
        const isRegen = level >= 151 && !isYellow && rng() < 0.04;

        this.bricks.push({
          id: brickId++,
          row: r,
          col: c,
          x: bx,
          y: by,
          w: bw,
          h: bh,
          type: isYellow ? 'yellow' : 'normal',
          hp: baseHp,
          maxHp: baseHp,
          color: col,
          borderColor: borderCol,
          isYellow,
          secretBonus,
          hasGlint,
          glintTimer: rng() * 10,
          isRegenerating: isRegen,
          regenTimer: isRegen ? CONFIG.DIFFICULTY.REGEN_INTERVAL_SECONDS : 0,
        });
      }
    }

    // Safety fallback: if picture didn't produce yellow bricks (e.g. edge shape clipped it), add a row of yellow bricks
    if (this.totalYellowBricks === 0) {
      for (let c = 15; c <= 35; c++) {
        const bx = gridLeft + c * bw;
        const by = gridTop + Math.floor(rows / 2) * bh;
        this.totalYellowBricks++;
        this.bricks.push({
          id: brickId++,
          row: Math.floor(rows / 2),
          col: c,
          x: bx,
          y: by,
          w: bw,
          h: bh,
          type: 'yellow',
          hp: this.isBossLevel ? 2 : 1,
          maxHp: this.isBossLevel ? 2 : 1,
          color: CONFIG.COLORS.YELLOW,
          borderColor: CONFIG.COLORS.YELLOW_BORDER,
          isYellow: true,
        });
      }
    }

    this.rebuildSpatialGrid();
  }

  /**
   * Field boundary shape math
   */
  private checkInsideShape(shape: string, c: number, r: number, cols: number, rows: number): boolean {
    const nx = (c - cols / 2) / (cols / 2); // -1 to 1
    const ny = (r - rows / 2) / (rows / 2); // -1 to 1

    switch (shape) {
      case 'diamond':
        return Math.abs(nx) + Math.abs(ny) <= 0.98;
      case 'hexagon':
        return Math.abs(nx) <= 0.92 && Math.abs(ny) + Math.abs(nx) * 0.45 <= 0.95;
      case 'shield':
        return ny <= 0.2 ? Math.abs(nx) <= 0.92 : Math.abs(nx) <= 0.92 - (ny - 0.2) * 0.7;
      case 'hourglass':
        return Math.abs(nx) <= 0.35 + Math.abs(ny) * 0.6;
      case 'vault':
        return ny >= 0 ? Math.abs(nx) <= 0.92 : nx * nx + ny * ny <= 0.95;
      case 'octagon':
        return Math.abs(nx) <= 0.92 && Math.abs(ny) <= 0.92 && Math.abs(nx) + Math.abs(ny) <= 1.35;
      case 'oval':
        return nx * nx + ny * ny <= 0.96;
      case 'arch':
      default:
        return ny >= -0.2 ? Math.abs(nx) <= 0.95 : nx * nx + (ny + 0.2) * (ny + 0.2) <= 0.95;
    }
  }

  private checkShapeEdge(shape: string, c: number, r: number, cols: number, rows: number): boolean {
    const inside = this.checkInsideShape(shape, c, r, cols, rows);
    if (!inside) return false;
    // Check if any neighbor is outside
    const n1 = this.checkInsideShape(shape, c - 1, r, cols, rows);
    const n2 = this.checkInsideShape(shape, c + 1, r, cols, rows);
    const n3 = this.checkInsideShape(shape, c, r - 1, cols, rows);
    const n4 = this.checkInsideShape(shape, c, r + 1, cols, rows);
    return !n1 || !n2 || !n3 || !n4;
  }

  // -------------------------------------------------------------
  // CONTROLS & BALL LAUNCH
  // -------------------------------------------------------------
  public setPaddleTargetX(normalizedX: number): void {
    // Check for reverse controls bad power-up
    const effectiveNormX = this.reverseTimer > 0 ? 1.0 - normalizedX : normalizedX;
    const paddleLeft = effectiveNormX * CONFIG.CANVAS_WIDTH - this.paddleWidth / 2;
    // Keep paddle within frame bounds
    const minX = CONFIG.ARENA.FRAME_LEFT_X + 4;
    const maxX = CONFIG.ARENA.FRAME_RIGHT_X - this.paddleWidth - 4;
    this.targetPaddleX = Math.max(minX, Math.min(maxX, paddleLeft));
  }

  public launchBall(): void {
    if (!this.ballOnPaddle || this.balls.length === 0) return;
    this.ballOnPaddle = false;

    // Launch speed based on difficulty t
    const t = Math.min(1.0, Math.max(0, (this.currentLevel - 1) / (CONFIG.DIFFICULTY.MAX_RAMP_LEVELS - 1)));
    let speed = Math.min(CONFIG.BALL.MAX_SPEED_CAP, CONFIG.BALL.BASE_SPEED + 5.0 * t);
    if (this.slowTimer > 0) speed *= 0.72;
    if (this.fastTimer > 0) speed *= 1.35;

    // Level 1: Launch angled into left chute ramp (matching Video 1)
    if (this.currentLevel === 1) {
      const angle = -Math.PI * 0.73; // Up-left into stepped ramp
      this.balls[0].vx = Math.cos(angle) * speed;
      this.balls[0].vy = Math.sin(angle) * speed;
    } else if (this.currentLevel === 2) {
      // Level 2: Launch straight up central corridor (matching Video 2)
      this.balls[0].vx = (Math.random() - 0.5) * 0.3;
      this.balls[0].vy = -speed;
    } else {
      // Natural upwards launch
      const angle = -Math.PI / 2 + (Math.random() - 0.5) * 0.45;
      this.balls[0].vx = Math.cos(angle) * speed;
      this.balls[0].vy = Math.sin(angle) * speed;
    }

    gameAudio.playPaddleHit();
  }

  private resetBallOnPaddle(): void {
    this.ballOnPaddle = true;
    this.comboMultiplier = 1;
    this.balls = [
      {
        x: this.paddleX + this.paddleWidth / 2,
        y: CONFIG.PADDLE.Y - CONFIG.BALL.RADIUS - 2,
        vx: 0,
        vy: 0,
        radius: this.smashTimer > 0 ? CONFIG.BALL.SMASH_RADIUS : CONFIG.BALL.RADIUS,
        isSmash: this.smashTimer > 0,
        trail: [],
      },
    ];
  }

  // -------------------------------------------------------------
  // UPDATE LOOP (60 FPS)
  // -------------------------------------------------------------
  public update(dt: number): void {
    if (!this.isRunning || this.isPaused) return;

    // 1. Smooth paddle movement (frame-rate independent lerp)
    const smoothFactor = Math.min(1.0, 1 - Math.exp(-32 * dt));
    this.paddleX += (this.targetPaddleX - this.paddleX) * smoothFactor;

    // If ball resting on paddle, keep it anchored
    if (this.ballOnPaddle && this.balls.length > 0) {
      this.balls[0].x = this.paddleX + this.paddleWidth / 2;
      this.balls[0].y = CONFIG.PADDLE.Y - this.balls[0].radius - 2;
    }

    // 2. Boss timer tick
    if (this.isBossLevel && this.bossTimer > 0) {
      this.bossTimer -= dt;
      if (this.callbacks.onBossTimerTick) {
        this.callbacks.onBossTimerTick(Math.max(0, Math.ceil(this.bossTimer)));
      }
      if (this.bossTimer <= 0) {
        // Boss level timeout: fail level
        this.handleLevelFail();
        return;
      }
    }

    // 3. Status effect timers
    if (this.smashTimer > 0) {
      this.smashTimer -= dt;
      if (this.smashTimer <= 0) {
        this.balls.forEach((b) => {
          b.isSmash = false;
          b.radius = CONFIG.BALL.RADIUS;
        });
      }
    }
    if (this.wideTimer > 0) {
      this.wideTimer -= dt;
      if (this.wideTimer <= 0) this.updatePaddleWidth();
    }
    if (this.shrinkTimer > 0) {
      this.shrinkTimer -= dt;
      if (this.shrinkTimer <= 0) this.updatePaddleWidth();
    }
    if (this.slowTimer > 0) this.slowTimer -= dt;
    if (this.fastTimer > 0) this.fastTimer -= dt;
    if (this.reverseTimer > 0) this.reverseTimer -= dt;

    if (this.screenShake > 0) {
      this.screenShake *= CONFIG.FX.SHAKE_DECAY;
      if (this.screenShake < 0.1) this.screenShake = 0;
    }
    if (this.lifeLostFlashTimer > 0) {
      this.lifeLostFlashTimer -= dt;
    }
    if (this.leftWallFlash > 0) {
      this.leftWallFlash -= dt;
    }
    if (this.rightWallFlash > 0) {
      this.rightWallFlash -= dt;
    }

    this.emitActiveEffects();

    // 4. Update Moving Obstacles (Level 151+)
    for (const obs of this.obstacles) {
      obs.x += obs.vx;
      if (obs.x < obs.minX || obs.x + obs.w > obs.maxX) {
        obs.vx *= -1;
      }
      if (obs.vRot && obs.angle !== undefined) {
        obs.angle += obs.vRot;
      }
    }

    // 5. Update Brick Regenerations (Level 151+)
    for (const brick of this.bricks) {
      if (brick.hasGlint && brick.glintTimer !== undefined) {
        brick.glintTimer += dt;
      }
      if (brick.isRegenerating && brick.hp < brick.maxHp && brick.hp > 0 && brick.regenTimer !== undefined) {
        brick.regenTimer -= dt;
        if (brick.regenTimer <= 0) {
          brick.hp = Math.min(brick.maxHp, brick.hp + 1);
          brick.regenTimer = CONFIG.DIFFICULTY.REGEN_INTERVAL_SECONDS;
          this.spawnGlintParticles(brick.x + brick.w / 2, brick.y + brick.h / 2, '#34d399');
        }
      }
    }

    // 6. Sub-stepped Ball Physics & Continuous Collision Detection
    if (!this.ballOnPaddle) {
      const subSteps = CONFIG.BALL.SUB_STEPS;
      const stepDt = dt / subSteps;
      for (let s = 0; s < subSteps; s++) {
        this.updateBallSubStep(stepDt);
      }
    }

    // 7. Update Falling Power-up Orbs
    for (let i = this.powerUps.length - 1; i >= 0; i--) {
      const p = this.powerUps[i];
      p.y += p.vy;

      // Check collision with paddle
      const paddleTop = CONFIG.PADDLE.Y;
      const paddleBottom = CONFIG.PADDLE.Y + CONFIG.PADDLE.HEIGHT;
      const paddleLeft = this.paddleX;
      const paddleRight = this.paddleX + this.paddleWidth;

      if (
        p.y + p.radius >= paddleTop &&
        p.y - p.radius <= paddleBottom &&
        p.x >= paddleLeft - 4 &&
        p.x <= paddleRight + 4
      ) {
        this.collectPowerUp(p);
        this.powerUps.splice(i, 1);
        continue;
      }

      // Fell off bottom of screen
      if (p.y > CONFIG.CANVAS_HEIGHT + 20) {
        this.powerUps.splice(i, 1);
      }
    }

    // 8. Update Particles
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const pt = this.particles[i];
      pt.x += pt.vx;
      pt.y += pt.vy;
      pt.vy += 0.08; // subtle gravity
      pt.life += dt;
      pt.alpha = Math.max(0, 1.0 - pt.life / pt.maxLife);
      if (pt.life >= pt.maxLife) {
        this.particles.splice(i, 1);
      }
    }

    // 9. Update Floating Texts
    for (let i = this.floatingTexts.length - 1; i >= 0; i--) {
      const ft = this.floatingTexts[i];
      ft.y += ft.vy;
      ft.alpha -= dt * 0.9;
      if (ft.alpha <= 0) {
        this.floatingTexts.splice(i, 1);
      }
    }

    // 10. Update Laser Beams
    for (let i = this.laserBeams.length - 1; i >= 0; i--) {
      const lb = this.laserBeams[i];
      lb.timer += dt;
      if (lb.timer >= lb.maxTimer) {
        this.laserBeams.splice(i, 1);
      }
    }

    // 11. Check if all balls are lost below paddle
    if (!this.ballOnPaddle && this.balls.length === 0) {
      this.handleAllBallsLost();
    }
  }

  /**
   * Sub-step ball integration & collision response
   */
  private updateBallSubStep(dt: number): void {
    const t = Math.min(1.0, Math.max(0, (this.currentLevel - 1) / (CONFIG.DIFFICULTY.MAX_RAMP_LEVELS - 1)));
    let baseSpeed = Math.min(CONFIG.BALL.MAX_SPEED_CAP, CONFIG.BALL.BASE_SPEED + 5.0 * t);
    if (this.slowTimer > 0) baseSpeed *= 0.72;
    if (this.fastTimer > 0) baseSpeed *= 1.35;

    for (let i = this.balls.length - 1; i >= 0; i--) {
      const ball = this.balls[i];

      // Maintain constant scalar speed
      const curSpeed = Math.hypot(ball.vx, ball.vy);
      if (curSpeed > 0.001) {
        ball.vx = (ball.vx / curSpeed) * baseSpeed;
        ball.vy = (ball.vy / curSpeed) * baseSpeed;
      }

      // Move ball
      ball.x += ball.vx * dt * 60;
      ball.y += ball.vy * dt * 60;

      // Collision with Outer Indestructible Frame Walls
      // Left Wall
      if (ball.x - ball.radius <= CONFIG.ARENA.FRAME_LEFT_X) {
        ball.x = CONFIG.ARENA.FRAME_LEFT_X + ball.radius;
        ball.vx = Math.abs(ball.vx);
        gameAudio.playWallHit();
        this.leftWallFlash = 0.25;
        this.leftWallHitY = ball.y;
        this.spawnWallHitSparks(CONFIG.ARENA.FRAME_LEFT_X, ball.y, true);
      }
      // Right Wall
      if (ball.x + ball.radius >= CONFIG.ARENA.FRAME_RIGHT_X) {
        ball.x = CONFIG.ARENA.FRAME_RIGHT_X - ball.radius;
        ball.vx = -Math.abs(ball.vx);
        gameAudio.playWallHit();
        this.rightWallFlash = 0.25;
        this.rightWallHitY = ball.y;
        this.spawnWallHitSparks(CONFIG.ARENA.FRAME_RIGHT_X, ball.y, false);
      }
      // Top Wall
      if (ball.y - ball.radius <= CONFIG.ARENA.TOP_WALL_Y) {
        ball.y = CONFIG.ARENA.TOP_WALL_Y + ball.radius;
        ball.vy = Math.abs(ball.vy);
        gameAudio.playWallHit();
      }

      // Level 1 Chute Inner Wall reflection
      if (this.currentLevel === 1) {
        // If ball is inside chute (X < CHUTE_INNER_X) and tries to pass inner partition below top entrance slot
        if (
          ball.x + ball.radius >= CONFIG.ARENA.CHUTE_INNER_X &&
          ball.x - ball.radius <= CONFIG.ARENA.CHUTE_INNER_X + 8 &&
          ball.y > CONFIG.ARENA.CHUTE_TOP_OPENING_Y
        ) {
          if (ball.vx > 0) {
            ball.x = CONFIG.ARENA.CHUTE_INNER_X - ball.radius;
            ball.vx = -ball.vx;
          } else {
            ball.x = CONFIG.ARENA.CHUTE_INNER_X + 8 + ball.radius;
            ball.vx = Math.abs(ball.vx);
          }
          gameAudio.playWallHit();
        }
      }

      // Moving Obstacle Collision
      for (const obs of this.obstacles) {
        if (
          ball.x + ball.radius >= obs.x &&
          ball.x - ball.radius <= obs.x + obs.w &&
          ball.y + ball.radius >= obs.y &&
          ball.y - ball.radius <= obs.y + obs.h
        ) {
          // Bounce off obstacle
          const overlapLeft = ball.x + ball.radius - obs.x;
          const overlapRight = obs.x + obs.w - (ball.x - ball.radius);
          const overlapTop = ball.y + ball.radius - obs.y;
          const overlapBottom = obs.y + obs.h - (ball.y - ball.radius);
          const minOverlap = Math.min(overlapLeft, overlapRight, overlapTop, overlapBottom);

          if (minOverlap === overlapLeft || minOverlap === overlapRight) {
            ball.vx = -ball.vx;
          } else {
            ball.vy = -ball.vy;
          }
          gameAudio.playWallHit();
          break;
        }
      }

      // Paddle Collision (Deflection angle depends on hit location)
      const paddleTop = CONFIG.PADDLE.Y;
      const paddleBottom = CONFIG.PADDLE.Y + CONFIG.PADDLE.HEIGHT;
      const paddleLeft = this.paddleX;
      const paddleRight = this.paddleX + this.paddleWidth;

      if (
        ball.vy > 0 &&
        ball.y + ball.radius >= paddleTop &&
        ball.y - ball.radius <= paddleBottom &&
        ball.x + ball.radius >= paddleLeft &&
        ball.x - ball.radius <= paddleRight
      ) {
        ball.y = paddleTop - ball.radius;
        // Hit offset ranges from -1.0 (left edge) to 1.0 (right edge)
        const hitOffset = (ball.x - (paddleLeft + this.paddleWidth / 2)) / (this.paddleWidth / 2);
        const clampedOffset = Math.max(-0.95, Math.min(0.95, hitOffset));
        
        // Bounce angle from -150° (sharp left) to -30° (sharp right)
        const bounceAngle = -Math.PI / 2 + clampedOffset * (Math.PI * 0.38);
        ball.vx = Math.cos(bounceAngle) * baseSpeed;
        ball.vy = Math.sin(bounceAngle) * baseSpeed;

        // Reset combo multiplier when ball hits paddle
        this.comboMultiplier = 1;
        this.callbacks.onScoreChange(this.score, this.comboMultiplier);

        gameAudio.playPaddleHit();
        continue;
      }

      // Ball below paddle: fell off!
      if (ball.y - ball.radius > CONFIG.CANVAS_HEIGHT) {
        this.balls.splice(i, 1);
        gameAudio.playBallLoss();
        continue;
      }

      // Spatial Grid Brick Collision Lookup
      this.checkBallBrickCollisions(ball);
    }
  }

  /**
   * Fast spatial grid brick collision query
   */
  private checkBallBrickCollisions(ball: Ball): void {
    const minCx = Math.floor((ball.x - ball.radius - 2) / this.cellSize);
    const maxCx = Math.floor((ball.x + ball.radius + 2) / this.cellSize);
    const minCy = Math.floor((ball.y - ball.radius - 2) / this.cellSize);
    const maxCy = Math.floor((ball.y + ball.radius + 2) / this.cellSize);

    const checkedBricks = new Set<number>();

    for (let cx = minCx; cx <= maxCx; cx++) {
      for (let cy = minCy; cy <= maxCy; cy++) {
        const key = this.getCellKey(cx, cy);
        const cellBricks = this.spatialGrid.get(key);
        if (!cellBricks) continue;

        for (const brick of cellBricks) {
          if (brick.hp <= 0 || checkedBricks.has(brick.id)) continue;
          checkedBricks.add(brick.id);

          // Find closest point on brick rectangle to ball center
          const closestX = Math.max(brick.x, Math.min(ball.x, brick.x + brick.w));
          const closestY = Math.max(brick.y, Math.min(ball.y, brick.y + brick.h));
          const distX = ball.x - closestX;
          const distY = ball.y - closestY;
          const distSq = distX * distX + distY * distY;

          if (distSq <= ball.radius * ball.radius) {
            this.handleBrickHit(ball, brick, closestX, closestY);
            return; // Resolve one collision per sub-step for physics stability
          }
        }
      }
    }
  }

  /**
   * Collision resolution and damage logic
   */
  private handleBrickHit(ball: Ball, brick: Brick, hitX: number, hitY: number): void {
    const isIndestructible = brick.type === 'indestructible' || brick.type === 'barrier';

    // If Smash Ball active: plow straight through without velocity reflection
    if (ball.isSmash && !isIndestructible) {
      this.damageBrick(brick, 99); // Instantly smash brick
      return;
    }

    // Normal collision velocity reflection
    const overlapLeft = Math.abs(ball.x + ball.radius - brick.x);
    const overlapRight = Math.abs(brick.x + brick.w - (ball.x - ball.radius));
    const overlapTop = Math.abs(ball.y + ball.radius - brick.y);
    const overlapBottom = Math.abs(brick.y + brick.h - (ball.y - ball.radius));

    const minOverlap = Math.min(overlapLeft, overlapRight, overlapTop, overlapBottom);

    if (minOverlap === overlapLeft || minOverlap === overlapRight) {
      ball.vx = -ball.vx;
    } else {
      ball.vy = -ball.vy;
    }

    if (isIndestructible) {
      gameAudio.playWallHit();
      this.spawnParticles(hitX, hitY, '#94a3b8', 4);
    } else {
      this.damageBrick(brick, 1);
    }
  }

  /**
   * Damages or destroys a brick and triggers effects, score, and power-up drops
   */
  private damageBrick(brick: Brick, dmg: number = 1): void {
    brick.hp -= dmg;

    // Increment combo on successful brick hit
    this.comboMultiplier = Math.min(this.comboMultiplier + 1, 99);

    if (brick.hp <= 0) {
      // Destroyed!
      this.spawnParticles(brick.x + brick.w / 2, brick.y + brick.h / 2, brick.color, 12);

      // Score bonus
      let points: number = CONFIG.SCORE.BRICK_BASE;
      if (brick.isYellow) {
        points = CONFIG.SCORE.YELLOW_BRICK_BASE;
        this.destroyedYellowBricks++;
        gameAudio.playYellowBrickHit();
        this.screenShake = Math.min(this.screenShake + 3.5, CONFIG.FX.MAX_SHAKE);

        // Update progress callback
        const progress = Math.min(100, Math.round((this.destroyedYellowBricks / Math.max(1, this.totalYellowBricks)) * 100));
        this.callbacks.onYellowProgress(progress);

        // Check level win condition: ALL YELLOW BRICKS DESTROYED!
        if (this.destroyedYellowBricks >= this.totalYellowBricks) {
          this.handleLevelWin();
          return;
        }
      } else {
        gameAudio.playBrickHit(this.comboMultiplier);
        if (brick.maxHp >= 3) {
          this.screenShake = Math.min(this.screenShake + 2.0, CONFIG.FX.MAX_SHAKE);
        }
      }

      this.score += points * this.comboMultiplier;
      this.callbacks.onScoreChange(this.score, this.comboMultiplier);

      // Secret bonus discovery!
      if (brick.secretBonus) {
        this.triggerSecretBonus(brick.x + brick.w / 2, brick.y + brick.h / 2, brick.secretBonus);
      } else {
        // Normal power-up drop roll
        this.maybeDropPowerUp(brick.x + brick.w / 2, brick.y + brick.h / 2);
      }

      // Remove from spatial grid
      this.rebuildSpatialGrid();
    } else {
      // Brick damaged but still alive: update color according to remaining HP
      if (!brick.isYellow) {
        if (brick.hp === 1) {
          brick.color = CONFIG.COLORS.HP1;
          brick.borderColor = CONFIG.COLORS.HP1_BORDER;
        } else if (brick.hp === 2) {
          brick.color = CONFIG.COLORS.HP2;
          brick.borderColor = CONFIG.COLORS.HP2_BORDER;
        } else if (brick.hp === 3) {
          brick.color = CONFIG.COLORS.HP3;
          brick.borderColor = CONFIG.COLORS.HP3_BORDER;
        }
      }
      gameAudio.playBrickHit(this.comboMultiplier);
      this.spawnParticles(brick.x + brick.w / 2, brick.y + brick.h / 2, brick.color, 5);
    }
  }

  /**
   * Secret bonus hidden in brick found!
   */
  private triggerSecretBonus(x: number, y: number, type: PowerUpType): void {
    gameAudio.playSecretBonus();
    this.screenShake = Math.min(this.screenShake + 5, CONFIG.FX.MAX_SHAKE);
    this.spawnParticles(x, y, '#ffd700', 25);

    let banner = 'SECRET BONUS!';
    if (type === 'triple') {
      banner = 'SECRET: +2 BALLS!';
      this.spawnExtraBalls(2);
    } else if (type === 'smash') {
      banner = 'SECRET: SMASH BALL!';
      this.activateSmashBall();
    } else if (type === 'wide') {
      banner = 'SECRET: WIDE PADDLE!';
      this.activateWidePaddle();
    } else if (type === 'life') {
      banner = 'SECRET: +1 LIFE!';
      this.addLife();
    } else if (type === 'slow') {
      banner = 'SECRET: SLOW MOTION!';
      this.slowTimer = CONFIG.POWERUPS.DURATION_SLOW;
    }

    this.addFloatingText(x, y - 10, banner, '#ffd700');
  }

  /**
   * Drops power-ups based on difficulty rate
   */
  private maybeDropPowerUp(x: number, y: number): void {
    const t = Math.min(1.0, Math.max(0, (this.currentLevel - 1) / (CONFIG.DIFFICULTY.MAX_RAMP_LEVELS - 1)));
    const dropRate = CONFIG.DIFFICULTY.BASE_DROP_RATE - (CONFIG.DIFFICULTY.BASE_DROP_RATE - CONFIG.DIFFICULTY.MIN_DROP_RATE) * t;

    if (Math.random() > dropRate) return;

    // Bad power-up share starts at level 301+
    let isBad = false;
    if (this.currentLevel >= CONFIG.DIFFICULTY.BAD_POWERUP_START_LEVEL) {
      if (Math.random() < CONFIG.DIFFICULTY.MAX_BAD_POWERUP_SHARE) {
        isBad = true;
      }
    }

    let type: PowerUpType;
    if (isBad) {
      const badTypes: PowerUpType[] = ['shrink', 'fast', 'reverse'];
      type = badTypes[Math.floor(Math.random() * badTypes.length)];
    } else {
      const goodTypes: PowerUpType[] = ['triple', 'life', 'smash', 'wide', 'slow', 'laser'];
      type = goodTypes[Math.floor(Math.random() * goodTypes.length)];
    }

    this.powerUps.push({
      id: this.nextEntityId++,
      x,
      y,
      vy: CONFIG.POWERUPS.FALL_SPEED,
      radius: CONFIG.POWERUPS.ORB_RADIUS,
      type,
      isBad,
    });
  }

  /**
   * Collects falling orb on paddle
   */
  private collectPowerUp(p: PowerUpOrb): void {
    this.score += CONFIG.SCORE.POWERUP_BONUS;
    this.callbacks.onScoreChange(this.score, this.comboMultiplier);

    if (p.isBad) {
      gameAudio.playBadPowerUpCollect();
      this.screenShake = Math.min(this.screenShake + 4, CONFIG.FX.MAX_SHAKE);
      if (p.type === 'shrink') {
        this.shrinkTimer = CONFIG.POWERUPS.DURATION_SHRINK;
        this.updatePaddleWidth();
        this.addFloatingText(p.x, p.y - 12, 'SHRINK PADDLE!', '#ef4444');
      } else if (p.type === 'fast') {
        this.fastTimer = CONFIG.POWERUPS.DURATION_FAST;
        this.addFloatingText(p.x, p.y - 12, 'SPEED BOOST (BAD)!', '#f43f5e');
      } else if (p.type === 'reverse') {
        this.reverseTimer = CONFIG.POWERUPS.DURATION_REVERSE;
        this.addFloatingText(p.x, p.y - 12, 'REVERSE CONTROLS!', '#fb923c');
      }
      return;
    }

    // Good Power-ups
    gameAudio.playPowerUpCollect();
    if (p.type === 'triple') {
      this.tripleBalls();
      this.addFloatingText(p.x, p.y - 12, 'MULTI-BALL!', '#00ffff');
    } else if (p.type === 'life') {
      this.addLife();
      this.addFloatingText(p.x, p.y - 12, '+1 LIFE!', '#ff2d75');
    } else if (p.type === 'smash') {
      this.activateSmashBall();
      this.addFloatingText(p.x, p.y - 12, 'SMASH BALL (5s)!', '#ff9900');
    } else if (p.type === 'wide') {
      this.activateWidePaddle();
      this.addFloatingText(p.x, p.y - 12, 'WIDE PADDLE (10s)!', '#22c55e');
    } else if (p.type === 'slow') {
      this.slowTimer = CONFIG.POWERUPS.DURATION_SLOW;
      this.addFloatingText(p.x, p.y - 12, 'SLOW BALLS (8s)!', '#a3e635');
    } else if (p.type === 'laser') {
      this.fireLaser(p.x);
      this.addFloatingText(p.x, p.y - 12, 'LASER STRIKE!', '#c084fc');
    }
  }

  // -------------------------------------------------------------
  // POWER-UP ACTIONS
  // -------------------------------------------------------------
  private tripleBalls(): void {
    if (this.balls.length === 0) return;
    const newBalls: Ball[] = [];

    for (const b of this.balls) {
      if (this.balls.length + newBalls.length >= CONFIG.BALL.MAX_COUNT) break;
      const speed = Math.hypot(b.vx, b.vy);
      const angle = Math.atan2(b.vy, b.vx);

      // Clone 2 additional balls at +/- 25 degrees
      const angles = [angle + 0.35, angle - 0.35];
      for (const a of angles) {
        newBalls.push({
          x: b.x,
          y: b.y,
          vx: Math.cos(a) * speed,
          vy: Math.sin(a) * speed,
          radius: b.radius,
          isSmash: b.isSmash,
          trail: [],
        });
      }
    }

    this.balls.push(...newBalls);
  }

  private spawnExtraBalls(count: number): void {
    const originX = this.paddleX + this.paddleWidth / 2;
    const originY = CONFIG.PADDLE.Y - 10;
    const t = Math.min(1.0, Math.max(0, (this.currentLevel - 1) / (CONFIG.DIFFICULTY.MAX_RAMP_LEVELS - 1)));
    const speed = Math.min(CONFIG.BALL.MAX_SPEED_CAP, CONFIG.BALL.BASE_SPEED + 5.0 * t);

    for (let i = 0; i < count; i++) {
      const angle = -Math.PI / 2 + (Math.random() - 0.5) * 0.8;
      this.balls.push({
        x: originX,
        y: originY,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        radius: this.smashTimer > 0 ? CONFIG.BALL.SMASH_RADIUS : CONFIG.BALL.RADIUS,
        isSmash: this.smashTimer > 0,
        trail: [],
      });
    }
  }

  private activateSmashBall(): void {
    this.smashTimer = CONFIG.POWERUPS.DURATION_SMASH;
    this.balls.forEach((b) => {
      b.isSmash = true;
      b.radius = CONFIG.BALL.SMASH_RADIUS;
    });
  }

  private activateWidePaddle(): void {
    this.wideTimer = CONFIG.POWERUPS.DURATION_WIDE;
    this.updatePaddleWidth();
  }

  private updatePaddleWidth(): void {
    let w = this.basePaddleWidthForLevel;
    if (this.wideTimer > 0) w *= CONFIG.PADDLE.EXPAND_WIDTH_MULTIPLIER;
    if (this.shrinkTimer > 0) w *= CONFIG.PADDLE.SHRINK_WIDTH_MULTIPLIER;
    this.paddleWidth = Math.max(CONFIG.PADDLE.MIN_WIDTH * 0.7, w);
  }

  private addLife(): void {
    this.lives = Math.min(5, this.lives + 1);
    this.callbacks.onLivesChange(this.lives);
  }

  private fireLaser(x: number): void {
    gameAudio.playLaser();
    this.screenShake = Math.min(this.screenShake + 6, CONFIG.FX.MAX_SHAKE);

    this.laserBeams.push({
      x,
      width: CONFIG.POWERUPS.LASER_BEAM_WIDTH,
      timer: 0,
      maxTimer: CONFIG.POWERUPS.LASER_DURATION,
    });

    // Destroy all bricks in this vertical corridor!
    const halfW = CONFIG.POWERUPS.LASER_BEAM_WIDTH / 2;
    for (const brick of this.bricks) {
      if (brick.hp > 0 && brick.type !== 'indestructible') {
        if (brick.x + brick.w >= x - halfW && brick.x <= x + halfW) {
          this.damageBrick(brick, 99);
        }
      }
    }
  }

  // -------------------------------------------------------------
  // LIFE LOSS, LEVEL RESTART & LEVEL WIN
  // -------------------------------------------------------------
  private handleAllBallsLost(): void {
    this.lives--;
    this.callbacks.onLivesChange(this.lives);
    this.callbacks.onLifeLost();
    this.lifeLostFlashTimer = 0.35;
    this.screenShake = 6;
    gameAudio.playLifeLost();

    if (this.lives > 0) {
      // Respawn 1 ball on paddle; destroyed bricks stay destroyed
      this.resetBallOnPaddle();
    } else {
      // 3rd life lost: Show Level Failed screen and restart SAME level from snapshot
      this.handleLevelFail();
    }
  }

  private handleLevelFail(): void {
    this.isRunning = false;
    gameAudio.playLevelFail();
    this.callbacks.onLevelFailed();

    // Auto-restart same level after ~2 seconds from snapshot
    setTimeout(() => {
      this.restartCurrentLevel();
    }, 2000);
  }

  public restartCurrentLevel(): void {
    if (!this.levelSnapshot) {
      this.loadLevel(this.currentLevel);
      return;
    }

    // Rebuild exact original bricks from snapshot
    this.bricks = this.levelSnapshot.bricks.map((b) => ({ ...b }));
    this.totalYellowBricks = this.levelSnapshot.totalYellowBricks;
    this.destroyedYellowBricks = 0;
    this.lives = 3;
    this.balls = [];
    this.powerUps = [];
    this.particles = [];
    this.floatingTexts = [];
    this.laserBeams = [];
    this.comboMultiplier = 1;

    // Reset all power-up effects
    this.smashTimer = 0;
    this.wideTimer = 0;
    this.slowTimer = 0;
    this.shrinkTimer = 0;
    this.fastTimer = 0;
    this.reverseTimer = 0;
    this.updatePaddleWidth();

    this.rebuildSpatialGrid();

    // Center paddle and place 1 fresh ball
    this.paddleX = CONFIG.CANVAS_WIDTH / 2 - this.paddleWidth / 2;
    this.targetPaddleX = this.paddleX;
    this.resetBallOnPaddle();

    this.isRunning = true;
    this.isPaused = false;

    // Notify UI
    this.callbacks.onLivesChange(this.lives);
    this.callbacks.onScoreChange(this.score, this.comboMultiplier);
    this.callbacks.onYellowProgress(0);
    this.emitActiveEffects();
  }

  private handleLevelWin(): void {
    this.isRunning = false;
    gameAudio.playLevelWin();

    // Calculate stars: 3 stars for 3 lives left, 2 stars for 2 lives, 1 star for 1 life
    let stars = Math.max(1, Math.min(3, this.lives));
    if (this.isBossLevel && this.bossTimer > 30) stars = 3;

    const levelScore = CONFIG.SCORE.LEVEL_CLEAR_BASE * this.currentLevel;
    this.score += levelScore;
    this.callbacks.onScoreChange(this.score, this.comboMultiplier);

    this.callbacks.onLevelWon(stars, levelScore);
  }

  // -------------------------------------------------------------
  // VISUAL EFFECTS HELPERS
  // -------------------------------------------------------------
  private spawnParticles(x: number, y: number, color: string, count: number): void {
    for (let i = 0; i < count; i++) {
      if (this.particles.length >= CONFIG.FX.MAX_PARTICLES) break;
      const angle = Math.random() * Math.PI * 2;
      const speed = 1.0 + Math.random() * 3.5;
      this.particles.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        size: 2.0 + Math.random() * 2.5,
        color,
        alpha: 1.0,
        life: 0,
        maxLife: 0.35 + Math.random() * 0.35,
      });
    }
  }

  private spawnWallHitSparks(x: number, y: number, isLeft: boolean): void {
    const baseAngle = isLeft ? 0 : Math.PI;
    for (let s = 0; s < 5; s++) {
      if (this.particles.length >= CONFIG.FX.MAX_PARTICLES) break;
      // Spread angle inwards into playfield
      const angle = baseAngle + (Math.random() - 0.5) * Math.PI * 0.7;
      const speed = 2.0 + Math.random() * 3.5;
      this.particles.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        size: 2.4,
        color: '#00f0ff',
        alpha: 1.0,
        life: 0,
        maxLife: 0.22,
      });
    }
  }

  private spawnGlintParticles(x: number, y: number, color: string): void {
    for (let i = 0; i < 6; i++) {
      const angle = Math.random() * Math.PI * 2;
      this.particles.push({
        x,
        y,
        vx: Math.cos(angle) * 1.5,
        vy: Math.sin(angle) * 1.5 - 0.5,
        size: 2.0,
        color,
        alpha: 1.0,
        life: 0,
        maxLife: 0.4,
      });
    }
  }

  private addFloatingText(x: number, y: number, text: string, color: string): void {
    this.floatingTexts.push({
      id: this.nextEntityId++,
      x,
      y,
      text,
      color,
      alpha: 1.0,
      vy: -1.2,
      scale: 1.0,
    });
  }

  private emitActiveEffects(): void {
    this.callbacks.onActiveEffectsChange({
      smashTime: Math.max(0, this.smashTimer),
      wideTime: Math.max(0, this.wideTimer),
      slowTime: Math.max(0, this.slowTimer),
      reverseTime: Math.max(0, this.reverseTimer),
    });
    this.callbacks.onBallCountChange?.(this.balls.length);
  }

  // -------------------------------------------------------------
  // RENDER ENGINE
  // -------------------------------------------------------------
  public render(): void {
    const ctx = this.ctx;
    ctx.save();

    // Screen Shake Offset
    if (this.screenShake > 0) {
      const sx = (Math.random() - 0.5) * this.screenShake;
      const sy = (Math.random() - 0.5) * this.screenShake;
      ctx.translate(sx, sy);
    }

    // 1. Clear with Pure Black Background
    ctx.fillStyle = CONFIG.COLORS.BACKGROUND;
    ctx.fillRect(0, 0, CONFIG.CANVAS_WIDTH, CONFIG.CANVAS_HEIGHT);

    // 2. Arena Outer Frame Box (Top ~60% of screen)
    this.renderArenaFrame(ctx);

    // 3. Render Bricks
    this.renderBricks(ctx);

    // 4. Render Moving Obstacles
    this.renderObstacles(ctx);

    // 5. Render Laser Beams
    this.renderLaserBeams(ctx);

    // 6. Render Falling Power-Up Orbs
    this.renderPowerUps(ctx);

    // 7. Render Glowing Paddle (In dark empty area outside the box)
    this.renderPaddle(ctx);

    // 8. Render Balls & Trails
    this.renderBalls(ctx);

    // 9. Render Particle Puffs
    this.renderParticles(ctx);

    // 10. Render Floating Texts
    this.renderFloatingTexts(ctx);

    // 11. Red Screen Flash on Life Lost
    if (this.lifeLostFlashTimer > 0) {
      ctx.fillStyle = `rgba(239, 68, 68, ${this.lifeLostFlashTimer * 0.7})`;
      ctx.fillRect(0, 0, CONFIG.CANVAS_WIDTH, CONFIG.CANVAS_HEIGHT);
    }

    ctx.restore();
  }

  private renderArenaFrame(ctx: CanvasRenderingContext2D): void {
    const topY = CONFIG.ARENA.TOP_WALL_Y;
    const bottomY = CONFIG.ARENA.BOTTOM_OPEN_Y;
    const leftX = CONFIG.ARENA.FRAME_LEFT_X;
    const rightX = CONFIG.ARENA.FRAME_RIGHT_X;
    const thick = CONFIG.ARENA.FRAME_THICKNESS;
    const canvasW = CONFIG.CANVAS_WIDTH;
    const canvasH = CONFIG.CANVAS_HEIGHT;

    ctx.save();

    // 1. Full-bleed side walls and top wall (solid coverage to eliminate any dark margins)
    ctx.fillStyle = CONFIG.COLORS.WALL_FRAME;

    // Top Wall (spanning full width above topY)
    ctx.fillRect(0, Math.max(0, topY - thick), canvasW, thick);

    // Left Wall from top to canvas bottom (covering x = 0 to leftX)
    ctx.fillRect(0, topY - thick, leftX, canvasH - (topY - thick));

    // Right Wall from top to canvas bottom (covering x = rightX to canvasW)
    ctx.fillRect(rightX, topY - thick, canvasW - rightX, canvasH - (topY - thick));

    // 2. Pixel brick bevels and mortar dividers (every 22px)
    for (let y = topY; y < canvasH; y += 22) {
      // Left wall brick bevel and mortar
      ctx.fillStyle = '#64748b';
      ctx.fillRect(0, y, leftX, 1.5);
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(0, y + 21, leftX, 1);

      // Right wall brick bevel and mortar
      ctx.fillStyle = '#64748b';
      ctx.fillRect(rightX, y, canvasW - rightX, 1.5);
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(rightX, y + 21, canvasW - rightX, 1);
    }

    // 3. VIBRANT LEFT & RIGHT BALL BOUNCE BOUNDARY RAILS
    // Left Boundary Rail (prominent, high-contrast neon barrier)
    ctx.strokeStyle = 'rgba(0, 240, 255, 0.45)';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(leftX, topY);
    ctx.lineTo(leftX, canvasH);
    ctx.stroke();

    ctx.strokeStyle = '#00f0ff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(leftX, topY);
    ctx.lineTo(leftX, canvasH);
    ctx.stroke();

    // Pixel boundary notches along the left wall
    ctx.fillStyle = '#ffffff';
    for (let y = topY + 11; y < canvasH; y += 22) {
      ctx.fillRect(leftX - 3, y - 2, 3, 4);
    }

    // Right Boundary Rail (matching symmetrical neon barrier)
    ctx.strokeStyle = 'rgba(0, 240, 255, 0.45)';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(rightX, topY);
    ctx.lineTo(rightX, canvasH);
    ctx.stroke();

    ctx.strokeStyle = '#00f0ff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(rightX, topY);
    ctx.lineTo(rightX, canvasH);
    ctx.stroke();

    // Pixel boundary notches along the right wall
    ctx.fillStyle = '#ffffff';
    for (let y = topY + 11; y < canvasH; y += 22) {
      ctx.fillRect(rightX, y - 2, 3, 4);
    }

    // Top Wall Boundary Rail
    ctx.strokeStyle = '#00f0ff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(leftX, topY);
    ctx.lineTo(rightX, topY);
    ctx.stroke();

    // 4. Dynamic Wall Hit Pulse Glow on bounce
    if (this.leftWallFlash > 0) {
      const pulseAlpha = Math.min(1.0, this.leftWallFlash * 4.0);
      ctx.fillStyle = `rgba(0, 240, 255, ${0.45 * pulseAlpha})`;
      ctx.fillRect(leftX - 6, this.leftWallHitY - 35, 10, 70);
      ctx.fillStyle = `rgba(255, 255, 255, ${0.9 * pulseAlpha})`;
      ctx.fillRect(leftX - 2, this.leftWallHitY - 14, 4, 28);
    }

    if (this.rightWallFlash > 0) {
      const pulseAlpha = Math.min(1.0, this.rightWallFlash * 4.0);
      ctx.fillStyle = `rgba(0, 240, 255, ${0.45 * pulseAlpha})`;
      ctx.fillRect(rightX - 4, this.rightWallHitY - 35, 10, 70);
      ctx.fillStyle = `rgba(255, 255, 255, ${0.9 * pulseAlpha})`;
      ctx.fillRect(rightX - 2, this.rightWallHitY - 14, 4, 28);
    }

    // 5. Level 1: Left Launch Chute inner divider wall
    if (this.currentLevel === 1) {
      const chuteX = CONFIG.ARENA.CHUTE_INNER_X;
      const slotY = CONFIG.ARENA.CHUTE_TOP_OPENING_Y;
      // Clean inner divider wall leaving top entrance slot
      ctx.fillStyle = CONFIG.COLORS.WALL_FRAME;
      ctx.fillRect(chuteX, slotY, 8, bottomY - slotY);
      ctx.strokeStyle = CONFIG.COLORS.WALL_FRAME_BORDER;
      ctx.lineWidth = 1;
      ctx.strokeRect(chuteX, slotY, 8, bottomY - slotY);

      // Boundary edge on chute partition
      ctx.strokeStyle = 'rgba(0, 240, 255, 0.45)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(chuteX, slotY);
      ctx.lineTo(chuteX, bottomY);
      ctx.moveTo(chuteX + 8, slotY);
      ctx.lineTo(chuteX + 8, bottomY);
      ctx.stroke();
    }

    ctx.restore();
  }

  private renderBricks(ctx: CanvasRenderingContext2D): void {
    const gap = CONFIG.BRICKS.BRICK_GAP;

    for (const b of this.bricks) {
      if (b.hp <= 0) continue;

      const x = b.x;
      const y = b.y;
      const w = b.w - gap;
      const h = b.h - gap;

      if (b.isYellow) {
        // Yellow Bricks have distinctive arcade pixel glow & sparkle
        ctx.fillStyle = CONFIG.COLORS.YELLOW;
        ctx.fillRect(x, y, w, h);
        
        ctx.strokeStyle = CONFIG.COLORS.YELLOW_BORDER;
        ctx.lineWidth = 1;
        ctx.strokeRect(x, y, w, h);

        // Center highlight pixel
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(x + 1, y + 1, Math.max(1, w - 2), 1.5);
      } else if (b.type === 'indestructible' || b.type === 'barrier') {
        // Gray Indestructible Barrage Bricks
        ctx.fillStyle = b.color;
        ctx.fillRect(x, y, w, h);
        ctx.strokeStyle = b.borderColor;
        ctx.lineWidth = 1;
        ctx.strokeRect(x, y, w, h);
      } else {
        // Normal destructible bricks (Blue 1HP, Green 2HP, Red 3HP, Purple 4HP)
        ctx.fillStyle = b.color;
        ctx.fillRect(x, y, w, h);
        ctx.strokeStyle = b.borderColor;
        ctx.lineWidth = 0.8;
        ctx.strokeRect(x, y, w, h);

        // Top glossy pixel bevel
        ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
        ctx.fillRect(x, y, w, 1.5);

        // Secret bonus glint twinkle
        if (b.hasGlint && b.glintTimer !== undefined) {
          const glintCycle = (b.glintTimer % 2.5);
          if (glintCycle < 0.4) {
            ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
            ctx.fillRect(x + w * 0.6, y + h * 0.3, 2, 2);
          }
        }
      }
    }
  }

  private renderObstacles(ctx: CanvasRenderingContext2D): void {
    ctx.fillStyle = '#64748b';
    ctx.strokeStyle = '#94a3b8';
    ctx.lineWidth = 1.5;

    for (const obs of this.obstacles) {
      ctx.save();
      ctx.translate(obs.x + obs.w / 2, obs.y + obs.h / 2);
      if (obs.angle) ctx.rotate(obs.angle);
      ctx.fillRect(-obs.w / 2, -obs.h / 2, obs.w, obs.h);
      ctx.strokeRect(-obs.w / 2, -obs.h / 2, obs.w, obs.h);
      ctx.restore();
    }
  }

  private renderLaserBeams(ctx: CanvasRenderingContext2D): void {
    for (const lb of this.laserBeams) {
      const progress = lb.timer / lb.maxTimer;
      const alpha = Math.max(0, 1.0 - progress);

      ctx.save();
      ctx.shadowColor = '#c084fc';
      ctx.shadowBlur = 24;

      // Outer glow beam
      ctx.fillStyle = `rgba(192, 132, 252, ${alpha * 0.45})`;
      ctx.fillRect(lb.x - lb.width / 2, 0, lb.width, CONFIG.CANVAS_HEIGHT);

      // Core white laser beam
      ctx.fillStyle = `rgba(255, 255, 255, ${alpha * 0.9})`;
      ctx.fillRect(lb.x - 4, 0, 8, CONFIG.CANVAS_HEIGHT);

      ctx.restore();
    }
  }

  private renderPowerUps(ctx: CanvasRenderingContext2D): void {
    for (const p of this.powerUps) {
      ctx.save();
      let color = '#00ffff';
      let icon = 'x3';

      if (p.type === 'triple') { color = '#00ffff'; icon = '⚂'; }
      else if (p.type === 'life') { color = '#ff2d75'; icon = '♥'; }
      else if (p.type === 'smash') { color = '#ff9900'; icon = '★'; }
      else if (p.type === 'wide') { color = '#22c55e'; icon = '↔'; }
      else if (p.type === 'slow') { color = '#a3e635'; icon = '⏱'; }
      else if (p.type === 'laser') { color = '#c084fc'; icon = '⚡'; }
      else if (p.type === 'shrink') { color = '#ef4444'; icon = '-'; }
      else if (p.type === 'fast') { color = '#f43f5e'; icon = '+3'; }
      else if (p.type === 'reverse') { color = '#fb923c'; icon = '⇄'; }

      // Neon Orb Glow
      ctx.shadowColor = color;
      ctx.shadowBlur = 12;

      ctx.beginPath();
      ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
      ctx.fillStyle = '#0a0918';
      ctx.fill();

      ctx.strokeStyle = color;
      ctx.lineWidth = 2.5;
      ctx.stroke();

      // Tiny Icon inside orb
      ctx.fillStyle = color;
      ctx.font = 'bold 9px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(icon, p.x, p.y);

      ctx.restore();
    }
  }

  private renderPaddle(ctx: CanvasRenderingContext2D): void {
    const x = this.paddleX;
    const y = CONFIG.PADDLE.Y;
    const w = this.paddleWidth;
    const h = CONFIG.PADDLE.HEIGHT;
    const r = CONFIG.PADDLE.CORNER_RADIUS;

    ctx.save();

    // Vibrant Red-Orange Neon Glow
    ctx.shadowColor = CONFIG.PADDLE.GLOW_COLOR;
    ctx.shadowBlur = 18;

    // Body
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
    ctx.fillStyle = CONFIG.PADDLE.COLOR;
    ctx.fill();

    // Border highlight
    ctx.strokeStyle = CONFIG.PADDLE.BORDER_COLOR;
    ctx.lineWidth = 2.0;
    ctx.stroke();

    // Center neon shine strip
    ctx.fillStyle = '#ffcc00';
    ctx.fillRect(x + w * 0.2, y + 2, w * 0.6, 2.5);

    ctx.restore();
  }

  private renderBalls(ctx: CanvasRenderingContext2D): void {
    ctx.save();
    for (const b of this.balls) {
      // High-performance Smooth Ball Glow Rings (Clean, crisp, no trailing line)
      const glowPrefix = b.isSmash ? 'rgba(255, 153, 0, ' : 'rgba(0, 255, 255, ';
      // Outer aura
      ctx.fillStyle = `${glowPrefix}0.2)`;
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.radius * 2.2, 0, Math.PI * 2);
      ctx.fill();

      // Inner glow
      ctx.fillStyle = `${glowPrefix}0.55)`;
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.radius * 1.4, 0, Math.PI * 2);
      ctx.fill();

      // Solid Ball Sphere
      ctx.fillStyle = b.isSmash ? CONFIG.BALL.SMASH_COLOR : CONFIG.BALL.COLOR;
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.radius, 0, Math.PI * 2);
      ctx.fill();

      // Crisp White Core Specular Highlight
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(b.x - b.radius * 0.15, b.y - b.radius * 0.15, b.radius * 0.55, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  private renderParticles(ctx: CanvasRenderingContext2D): void {
    for (const p of this.particles) {
      ctx.save();
      ctx.globalAlpha = p.alpha;
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
      ctx.restore();
    }
  }

  private renderFloatingTexts(ctx: CanvasRenderingContext2D): void {
    for (const ft of this.floatingTexts) {
      ctx.save();
      ctx.globalAlpha = ft.alpha;
      ctx.shadowColor = ft.color;
      ctx.shadowBlur = 8;
      ctx.fillStyle = ft.color;
      ctx.font = 'bold 12px "Press Start 2P", monospace';
      ctx.textAlign = 'center';
      ctx.fillText(ft.text, ft.x, ft.y);
      ctx.restore();
    }
  }

  // -------------------------------------------------------------
  // GETTERS & LIFECYCLE
  // -------------------------------------------------------------
  public start(): void {
    this.isRunning = true;
    this.isPaused = false;
  }

  public pause(): void {
    this.isPaused = true;
  }

  public resume(): void {
    this.isPaused = false;
  }

  public isGamePaused(): boolean {
    return this.isPaused;
  }

  public isBallReady(): boolean {
    return this.ballOnPaddle;
  }

  public getScore(): number {
    return this.score;
  }

  public getLives(): number {
    return this.lives;
  }

  public getCurrentLevel(): number {
    return this.currentLevel;
  }

  public getBallCount(): number {
    return this.balls.length;
  }
}
