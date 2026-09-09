import React, { useEffect, useRef, useCallback, useState } from "react";
import { createCustomPalette, MandelbrotRenderer, palettes } from "./rendering";
import config from "./config";
import { MdDownload, MdShare, MdClose, MdSettings, MdRefresh } from "react-icons/md";
import { FaGithub } from "react-icons/fa";
import { FaUser } from "react-icons/fa6";

interface TileData {
  L: number;
  x: number;
  y: number;
  key: string;
  fractalSize: number;
  canvas: HTMLCanvasElement;
}

interface ViewState {
  x: number;
  y: number;
  scale: number;
}

interface Point {
  x: number;
  y: number;
}

type IterationMode = "manual" | "adaptive20" | "adaptive30" | "adaptive60";

const paletteDetails: Record<string, { label: string; colors: string[] }> = {
  gold: { label: "Gold", colors: ["#001a64", "#206bd0", "#edffff", "#ffab00"] },
  fire: { label: "Fire", colors: ["#050000", "#850000", "#ff6b00", "#ffff5a"] },
  rainbow: { label: "Rainbow", colors: ["#ff304f", "#ffdb45", "#42e8b4", "#4778ff"] },
  grayscale: { label: "Grayscale", colors: ["#08090d", "#424957", "#b5bfce", "#ffffff"] },
  amethyst: { label: "Amethyst", colors: ["#16053e", "#7020ae", "#d94ff2", "#ffe0fa"] },
  abyss: { label: "Abyss", colors: ["#01131f", "#08778a", "#43d6c3", "#d1ffed"] },
  midnight: { label: "Midnight", colors: ["#02030f", "#081c6b", "#513fa6", "#d1c2ff"] },
  wine: { label: "Wine", colors: ["#1a020c", "#690d2d", "#c22e58", "#ffb08d"] },
  ocean: { label: "Ocean", colors: ["#020d1d", "#004e91", "#05bdd1", "#d7fff7"] },
  aurora: { label: "Aurora", colors: ["#031238", "#087ca8", "#31d28d", "#eaff9d"] },
  jade: { label: "Jade", colors: ["#031f18", "#087b4e", "#54db89", "#d5ffe0"] },
  copper: { label: "Copper", colors: ["#261006", "#9e3511", "#f27f32", "#ffed9e"] },
  desert: { label: "Desert", colors: ["#211005", "#a44416", "#f28a27", "#fff0a1"] },
  sakura: { label: "Sakura", colors: ["#1f0612", "#8e1d58", "#ed6788", "#ffe2eb"] },
  electric: { label: "Electric", colors: ["#02031f", "#182de0", "#27dfff", "#f0ffff"] },
  ultraviolet: { label: "Ultraviolet", colors: ["#0e022d", "#4c13c9", "#cc4bff", "#f4d9ff"] },
  toxic: { label: "Toxic", colors: ["#071c03", "#41a90b", "#c4f52f", "#efffc7"] },
  pearl: { label: "Pearl", colors: ["#0c101b", "#6c7890", "#d7deeb", "#fff5d5"] },
  prismatic: { label: "Prismatic", colors: ["#210b75", "#00bfff", "#00e68a", "#ffe000"] },
  nebula: { label: "Nebula", colors: ["#100328", "#7221ac", "#de4ebd", "#ffb1cd"] },
  custom: { label: "Custom", colors: ["#07111f", "#2673b8", "#5de0c0", "#f4d35e", "#f07167"] },
};

function isMobile(): boolean {
  return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
}

function maxItersForShader(): number {
  return config.mandelbrot.BASE_ITERS +
    config.mandelbrot.MAX_LEVEL * config.mandelbrot.ITERS_PER_LEVEL_INIT;
}

function iterationsAtLevel(level: number): number {
  return Math.min(
    maxItersForShader(),
    Math.floor(
      config.mandelbrot.BASE_ITERS +
        Math.max(0, level) * config.mandelbrot.ITERS_PER_LEVEL_INIT,
    ),
  );
}

// --- URL PARAMS (parsed once at module load) ---

const _p = new URLSearchParams(window.location.search);
const _urlParams = {
  x: parseFloat(_p.get("x") ?? ""),
  y: parseFloat(_p.get("y") ?? ""),
  z: parseFloat(_p.get("z") ?? ""),
  pal: _p.get("p") ?? "",
  iters: parseInt(_p.get("i") ?? ""),
};

// --- REACT COMPONENT ---

