/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  Play,
  Pause,
  RotateCcw,
  Volume2,
  VolumeX,
  Maximize2,
  Minimize2,
  Settings,
  X,
  Download,
  Trophy,
  Heart,
  ChevronRight,
  AlertTriangle,
  Zap,
} from 'lucide-react';
import { CONFIG } from './gameConfig';
import { PixelBreakerEngine } from './gameEngine';
import { gameAudio } from './gameAudio';

interface SaveData {
  highestLevel: number;
  currentLevel: number;
  bestScore: number;
}

const STORAGE_KEY = 'pixel_breaker_save_v1';

function loadSaveData(): SaveData {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        highestLevel: Math.max(1, Number(parsed.highestLevel) || 1),
        currentLevel: Math.max(1, Number(parsed.currentLevel) || 1),
        bestScore: Math.max(0, Number(parsed.bestScore) || 0),
      };
    }
  } catch {}
  return { highestLevel: 1, currentLevel: 1, bestScore: 0 };
}

function persistSaveData(data: SaveData) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {}
}

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const engineRef = useRef<PixelBreakerEngine | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // App Game States
  const [gameState, setGameState] = useState<'title' | 'playing' | 'paused' | 'won' | 'failed'>('title');
  const [saveData, setSaveData] = useState<SaveData>(loadSaveData);
  
  // HUD state
  const [score, setScore] = useState(0);
  const [combo, setCombo] = useState(1);
  const [lives, setLives] = useState(3);
  const [progress, setProgress] = useState(0);
  const [activeLevel, setActiveLevel] = useState(1);
  const [ballCount, setBallCount] = useState(1);
  const [bossTimerSec, setBossTimerSec] = useState<number | null>(null);
  const [activeEffects, setActiveEffects] = useState({
    smashTime: 0,
    wideTime: 0,
    slowTime: 0,
    reverseTime: 0,
  });

  // Level Clear Banner (Video 2 signature "CLEAR!")
  const [isClearing, setIsClearing] = useState(false);

  // Modal overlays
  const [showSettings, setShowSettings] = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [soundOn, setSoundOn] = useState(() => gameAudio.isSoundEnabled());
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [pwaPrompt, setPwaPrompt] = useState<any>(null);
  const [isInstallable, setIsInstallable] = useState(false);

  // Won Modal Data
  const [wonStars, setWonStars] = useState(3);
  const [wonScoreDelta, setWonScoreDelta] = useState(0);

  // Capture PWA beforeinstallprompt
  useEffect(() => {
    const handleBeforeInstall = (e: Event) => {
      e.preventDefault();
      setPwaPrompt(e);
      setIsInstallable(true);
    };
    window.addEventListener('beforeinstallprompt', handleBeforeInstall);
    return () => window.removeEventListener('beforeinstallprompt', handleBeforeInstall);
  }, []);

  // Fullscreen state listener
  useEffect(() => {
    const handleFsChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', handleFsChange);
    return () => document.removeEventListener('fullscreenchange', handleFsChange);
  }, []);

  // Save best score
  useEffect(() => {
    if (score > saveData.bestScore) {
      setSaveData((prev) => {
        const next = { ...prev, bestScore: score };
        persistSaveData(next);
        return next;
      });
    }
  }, [score, saveData.bestScore]);

  // Main Canvas & Engine Initialization
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    canvas.width = CONFIG.CANVAS_WIDTH;
    canvas.height = CONFIG.CANVAS_HEIGHT;

    const engine = new PixelBreakerEngine(canvas, {
      onScoreChange: (newScore, newCombo) => {
        setScore(newScore);
        setCombo(newCombo);
      },
      onLivesChange: (newLives) => {
        setLives(newLives);
      },
      onYellowProgress: (pct) => {
        setProgress(pct);
      },
      onBallCountChange: (count) => {
        setBallCount(count);
      },
      onLevelWon: (stars, deltaScore) => {
        setWonStars(stars);
        setWonScoreDelta(deltaScore);

        // 1. Show big flashing "CLEAR!" banner first (Video 2)
        setIsClearing(true);

        // 2. Persist level progress
        setSaveData((prev) => {
          const current = engine.getCurrentLevel();
          const nextLevel = current + 1;
          const next = {
            ...prev,
            currentLevel: nextLevel,
            highestLevel: Math.max(prev.highestLevel, nextLevel),
          };
          persistSaveData(next);
          return next;
        });

        // 3. Show Congratulations 3-star card after 1.2s (Video 1)
        setTimeout(() => {
          setIsClearing(false);
          setGameState('won');
        }, 1300);
      },
      onLevelFailed: () => {
        setGameState('failed');
      },
      onLifeLost: () => {
        // Red screen flash & ball re-anchoring handled by engine
      },
      onActiveEffectsChange: (effects) => {
        setActiveEffects(effects);
      },
      onBossTimerTick: (sec) => {
        setBossTimerSec(sec);
      },
    });

    engineRef.current = engine;

    // 60 FPS animation frame loop
    let animationFrameId: number;
    let lastTime = performance.now();

    const loop = (currentTime: number) => {
      const dt = Math.min(0.045, (currentTime - lastTime) / 1000);
      lastTime = currentTime;

      engine.update(dt);
      engine.render();

      animationFrameId = requestAnimationFrame(loop);
    };

    animationFrameId = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(animationFrameId);
    };
  }, []);

  // Normalized touch/pointer movement
  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    const engine = engineRef.current;
    if (!canvas || !engine) return;

    const rect = canvas.getBoundingClientRect();
    const clientX = e.clientX;
    const normalizedX = (clientX - rect.left) / rect.width;
    engine.setPaddleTargetX(Math.max(0, Math.min(1, normalizedX)));
  }, []);

  // Tap or Click to launch resting ball
  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    const engine = engineRef.current;
    if (!canvas || !engine) return;

    gameAudio.initAudio();

    const rect = canvas.getBoundingClientRect();
    const clientX = e.clientX;
    const normalizedX = (clientX - rect.left) / rect.width;
    engine.setPaddleTargetX(Math.max(0, Math.min(1, normalizedX)));

    if (engine.isBallReady()) {
      engine.launchBall();
    }
  }, []);

  // Keyboard controls
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const engine = engineRef.current;
      if (!engine) return;

      if (e.code === 'Space') {
        e.preventDefault();
        gameAudio.initAudio();
        if (engine.isBallReady()) {
          engine.launchBall();
        }
      } else if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') {
        const currNorm = (engine['paddleX'] + engine['paddleWidth'] / 2) / CONFIG.CANVAS_WIDTH;
        engine.setPaddleTargetX(Math.max(0, currNorm - 0.08));
      } else if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') {
        const currNorm = (engine['paddleX'] + engine['paddleWidth'] / 2) / CONFIG.CANVAS_WIDTH;
        engine.setPaddleTargetX(Math.min(1, currNorm + 0.08));
      } else if (e.key === 'Escape' || e.key === 'p' || e.key === 'P') {
        togglePause();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [gameState]);

  // Start / Continue Game
  const startGame = () => {
    gameAudio.initAudio();
    const engine = engineRef.current;
    if (!engine) return;

    const targetLevel = saveData.currentLevel || 1;
    setActiveLevel(targetLevel);
    engine.loadLevel(targetLevel);
    engine.start();
    setGameState('playing');
  };

  // Toggle Pause
  const togglePause = () => {
    const engine = engineRef.current;
    if (!engine) return;

    if (gameState === 'playing') {
      engine.pause();
      setGameState('paused');
    } else if (gameState === 'paused') {
      engine.resume();
      setGameState('playing');
    }
  };

  // Restart Current Level (from Snapshot with 3 lives)
  const restartLevel = () => {
    const engine = engineRef.current;
    if (!engine) return;

    engine.restartCurrentLevel();
    engine.start();
    setGameState('playing');
  };

  // Advance to Next Level
  const advanceNextLevel = () => {
    const engine = engineRef.current;
    if (!engine) return;

    const nextLvl = engine.getCurrentLevel() + 1;
    setActiveLevel(nextLvl);
    engine.loadLevel(nextLvl);
    engine.start();
    setGameState('playing');
  };

  // Sound Toggle
  const toggleSoundSetting = () => {
    const next = gameAudio.toggleSound();
    setSoundOn(next);
  };

  // Fullscreen Toggle
  const toggleFullscreen = async () => {
    try {
      if (!document.fullscreenElement) {
        if (containerRef.current?.requestFullscreen) {
          await containerRef.current.requestFullscreen();
        } else if ((document.documentElement as any).webkitRequestFullscreen) {
          (document.documentElement as any).webkitRequestFullscreen();
        }
      } else {
        if (document.exitFullscreen) {
          await document.exitFullscreen();
        }
      }
    } catch {}
  };

  // Install PWA
  const installApp = async () => {
    if (!pwaPrompt) return;
    try {
      pwaPrompt.prompt();
      const choice = await pwaPrompt.userChoice;
      if (choice.outcome === 'accepted') {
        setIsInstallable(false);
      }
      setPwaPrompt(null);
    } catch {}
  };

  // Reset Saved Progress
  const confirmResetProgress = () => {
    const defaultData: SaveData = { highestLevel: 1, currentLevel: 1, bestScore: 0 };
    setSaveData(defaultData);
    persistSaveData(defaultData);
    setShowResetConfirm(false);
    setShowSettings(false);

    const engine = engineRef.current;
    if (engine) {
      setActiveLevel(1);
      engine.loadLevel(1);
    }
    setGameState('title');
  };

  // Determine active powerup icon for the Video 2 square badge
  const getActivePowerupBadge = () => {
    if (activeEffects.smashTime > 0) return { icon: '★', label: `${activeEffects.smashTime.toFixed(0)}s`, color: '#ff9900' };
    if (activeEffects.wideTime > 0) return { icon: '↔', label: `${activeEffects.wideTime.toFixed(0)}s`, color: '#22c55e' };
    if (activeEffects.slowTime > 0) return { icon: '⏱', label: `${activeEffects.slowTime.toFixed(0)}s`, color: '#a3e635' };
    return null;
  };

  const activeBadge = getActivePowerupBadge();

  return (
    <div
      ref={containerRef}
      className="relative w-screen h-[100dvh] bg-[#020208] flex items-center justify-center overflow-hidden select-none font-sans text-white touch-none"
    >
      {/* 9:16 Canvas Viewport Wrapper */}
      <div className="relative w-full h-full max-w-[576px] aspect-[9/16] bg-black shadow-2xl flex flex-col justify-between overflow-hidden">
        
        {/* Render Canvas */}
        <canvas
          ref={canvasRef}
          onPointerMove={handlePointerMove}
          onPointerDown={handlePointerDown}
          className="absolute inset-0 w-full h-full z-0 block cursor-crosshair touch-none"
        />

        {/* ------------------------------------------------------------- */}
        {/* HUD (Matching Video 2 layout with speaker, level, and badge)  */}
        {/* ------------------------------------------------------------- */}
        {gameState !== 'title' && (
          <header className="relative z-10 w-full px-3 py-2 flex flex-col gap-1 bg-gradient-to-b from-[#090d2a]/95 via-[#090d2a]/60 to-transparent pointer-events-none border-b border-white/5">
            {/* Top Bar: Speaker, Center Indicator, Power-up Badge, Pause */}
            <div className="flex items-center justify-between pointer-events-auto">
              
              {/* Left: Speaker Sound Toggle */}
              <button
                onClick={toggleSoundSetting}
                aria-label="Toggle Sound"
                className="p-1.5 rounded-lg bg-white/10 hover:bg-white/20 active:scale-95 transition text-gray-200"
              >
                {soundOn ? <Volume2 size={18} className="text-[#38bdf8]" /> : <VolumeX size={18} className="text-gray-500" />}
              </button>

              {/* Center: White dot icon + Level number */}
              <div className="flex items-center gap-3">
                {/* Level Badge */}
                <div className="flex items-center gap-1.5 font-mono text-sm tracking-wider font-bold">
                  <span className="w-2.5 h-2.5 rounded-full bg-white shadow-[0_0_8px_#ffffff]" />
                  <span className="text-white text-base">{activeLevel}</span>
                </div>

                {bossTimerSec !== null && activeLevel % CONFIG.DIFFICULTY.BOSS_INTERVAL === 0 && (
                  <span className="px-1.5 py-0.5 text-[10px] font-bold rounded bg-rose-600/90 text-white animate-pulse">
                    BOSS: {bossTimerSec}s
                  </span>
                )}
              </div>

              {/* Right: Active Power-up Badge + Pause Button */}
              <div className="flex items-center gap-2">
                {/* Active Power-up Icon Badge (Matching Video 2 dice box) */}
                {activeBadge && (
                  <div
                    className="flex items-center justify-center gap-1 px-2 py-1 rounded-lg border text-xs font-mono font-bold animate-pulse"
                    style={{
                      borderColor: activeBadge.color,
                      backgroundColor: `${activeBadge.color}22`,
                      color: activeBadge.color,
                      boxShadow: `0 0 10px ${activeBadge.color}55`,
                    }}
                  >
                    <span className="text-sm">{activeBadge.icon}</span>
                    <span className="text-[10px]">{activeBadge.label}</span>
                  </div>
                )}

                {/* Pause Button */}
                <button
                  onClick={togglePause}
                  aria-label="Pause"
                  className="p-1.5 rounded-lg bg-white/10 hover:bg-white/20 active:scale-95 transition text-gray-200"
                >
                  {gameState === 'paused' ? <Play size={18} /> : <Pause size={18} />}
                </button>
              </div>
            </div>

            {/* Sub-bar: Score and Lives */}
            <div className="flex items-center justify-between text-xs px-0.5 pt-0.5">
              <div className="flex items-center gap-2">
                <span className="text-gray-400 font-mono tracking-wider text-[11px]">SCORE</span>
                <span className="text-sm font-black font-mono text-white tracking-widest">
                  {score.toLocaleString()}
                </span>
              </div>

              {/* 3 Lives Hearts */}
              <div className="flex items-center gap-1">
                {[1, 2, 3].map((heartIndex) => (
                  <Heart
                    key={heartIndex}
                    size={15}
                    className={`transition-all duration-300 ${
                      heartIndex <= lives
                        ? 'fill-[#ff2d75] text-[#ff2d75] drop-shadow-[0_0_6px_#ff2d75]'
                        : 'fill-transparent text-gray-700 opacity-40'
                    }`}
                  />
                ))}
              </div>
            </div>
          </header>
        )}

        {/* ------------------------------------------------------------- */}
        {/* CLEAR! OVERLAY BANNER (Video 2 Signature)                     */}
        {/* ------------------------------------------------------------- */}
        {isClearing && (
          <div className="absolute inset-0 z-40 bg-black/60 backdrop-blur-sm flex flex-col items-center justify-center pointer-events-none animate-in fade-in zoom-in-95 duration-200">
            <h1 className="text-5xl sm:text-6xl font-black tracking-widest text-white drop-shadow-[0_0_25px_rgba(255,255,255,0.9)] font-mono animate-bounce">
              CLEAR!
            </h1>
            <p className="mt-3 text-xs font-mono tracking-widest text-yellow-300 uppercase drop-shadow-[0_0_10px_#facc15]">
              STAGE COMPLETED
            </p>
          </div>
        )}

        {/* ------------------------------------------------------------- */}
        {/* TITLE SCREEN OVERLAY                                         */}
        {/* Exact User Constraints:                                       */}
        {/* - Big "PIXEL BREAKER" title                                   */}
        {/* - Small "Developed by Ahmad Shahzad" under it                  */}
        {/* - Glowing orange "Start Game" / "Continue Level X" button     */}
        {/* - Small "Saved level: X" and best score at top                */}
        {/* - Bottom line: "3 chances per level · Break all yellow bricks to advance to the next level" */}
        {/* ------------------------------------------------------------- */}
        {gameState === 'title' && (
          <div className="absolute inset-0 z-20 bg-black/95 flex flex-col justify-between items-center p-6 text-center">
            {/* Top Saved Stats */}
            <div className="w-full flex items-center justify-between text-xs text-gray-400 font-mono pt-4">
              <span className="text-gray-300 font-medium">
                Saved level: <strong className="text-white font-bold">{saveData.currentLevel}</strong>
              </span>
              <div className="flex items-center gap-1.5">
                <Trophy size={14} className="text-amber-400" />
                <span>Best: <strong className="text-amber-400">{saveData.bestScore.toLocaleString()}</strong></span>
              </div>
            </div>

            {/* Center Title & Play Button */}
            <div className="flex flex-col items-center max-w-xs">
              <h1 className="text-4xl sm:text-5xl font-black tracking-tight text-transparent bg-clip-text bg-gradient-to-b from-[#ffea79] via-[#ff9900] to-[#ff2d55] drop-shadow-[0_0_24px_rgba(255,153,0,0.85)] font-mono">
                PIXEL BREAKER
              </h1>

              {/* Developer Credit */}
              <p className="mt-2 text-xs font-mono tracking-widest text-gray-400 uppercase">
                Developed by Ahmad Shahzad
              </p>

              {/* Start / Continue Button */}
              <button
                onClick={startGame}
                className="mt-10 group relative w-64 py-4 rounded-xl font-black text-lg tracking-widest uppercase transition-all duration-300 active:scale-95
                           bg-gradient-to-r from-[#ff6b00] to-[#ff9900] text-black shadow-[0_0_25px_rgba(255,120,0,0.8)] hover:shadow-[0_0_40px_rgba(255,160,0,1)]
                           border border-yellow-300"
              >
                <span className="flex items-center justify-center gap-2">
                  <Play size={20} className="fill-black" />
                  {saveData.currentLevel > 1 ? `Continue Level ${saveData.currentLevel}` : 'Start Game'}
                </span>
              </button>

              {/* Settings Icon */}
              <button
                onClick={() => setShowSettings(true)}
                className="mt-6 text-xs text-gray-500 hover:text-gray-300 flex items-center gap-1.5 transition"
              >
                <Settings size={14} />
                <span>Settings</span>
              </button>
            </div>

            {/* Bottom Rules Line */}
            <footer className="pb-3 max-w-sm text-[11px] leading-relaxed text-gray-400 font-mono">
              3 chances per level · Break all yellow bricks to advance to the next level
            </footer>
          </div>
        )}

        {/* ------------------------------------------------------------- */}
        {/* LEVEL WON OVERLAY CARD (Video 1 Signature)                     */}
        {/* "Congratulations / You win!" with 3 Gold Stars                */}
        {/* ------------------------------------------------------------- */}
        {gameState === 'won' && (
          <div className="absolute inset-0 z-30 bg-black/85 backdrop-blur-sm flex items-center justify-center p-6">
            <div className="w-full max-w-xs bg-[#0f0e1e] border-2 border-[#ffcc00]/40 rounded-2xl p-6 text-center shadow-[0_0_40px_rgba(255,204,0,0.3)] animate-in fade-in zoom-in-95 duration-200">
              <h2 className="text-2xl font-black tracking-wider text-[#ffcc00] font-mono drop-shadow-[0_0_12px_#ffcc00]">
                Congratulations
              </h2>
              <p className="text-sm font-semibold text-gray-300 mt-1">You win!</p>

              {/* 3 Gold Stars */}
              <div className="flex items-center justify-center gap-3 my-5">
                {[1, 2, 3].map((starIdx) => (
                  <div
                    key={starIdx}
                    className={`text-2xl transition-all transform duration-300 ${
                      starIdx <= wonStars
                        ? 'text-yellow-400 scale-110 drop-shadow-[0_0_12px_#facc15]'
                        : 'text-gray-700 opacity-30'
                    }`}
                  >
                    ★
                  </div>
                ))}
              </div>

              {/* Level Score */}
              <div className="bg-black/40 rounded-lg p-2.5 mb-5 border border-white/10 font-mono text-xs">
                <div className="text-gray-400">Level Bonus</div>
                <div className="text-lg font-bold text-white tracking-wider">
                  +{wonScoreDelta.toLocaleString()}
                </div>
              </div>

              {/* Next Level Button */}
              <button
                onClick={advanceNextLevel}
                className="w-full py-3.5 rounded-xl font-bold text-sm tracking-wider uppercase transition-all duration-200 active:scale-95
                           bg-gradient-to-r from-amber-500 to-yellow-400 text-black shadow-[0_0_20px_rgba(250,204,21,0.6)] flex items-center justify-center gap-2"
              >
                <span>Next Level</span>
                <ChevronRight size={18} />
              </button>
            </div>
          </div>
        )}

        {/* ------------------------------------------------------------- */}
        {/* LEVEL FAILED OVERLAY CARD                                     */}
        {/* ------------------------------------------------------------- */}
        {gameState === 'failed' && (
          <div className="absolute inset-0 z-30 bg-black/85 backdrop-blur-sm flex items-center justify-center p-6">
            <div className="w-full max-w-xs bg-[#160d14] border-2 border-rose-500/50 rounded-2xl p-6 text-center shadow-[0_0_35px_rgba(244,63,94,0.4)] animate-in fade-in zoom-in-95 duration-200">
              <h2 className="text-2xl font-black tracking-wider text-rose-500 font-mono drop-shadow-[0_0_12px_#f43f5e]">
                Level Failed
              </h2>
              <p className="text-xs text-gray-400 mt-2">
                All 3 chances used. Rebuilding level...
              </p>

              <button
                onClick={restartLevel}
                className="mt-6 w-full py-3 rounded-xl font-bold text-sm tracking-wider uppercase transition-all duration-200 active:scale-95
                           bg-gradient-to-r from-rose-600 to-orange-500 text-white shadow-[0_0_20px_rgba(244,63,94,0.6)] flex items-center justify-center gap-2"
              >
                <RotateCcw size={16} />
                <span>Try Again</span>
              </button>
            </div>
          </div>
        )}

        {/* ------------------------------------------------------------- */}
        {/* PAUSE MENU OVERLAY                                            */}
        {/* ------------------------------------------------------------- */}
        {gameState === 'paused' && (
          <div className="absolute inset-0 z-30 bg-black/80 backdrop-blur-sm flex items-center justify-center p-6">
            <div className="w-full max-w-xs bg-[#0e0e1a] border border-white/20 rounded-2xl p-6 text-center shadow-2xl">
              <h3 className="text-xl font-black tracking-wider text-white font-mono mb-6">
                GAME PAUSED
              </h3>

              <div className="flex flex-col gap-3">
                <button
                  onClick={togglePause}
                  className="w-full py-3 rounded-xl font-bold text-sm tracking-wider uppercase transition bg-gradient-to-r from-amber-500 to-yellow-400 text-black flex items-center justify-center gap-2"
                >
                  <Play size={16} className="fill-black" />
                  <span>Resume</span>
                </button>

                <button
                  onClick={restartLevel}
                  className="w-full py-3 rounded-xl font-semibold text-sm tracking-wider uppercase transition bg-white/10 hover:bg-white/15 text-gray-200 flex items-center justify-center gap-2"
                >
                  <RotateCcw size={16} />
                  <span>Restart Level</span>
                </button>

                <button
                  onClick={() => setShowSettings(true)}
                  className="w-full py-3 rounded-xl font-semibold text-sm tracking-wider uppercase transition bg-white/10 hover:bg-white/15 text-gray-200 flex items-center justify-center gap-2"
                >
                  <Settings size={16} />
                  <span>Settings</span>
                </button>
              </div>

              <p className="text-[10px] text-gray-500 font-mono mt-6 uppercase">
                Developed by Ahmad Shahzad
              </p>
            </div>
          </div>
        )}

        {/* ------------------------------------------------------------- */}
        {/* SETTINGS MODAL                                                */}
        {/* ------------------------------------------------------------- */}
        {showSettings && (
          <div className="absolute inset-0 z-40 bg-black/90 backdrop-blur-md flex items-center justify-center p-6">
            <div className="w-full max-w-xs bg-[#100f22] border border-white/20 rounded-2xl p-5 shadow-2xl">
              {/* Header */}
              <div className="flex items-center justify-between pb-4 border-b border-white/10">
                <h4 className="font-bold text-base tracking-wider font-mono text-white">SETTINGS</h4>
                <button
                  onClick={() => setShowSettings(false)}
                  className="p-1 rounded-md text-gray-400 hover:text-white transition"
                >
                  <X size={18} />
                </button>
              </div>

              {/* Options */}
              <div className="flex flex-col gap-3.5 py-4">
                {/* Sound Toggle */}
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-300 flex items-center gap-2">
                    {soundOn ? <Volume2 size={16} className="text-amber-400" /> : <VolumeX size={16} className="text-gray-500" />}
                    Sound & Audio
                  </span>
                  <button
                    onClick={toggleSoundSetting}
                    className={`w-12 h-6 rounded-full transition-colors p-0.5 flex items-center ${
                      soundOn ? 'bg-amber-500 justify-end' : 'bg-gray-700 justify-start'
                    }`}
                  >
                    <div className="w-5 h-5 rounded-full bg-white shadow-md" />
                  </button>
                </div>

                {/* Fullscreen Toggle */}
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-300 flex items-center gap-2">
                    {isFullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
                    Fullscreen
                  </span>
                  <button
                    onClick={toggleFullscreen}
                    className="px-2.5 py-1 text-xs rounded bg-white/10 hover:bg-white/20 text-gray-200 transition font-mono"
                  >
                    {isFullscreen ? 'Exit' : 'Enter'}
                  </button>
                </div>

                {/* Install App (PWA) */}
                {isInstallable && (
                  <div className="flex items-center justify-between pt-1">
                    <span className="text-sm text-gray-300 flex items-center gap-2">
                      <Download size={16} className="text-emerald-400" />
                      Install to Phone
                    </span>
                    <button
                      onClick={installApp}
                      className="px-2.5 py-1 text-xs rounded bg-emerald-500 hover:bg-emerald-600 text-black font-bold transition font-mono"
                    >
                      Install
                    </button>
                  </div>
                )}

                {/* Reset Progress */}
                <div className="pt-3 border-t border-white/10">
                  <button
                    onClick={() => setShowResetConfirm(true)}
                    className="w-full py-2.5 text-xs rounded-xl font-bold bg-rose-500/15 hover:bg-rose-500/25 border border-rose-500/30 text-rose-300 transition tracking-wider uppercase font-mono"
                  >
                    Reset Progress
                  </button>
                </div>
              </div>

              <div className="pt-3 border-t border-white/10 text-center">
                <p className="text-[10px] text-gray-500 font-mono uppercase">
                  Developed by Ahmad Shahzad
                </p>
              </div>
            </div>
          </div>
        )}

        {/* ------------------------------------------------------------- */}
        {/* RESET PROGRESS CONFIRMATION MODAL                             */}
        {/* ------------------------------------------------------------- */}
        {showResetConfirm && (
          <div className="absolute inset-0 z-50 bg-black/95 backdrop-blur-sm flex items-center justify-center p-6">
            <div className="w-full max-w-xs bg-[#1a0c10] border-2 border-rose-500/60 rounded-2xl p-5 text-center shadow-2xl">
              <AlertTriangle size={32} className="text-rose-500 mx-auto mb-2 animate-bounce" />
              <h5 className="font-bold text-base text-white">Reset Saved Progress?</h5>
              <p className="text-xs text-gray-400 mt-2 mb-5 leading-relaxed">
                Are you sure? This will reset all your saved levels and high score back to Level 1.
              </p>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => setShowResetConfirm(false)}
                  className="flex-1 py-2.5 rounded-xl bg-white/10 hover:bg-white/20 text-xs font-semibold text-gray-300 transition"
                >
                  Cancel
                </button>
                <button
                  onClick={confirmResetProgress}
                  className="flex-1 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-xs font-bold text-white transition shadow-[0_0_15px_rgba(225,29,72,0.6)]"
                >
                  Yes, Reset
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