export default function MandelbrotExplorer() {
  const containerRef = useRef<HTMLDivElement>(null);
  const mainCanvasRef = useRef<HTMLCanvasElement>(null);
  const debugTextRef = useRef<HTMLDivElement>(null);

  const tileCache = useRef<Map<string, TileData>>(new Map());
  const view = useRef<ViewState>({
    x: isFinite(_urlParams.x) ? _urlParams.x : -0.5,
    y: isFinite(_urlParams.y) ? _urlParams.y : 0,
    scale: isFinite(_urlParams.z) && _urlParams.z > 0 ? _urlParams.z : 100,
  });
  const activePointers = useRef<Map<number, Point>>(new Map());
  const loopRef = useRef<number>(0);

  const rendererRef = useRef<MandelbrotRenderer | null>(null);
  const isRenderingRef = useRef<boolean>(false);
  const isInteractingRef = useRef<boolean>(false);
  const lastZoomTimeRef = useRef<number>(0);

  // --- DYNAMIC FPS SCALING ---
  const tilesPerFrameRef = useRef<number>(config.tile.INITIAL_TILES_PER_FRAME);
  const lastFrameTimeRef = useRef<number>(0);
  const wasLastIntensiveRef = useRef<boolean>(false);
  const emaDurationRef = useRef<number>(1000 / 60);
  const emaDuration2Ref = useRef<number>((1000 / 60) ** 2);

  const [showInstructions, setShowInstructions] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [viewVersion, setViewVersion] = useState(0);
  const [itersPerLevel, setItersPerLevel] = useState(() => {
    const val = _urlParams.iters;
    if (isFinite(val) && val > 0) {
      config.mandelbrot.ITERS_PER_LEVEL_INIT = val;
      return val;
    }
    const defaultIters = isMobile()
      ? config.mandelbrot.ITERS_PER_LEVEL_INIT_MOBILE
      : config.mandelbrot.ITERS_PER_LEVEL_INIT;
    config.mandelbrot.ITERS_PER_LEVEL_INIT = defaultIters;
    return defaultIters;
  });
  const [iterationMode, setIterationMode] = useState<IterationMode>("manual");
  const iterationModeRef = useRef<IterationMode>("manual");
  const lastAdaptiveUpdateRef = useRef(0);
  const [palette, setPalette] = useState(() =>
    _urlParams.pal && _urlParams.pal in palettes
      ? _urlParams.pal
      : config.mandelbrot.DEFAULT_PALETTE,
  );
  const [customColors, setCustomColors] = useState(paletteDetails.custom.colors);

  const setIterationModeAndSync = (mode: IterationMode) => {
    iterationModeRef.current = mode;
    setIterationMode(mode);
  };

  // Hide instructions after 10 seconds
  useEffect(() => {
    const timer = setTimeout(() => {
      setShowInstructions(false);
    }, config.interaction.INSTRUCTIONS_HIDE_MS);
    return () => clearTimeout(timer);
  }, []);

  // Preview animation: after delay, fly to target location
  useEffect(() => {
    if (!config.preview.ENABLED) return;
    let rafId: number;
    const delayTimer = setTimeout(() => {
      const startView = { ...view.current };
      const startLogScale = Math.log(startView.scale);
      const targetLogScale = Math.log(config.preview.TARGET.z);
      const startTime = performance.now();

      const k = 50;
      const norm = 1 - Math.exp(-k);

      const animate = () => {
        if (isInteractingRef.current) return;
        const t = Math.min(
          (performance.now() - startTime) / config.preview.DURATION_MS,
          1,
        );
        const te = t < 1 ? (1 - Math.exp(-k * t)) / norm : 1;
        view.current.x =
          startView.x + (config.preview.TARGET.x - startView.x) * te;
        view.current.y =
          startView.y + (config.preview.TARGET.y - startView.y) * te;
        view.current.scale = Math.exp(
          startLogScale + (targetLogScale - startLogScale) * t,
        );
        if (t < 1) rafId = requestAnimationFrame(animate);
      };

      rafId = requestAnimationFrame(animate);
    }, config.preview.START_DELAY_MS);

    return () => {
      clearTimeout(delayTimer);
      cancelAnimationFrame(rafId);
    };
  }, []);

  // --- ENFORCE COORDINATE AND ZOOM LIMITS ---
  const enforceLimits = useCallback(() => {
    if (!containerRef.current) return;
    const { width, height } = containerRef.current.getBoundingClientRect();

    const {
      BOUNDS_MIN_X,
      BOUNDS_MAX_X,
      BOUNDS_MIN_Y,
      BOUNDS_MAX_Y,
    } = config.limits;

    // Clamp coordinates to the supported world bounds.
    const worldWidth = width / view.current.scale;
    const worldHeight = height / view.current.scale;

    const maxAllowedX = BOUNDS_MAX_X - worldWidth / 2;
    const minAllowedX = BOUNDS_MIN_X + worldWidth / 2;
    const maxAllowedY = BOUNDS_MAX_Y - worldHeight / 2;
    const minAllowedY = BOUNDS_MIN_Y + worldHeight / 2;

    // Handle X Bounds
    if (minAllowedX > maxAllowedX) {
      // Screen is wider than allowed world bounds at this scale - lock to center
      view.current.x = (BOUNDS_MIN_X + BOUNDS_MAX_X) / 2;
    } else {
      view.current.x = Math.max(
        minAllowedX,
        Math.min(maxAllowedX, view.current.x),
      );
    }

    // Handle Y Bounds
    if (minAllowedY > maxAllowedY) {
      // Screen is taller than allowed world bounds at this scale - lock to center
      view.current.y = (BOUNDS_MIN_Y + BOUNDS_MAX_Y) / 2;
    } else {
      view.current.y = Math.max(
        minAllowedY,
        Math.min(maxAllowedY, view.current.y),
      );
    }
  }, []);

  useEffect(() => {
    return () => {
      cancelAnimationFrame(loopRef.current);
    };
  }, []);

  const renderFrame = useCallback(
    (time: number) => {
      if (!containerRef.current || !mainCanvasRef.current) return;

      const canvas = mainCanvasRef.current;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const { width, height } = containerRef.current.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const physicalSize = Math.floor(config.tile.TILE_SIZE * dpr);

      let screenWasResized = false;
      if (
        canvas.width !== Math.floor(width * dpr) ||
        canvas.height !== Math.floor(height * dpr)
      ) {
        canvas.width = Math.floor(width * dpr);
        canvas.height = Math.floor(height * dpr);
        screenWasResized = true;
      }

      // Automatically enforce coordinate limits if the screen changed dimensions
      if (screenWasResized) enforceLimits();

      const { x: vx, y: vy, scale } = view.current;

      const worldBounds = {
        left: vx - width / 2 / scale,
        right: vx + width / 2 / scale,
        top: vy - height / 2 / scale,
        bottom: vy + height / 2 / scale,
      };

      const targetL = Math.floor(Math.log2(scale / config.tile.TILE_SIZE));
      const currentTilesPerFrame =
        (isInteractingRef.current || showModal) && !config.preview.ENABLED
          ? 0
          : tilesPerFrameRef.current;
      let isCurrentFrameIntensive = false;

      // 1. Render missing tiles using WebGL Instance Batching
      if (!isRenderingRef.current && currentTilesPerFrame > 0) {
        const missing = [];

        for (let L = Math.min(-3, targetL - 4); L <= targetL + 4; L++) {
          if (missing.length >= currentTilesPerFrame) {
            break;
          }

          const fSize = Math.pow(2, -L);
          const minX = Math.floor(worldBounds.left / fSize);
          const maxX = Math.floor(worldBounds.right / fSize);
          const minY = Math.floor(worldBounds.top / fSize);
          const maxY = Math.floor(worldBounds.bottom / fSize);

          for (let tx = minX; tx <= maxX; tx++) {
            for (let ty = minY; ty <= maxY; ty++) {
              const key = `${L}_${tx}_${ty}`;
              if (!tileCache.current.has(key)) {
                missing.push({ L, x: tx, y: ty, key, fSize });
              }
            }
          }
        }

        if (missing.length > 0) {
          missing.sort((a, b) => {
            const distA = Math.hypot(
              (a.x + 0.5) * a.fSize - vx,
              (a.y + 0.5) * a.fSize - vy,
            );
            const distB = Math.hypot(
              (b.x + 0.5) * b.fSize - vx,
              (b.y + 0.5) * b.fSize - vy,
            );
            return a.L - b.L || distA - distB;
          });

          const targets = missing.slice(0, currentTilesPerFrame);

          if (targets.length >= tilesPerFrameRef.current) {
            isCurrentFrameIntensive = true;
          }

          const currentMaxIters = maxItersForShader();
          const paletteSource =
            palette === "custom"
              ? createCustomPalette(customColors)
              : palettes[palette];
          if (
            !rendererRef.current ||
            rendererRef.current.physicalSize !== physicalSize ||
            rendererRef.current.palette !== paletteSource ||
            rendererRef.current.maxIters !== currentMaxIters
          ) {
            rendererRef.current?.delete();
            rendererRef.current = new MandelbrotRenderer(
              physicalSize,
              config.tile.MAX_TILES_PER_FRAME,
              paletteSource,
              currentMaxIters,
            );
          }

          // --- Execute Batched Draw Call ---
          rendererRef.current.renderBatch(
            targets.map((target) => ({
              fx: target.x * target.fSize,
              fy: target.y * target.fSize,
              size: target.fSize,
              iters: iterationsAtLevel(target.L),
              useDouble: scale > 1e7,
            })),
          );

          // --- Distribute Rendered Data to Tiles ---
          for (let i = 0; i < targets.length; i++) {
            const target = targets[i];
            const tileCanvas = document.createElement("canvas");
            tileCanvas.width = physicalSize;
            tileCanvas.height = physicalSize;
            const tileCtx = tileCanvas.getContext("2d");

            if (tileCtx) {
              // Find its position in the WebGL instance grid
              const col = i % rendererRef.current.tilesPerRow;
              const row = Math.floor(i / rendererRef.current.tilesPerRow);
              const sx = col * physicalSize;
              const sy = row * physicalSize;

              // Splice exactly this tile out of the master canvas map
              tileCtx.drawImage(
                rendererRef.current.canvas,
                sx,
                sy,
                physicalSize,
                physicalSize,
                0,
                0,
                physicalSize,
                physicalSize,
              );

              // Interpolate parent tile imagery for LOD continuity
              for (let dL = 1; dL <= 4; dL++) {
                const pL = target.L - dL;
                const divisor = Math.pow(2, dL);
                const px = Math.floor(target.x / divisor);
                const py = Math.floor(target.y / divisor);
                const pKey = `${pL}_${px}_${py}`;

                const parentTile = tileCache.current.get(pKey);
                if (parentTile) {
                  const pCtx = parentTile.canvas.getContext("2d");
                  if (pCtx) {
                    const rx = target.x - px * divisor;
                    const ry = target.y - py * divisor;
                    const subSize = physicalSize / divisor;
                    pCtx.drawImage(
                      tileCanvas,
                      rx * subSize,
                      ry * subSize,
                      subSize,
                      subSize,
                    );
                  }
                }
              }
            }

            tileCache.current.set(target.key, {
              ...target,
              fractalSize: target.fSize,
              canvas: tileCanvas,
            });
          }
        }
      }

      // --- DYNAMIC FPS SCALING LOGIC ---
      if (lastFrameTimeRef.current !== 0) {
        const deltaTime = time - lastFrameTimeRef.current;

        if (wasLastIntensiveRef.current && isCurrentFrameIntensive) {
          emaDurationRef.current =
            0.2 * deltaTime + 0.8 * emaDurationRef.current;
          emaDuration2Ref.current =
            0.2 * deltaTime * deltaTime + 0.8 * emaDuration2Ref.current;

          const variance =
            emaDuration2Ref.current - emaDurationRef.current ** 2;
          const sd = Math.sqrt(Math.max(0, variance));
          const refFps = 1000 / (emaDurationRef.current + 2 * sd);

          const adaptiveTargets: Record<Exclude<IterationMode, "manual">, number> = {
            adaptive20: 20,
            adaptive30: 30,
            adaptive60: 60,
          };
          const adaptiveTarget =
            iterationModeRef.current === "manual"
              ? null
              : adaptiveTargets[iterationModeRef.current];
          if (
            adaptiveTarget !== null &&
            time - lastAdaptiveUpdateRef.current > 400
          ) {
            const currentIterations = config.mandelbrot.ITERS_PER_LEVEL_INIT;
            const nextIterations =
              refFps < adaptiveTarget - 1
                ? Math.max(64, currentIterations - 64)
                : refFps > adaptiveTarget + 1
                  ? Math.min(8192, currentIterations + 64)
                  : currentIterations;
            if (nextIterations !== currentIterations) {
              config.mandelbrot.ITERS_PER_LEVEL_INIT = nextIterations;
              setItersPerLevel(nextIterations);
              tileCache.current.clear();
              lastAdaptiveUpdateRef.current = time;
            }
          }

          if (refFps < 15) {
            tilesPerFrameRef.current = Math.max(
              1,
              Math.floor(tilesPerFrameRef.current / 1.25),
            );
            emaDurationRef.current /= 1.25;
            emaDuration2Ref.current /= 1.25 * 1.25;
          } else if (refFps > 20) {
            tilesPerFrameRef.current = Math.min(
              config.tile.MAX_TILES_PER_FRAME,
              Math.floor(tilesPerFrameRef.current * 1.25 + 1),
            );
            emaDurationRef.current *= 1.25;
            emaDuration2Ref.current *= 1.25 * 1.25;
          }
        }
      }

      lastFrameTimeRef.current = time;
      wasLastIntensiveRef.current = isCurrentFrameIntensive;

      // 2. Cleanup distant tiles
      for (const [key, tile] of tileCache.current.entries()) {
        const isTooDeep = tile.L > targetL + 5;
        const dist = Math.hypot(
          (tile.x + 0.5) * tile.fractalSize - vx,
          (tile.y + 0.5) * tile.fractalSize - vy,
        );
        const isTooFar = dist > (width * 3) / scale + tile.fractalSize;

        if (isTooDeep || isTooFar) tileCache.current.delete(key);
      }

      // 3. Paint Frame
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const cx = canvas.width / 2;
      const cy = canvas.height / 2;
      const physicalScale = scale * dpr;

      const drawableTiles = Array.from(tileCache.current.values())
        .filter((t) => t.L <= targetL + 1)
        .sort((a, b) => a.L - b.L);

      for (const tile of drawableTiles) {
        const tx = tile.x * tile.fractalSize;
        const ty = tile.y * tile.fractalSize;

        const screenX = cx + (tx - vx) * physicalScale;
        const screenY = cy + (ty - vy) * physicalScale;
        const drawSize = tile.fractalSize * physicalScale;

        if (
          screenX + drawSize < 0 ||
          screenX > canvas.width ||
          screenY + drawSize < 0 ||
          screenY > canvas.height ||
          tile.L >= targetL + 2
        ) {
          continue;
        }

        ctx.imageSmoothingEnabled = tile.L <= targetL - 2 ? false : true;

        ctx.drawImage(
          tile.canvas,
          screenX,
          screenY,
          drawSize + 0.5,
          drawSize + 0.5,
        );
      }

      if (debugTextRef.current) {
        const currentIters = iterationsAtLevel(targetL);
        const mode = scale > 1e7 ? "DOUBLE" : "FLOAT";
        const displayFps = Math.round(1000 / emaDurationRef.current);

        const newText = `CACHED: ${tileCache.current.size} | ZOOM: ${scale.toExponential(2)} | ITERS: ${currentIters} | PRECISION: ${mode} | FPS: ${displayFps} | TILES/FR: ${tilesPerFrameRef.current}`;
        if (debugTextRef.current.innerText !== newText) {
          debugTextRef.current.innerText = newText;
        }
      }

      loopRef.current = requestAnimationFrame(renderFrame);
    },
    [customColors, enforceLimits, palette, showModal],
  );

  useEffect(() => {
    loopRef.current = requestAnimationFrame(renderFrame);
    return () => {
      cancelAnimationFrame(loopRef.current);
      rendererRef.current?.delete();
      rendererRef.current = null;
    };
  }, [renderFrame]);

  const interactionTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

  const clampZoomMultiplier = (multiplier: number): number => {
    const now = performance.now();
    const elapsed = Math.min((now - lastZoomTimeRef.current) / 1000, 1);
    lastZoomTimeRef.current = now;
    const maxFactor = Math.pow(config.limits.MAX_ZOOM_FACTOR_PER_SEC, elapsed);
    return Math.min(maxFactor, multiplier);
  };

  const adjustTilesForZoom = (prevScale: number, newScale: number) => {
    if (newScale <= prevScale) return;
    const prevLevel = Math.floor(Math.log2(prevScale / config.tile.TILE_SIZE));
    const newLevel = Math.floor(Math.log2(newScale / config.tile.TILE_SIZE));
    if (newLevel <= prevLevel) return;
    const ratio = iterationsAtLevel(prevLevel) / iterationsAtLevel(newLevel);
    tilesPerFrameRef.current = Math.max(
      1,
      Math.floor(tilesPerFrameRef.current * ratio),
    );
  };

  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault();

    const zoomMultiplier = Math.pow(0.99, e.deltaY * 0.1);

    const rect = containerRef.current!.getBoundingClientRect();

    const mx = e.clientX - rect.left - rect.width / 2;
    const my = e.clientY - rect.top - rect.height / 2;

    const fx = view.current.x + mx / view.current.scale;
    const fy = view.current.y + my / view.current.scale;

    const prevScale = view.current.scale;
    view.current.scale *= clampZoomMultiplier(zoomMultiplier);
    adjustTilesForZoom(prevScale, view.current.scale);
    view.current.x = fx - mx / view.current.scale;
    view.current.y = fy - my / view.current.scale;

    isInteractingRef.current = true;
    if (interactionTimeoutRef.current)
      clearTimeout(interactionTimeoutRef.current);
    interactionTimeoutRef.current = setTimeout(() => {
      isInteractingRef.current = false;
    }, config.interaction.WHEEL_IDLE_MS);
    enforceLimits(); // Apply constraints after zoom
  };

  const onPointerDown = (e: React.PointerEvent) => {
    isInteractingRef.current = true;
    if (interactionTimeoutRef.current)
      clearTimeout(interactionTimeoutRef.current);
    containerRef.current?.setPointerCapture(e.pointerId);
    activePointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!activePointers.current.has(e.pointerId)) return;

    const prev = activePointers.current.get(e.pointerId)!;
    const curr = { x: e.clientX, y: e.clientY };

    if (activePointers.current.size === 1) {
      const dx = curr.x - prev.x;
      const dy = curr.y - prev.y;
      view.current.x -= dx / view.current.scale;
      view.current.y -= dy / view.current.scale;

      enforceLimits(); // Apply constraints after pan
    } else if (activePointers.current.size === 2) {
      const pointersList = Array.from(activePointers.current.entries());
      const otherPointData = pointersList.find(([id]) => id !== e.pointerId);

      if (otherPointData) {
        const other = otherPointData[1];

        const prevDist = Math.hypot(prev.x - other.x, prev.y - other.y);
        const currDist = Math.hypot(curr.x - other.x, curr.y - other.y);

        const prevCenter = {
          x: (prev.x + other.x) / 2,
          y: (prev.y + other.y) / 2,
        };
        const currCenter = {
          x: (curr.x + other.x) / 2,
          y: (curr.y + other.y) / 2,
        };

        if (prevDist > 0) {
          const zoomMultiplier = clampZoomMultiplier(currDist / prevDist);
          const rect = containerRef.current!.getBoundingClientRect();

          const prevMx = prevCenter.x - rect.left - rect.width / 2;
          const prevMy = prevCenter.y - rect.top - rect.height / 2;
          const focalWorldX = view.current.x + prevMx / view.current.scale;
          const focalWorldY = view.current.y + prevMy / view.current.scale;

          const prevScale = view.current.scale;
          view.current.scale *= zoomMultiplier;
          adjustTilesForZoom(prevScale, view.current.scale);
          enforceLimits(); // Apply constraints after pinch zoom

          const currMx = currCenter.x - rect.left - rect.width / 2;
          const currMy = currCenter.y - rect.top - rect.height / 2;
          view.current.x = focalWorldX - currMx / view.current.scale;
          view.current.y = focalWorldY - currMy / view.current.scale;
          enforceLimits(); // Apply constraints after pinch zoom
        }
      }
    }

    activePointers.current.set(e.pointerId, curr);
  };

  const onPointerUpOrCancel = (e: React.PointerEvent) => {
    activePointers.current.delete(e.pointerId);
    if (activePointers.current.size === 0) {
      if (interactionTimeoutRef.current)
        clearTimeout(interactionTimeoutRef.current);
      interactionTimeoutRef.current = setTimeout(() => {
        isInteractingRef.current = false;
      }, config.interaction.POINTER_IDLE_MS);
    }
    containerRef.current?.releasePointerCapture(e.pointerId);
  };

  const resetView = () => {
    view.current = {
      x: isFinite(_urlParams.x) ? _urlParams.x : -0.5,
      y: isFinite(_urlParams.y) ? _urlParams.y : 0,
      scale: isFinite(_urlParams.z) && _urlParams.z > 0 ? _urlParams.z : 100,
    };
    enforceLimits();
    tileCache.current.clear();
    tilesPerFrameRef.current = config.tile.INITIAL_TILES_PER_FRAME;
    lastFrameTimeRef.current = 0;
    wasLastIntensiveRef.current = false;
    setViewVersion((version) => version + 1);
  };

  return (
    <div className="w-dvw h-dvh relative">
      <div
        ref={containerRef}
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUpOrCancel}
        onPointerCancel={onPointerUpOrCancel}
        className={`w-full h-full overflow-hidden relative bg-black touch-none select-none overscroll-none ${activePointers.current.size > 0 ? "cursor-grabbing" : "cursor-grab"}`}
      >
        <canvas ref={mainCanvasRef} className="w-full h-full block" />
        {config.DEBUG_MODE && (
          <div
            ref={debugTextRef}
            className={`absolute top-2.5 left-2.5 text-white bg-black/60 p-2.5 rounded-lg font-mono pointer-events-none text-[10px]`}
          >
            Initializing Explorer...
          </div>
        )}

        <div
          className={`absolute top-5 left-1/2 -translate-x-1/2 text-white bg-black/70 px-5 py-3 rounded-lg font-sans font-bold tracking-[1px] pointer-events-none text-sm transition-opacity duration-500 whitespace-nowrap z-10 ${showInstructions ? "opacity-100" : "opacity-0"}`}
        >
          DRAG TO MOVE, SCROLL TO ZOOM
        </div>
      </div>

      <div className="absolute bottom-5 right-5 z-10">
        <button
          onClick={() => setShowModal(true)}
          className="w-11 h-11 rounded-full border-none bg-black/60 text-white cursor-pointer flex items-center justify-center text-[22px]"
          title="About"
        >
          <MdSettings />
        </button>
      </div>
      {showModal && (
        <div
          className="absolute inset-0 bg-black/70 flex items-center justify-center z-20"
          onClick={() => setShowModal(false)}
        >
          <div
            className="settings-modal-panel bg-[#111] text-white rounded-2xl p-8 max-w-sm w-[90%] flex flex-col gap-5 relative"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => setShowModal(false)}
              className="absolute top-4 right-4 text-white/50 hover:text-white cursor-pointer text-[22px] bg-transparent border-none"
            >
              <MdClose />
            </button>

            <div>
              <h2 className="text-xl font-bold mb-5">Settings</h2>
              <div className="rounded-xl bg-white/4 px-4 py-4">
                <div className="flex items-center justify-between gap-4 mb-3">
                  <label htmlFor="iterations" className="text-sm text-white/65">
                    Number of iterations
                  </label>
                  <output htmlFor="iterations" className="text-sm font-semibold tabular-nums text-white">
                    {iterationMode === "manual"
                      ? itersPerLevel.toLocaleString()
                      : iterationMode === "adaptive20"
                        ? "Adaptive · 20 FPS"
                        : iterationMode === "adaptive30"
                          ? "Adaptive · 30 FPS"
                          : "Adaptive · 60 FPS"}
                  </output>
                </div>
                <div className="iteration-mode-grid">
                  {(["manual", "adaptive20", "adaptive30", "adaptive60"] as IterationMode[]).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      className={`iteration-mode-button ${iterationMode === mode ? "iteration-mode-active" : ""}`}
                      onClick={() => setIterationModeAndSync(mode)}
                    >
                      {mode === "manual" ? (
                        <>
                          <span className="iteration-mode-value">Manual</span>
                          <span className="iteration-mode-caption">Fixed detail</span>
                        </>
                      ) : (
                        <>
                          <span className="iteration-mode-value">{mode.replace("adaptive", "")}</span>
                          <span className="iteration-mode-caption">FPS target</span>
                        </>
                      )}
                    </button>
                  ))}
                </div>
                <input
                  id="iterations"
                  type="range"
                  min={64}
                  max={8192}
                  step={64}
                  value={itersPerLevel}
                  disabled={iterationMode !== "manual"}
                  onChange={(e) => {
                    const val = Number(e.target.value);
                    setItersPerLevel(val);
                    config.mandelbrot.ITERS_PER_LEVEL_INIT = val;
                    tileCache.current.clear();
                  }}
                  className="settings-range w-full"
                />
                <div className="mt-2 flex justify-between text-[10px] uppercase tracking-[0.14em] text-white/30">
                  <span>Fast</span>
                  <span>Detailed</span>
                </div>
              </div>

              <div className="mt-5">
                <div className="mb-3 flex items-center justify-between">
                  <span className="text-sm text-white/65">Color palette</span>
                  <span className="text-xs font-medium text-white/40">
                    {paletteDetails[palette]?.label ?? palette}
                  </span>
                </div>
                <div className="palette-grid">
                  {Object.keys(paletteDetails).map((name) => {
                    const details = name === "custom"
                      ? { ...paletteDetails.custom, colors: customColors }
                      : paletteDetails[name];
                    return (
                      <button
                        key={name}
                        type="button"
                        aria-label={`Use ${details.label} palette`}
                        aria-pressed={palette === name}
                        title={details.label}
                        onClick={() => {
                          setPalette(name);
                          tileCache.current.clear();
                        }}
                        className={`palette-swatch ${palette === name ? "palette-swatch-active" : ""}`}
                        style={{
                          background: `linear-gradient(135deg, ${details.colors.join(", ")})`,
                        }}
                      />
                    );
                  })}
                </div>
                {palette === "custom" && (
                  <div className="mt-4 flex items-center justify-between rounded-lg bg-white/4 px-3 py-2">
                    <span className="text-xs text-white/45">Customize gradient</span>
                    <div className="flex gap-2">
                      {customColors.map((color, index) => (
                        <label key={index} className="custom-color-input" style={{ backgroundColor: color }}>
                          <span className="sr-only">Custom color {index + 1}</span>
                          <input
                            type="color"
                            value={color}
                            onChange={(e) => {
                              const nextColors = [...customColors];
                              nextColors[index] = e.target.value;
                              setCustomColors(nextColors);
                              setPalette("custom");
                              tileCache.current.clear();
                            }}
                          />
                        </label>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div>
              <h2 className="text-xl font-bold mb-3">Current View</h2>
              <div
                key={viewVersion}
                className="bg-white/5 rounded-xl px-4 py-3 font-mono text-xs flex flex-col gap-2"
              >
                {(() => {
                  const { x, y, scale } = view.current;
                  const decimals = Math.min(15, Math.ceil(Math.log10(scale)));
                  return (
                    <>
                      <div className="flex justify-between">
                        <span className="text-white/40">X</span>
                        <span>{x.toFixed(decimals)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-white/40">Y</span>
                        <span>{y.toFixed(decimals)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-white/40">Zoom</span>
                        <span>{scale.toExponential(2)}</span>
                      </div>
                    </>
                  );
                })()}
              </div>
              <div className="flex flex-col gap-2 mt-3">
                <button
                  onClick={resetView}
                  className="flex items-center gap-3 px-4 py-2.5 rounded-lg bg-white/10 hover:bg-white/20 text-white text-sm cursor-pointer border-none transition-colors"
                >
                  <MdRefresh className="text-base mr-1 shrink-0" /> Reset view
                </button>
                <button
                  onClick={() => {
                    const canvas = mainCanvasRef.current;
                    if (!canvas) return;
                    const { x, y, scale } = view.current;
                    const now = new Date();
                    const date = now.toISOString().slice(0, 10);
                    const time = now
                      .toTimeString()
                      .slice(0, 8)
                      .replace(/:/g, "-");
                    const decimals = Math.min(15, Math.ceil(Math.log10(scale)));
                    const link = document.createElement("a");
                    link.download = `mandelbrot_${date}_${time}_${x.toFixed(decimals)}_${y.toFixed(decimals)}_${scale.toExponential(1)}.png`;
                    link.href = canvas.toDataURL("image/png");
                    link.click();
                  }}
                  className="flex items-center gap-3 px-4 py-2.5 rounded-lg bg-white/10 hover:bg-white/20 text-white text-sm cursor-pointer border-none transition-colors"
                >
                  <MdDownload className="text-base mr-1 shrink-0" /> Download
                  current view as image
                </button>
                <button
                  onClick={() => {
                    const canvas = mainCanvasRef.current;
                    const { x, y, scale } = view.current;
                    const decimals = Math.min(15, Math.ceil(Math.log10(scale)));
                    const params = new URLSearchParams({
                      x: x.toFixed(decimals),
                      y: y.toFixed(decimals),
                      z: scale.toExponential(1).replace(/e\+?/, "e"),
                      p: palette,
                      i: String(itersPerLevel),
                    });
                    const url = `https://mandelbrot.musat.ai?${params}`;
                    const text = `Check out this Mandelbrot view: ${url}`;
                    if (isMobile() && navigator.share && canvas) {
                      const maxSize = 720;
                      const scale2 = Math.min(
                        1,
                        maxSize / Math.max(canvas.width, canvas.height),
                      );
                      const thumb = document.createElement("canvas");
                      thumb.width = Math.round(canvas.width * scale2);
                      thumb.height = Math.round(canvas.height * scale2);
                      thumb
                        .getContext("2d")!
                        .drawImage(canvas, 0, 0, thumb.width, thumb.height);
                      thumb.toBlob((blob) => {
                        if (!blob) return;
                        const file = new File([blob], "mandelbrot.png", {
                          type: "image/png",
                        });
                        const shareData = { text, files: [file] };
                        if (navigator.canShare?.(shareData)) {
                          navigator.share(shareData);
                        } else {
                          navigator.share({ text });
                        }
                      }, "image/png");
                    } else {
                      navigator.clipboard
                        .writeText(url)
                        .then(() => alert("Link copied to clipboard!"));
                    }
                  }}
                  className="flex items-center gap-3 px-4 py-2.5 rounded-lg bg-white/10 hover:bg-white/20 text-white text-sm cursor-pointer border-none transition-colors"
                >
                  <MdShare className="text-base mr-1 shrink-0" /> Share current
                  view via link
                  {isMobile() ? " and image" : ""}
                </button>
              </div>
            </div>

            <div className="flex flex-col gap-3">
              <h2 className="text-xl font-bold mb-1">About the project</h2>

              <a
                href="https://github.com/tiberiu02/mandelbrot-js"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-3 text-sm text-white opacity-80 hover:opacity-100 transition-opacity"
              >
                <div className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center text-xl shrink-0">
                  <FaGithub />
                </div>
                <div>
                  <div className="font-semibold">Source Code on GitHub</div>
                  <div className="text-white/40 text-xs text-ellipsis w-full text-nowrap grow-0">
                    github.com/tiberiu02/mandelbrot-js
                  </div>
                </div>
              </a>

              <a
                href="https://musat.ai"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-3 text-sm text-white opacity-80 hover:opacity-100 transition-opacity"
              >
                <div className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center text-base shrink-0">
                  <FaUser />
                </div>
                <div>
                  <div className="font-semibold">Created by Tiberiu Musat</div>
                  <div className="text-white/40 text-xs">
                    Read more at https://musat.ai
                  </div>
                </div>
              </a>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}