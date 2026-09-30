# Mandelbrot Explorer

An interactive Mandelbrot set explorer built with WebGL2 and React. Supports deep zoom (up to 1e+16x on standard machine !) with emulated double-precision arithmetic, smooth coloring, and a dynamic tile-based rendering system.

**[Try it online→](https://pyronixus.github.io/mandelbrot-js)**

## Screenshots

<table>
  <tr>
    <td><img src="public/screenshots/1.png" width="400"/></td>
    <td><img src="public/screenshots/2.png" width="400"/></td>
  </tr>
  <tr>
    <td><img src="public/screenshots/3.png" width="400"/></td>
    <td><img src="public/screenshots/4.png" width="400"/></td>
  </tr>
  <tr>
    <td><img src="public/screenshots/5.png" width="400"/></td>
    <td><img src="public/screenshots/6.png" width="400"/></td>
  </tr>
</table>

## Features

### Iterations

You can choose the number of iterations using one of the following methods:
• Manual: Adjust the slider to set a specific value between 64 and 8192.
• Automatic: Enable adaptive iterations to automatically target a constant frame rate (20, 30, or 60 FPS).

### Palettes

You can choose from a variety of 5-color palettes:

#### Natural Elements & Earth
* **Desert:** Warm sand, terracotta, and soft clay tones.
* **Jade:** Rich, soothing greens inspired by precious jade stones.
* **Ocean:** Deep blues, aquas, and refreshing seafoam shades.

#### Metallic & Minerals
* **Amethyst:** Vibrant quartz purples and crystalline lavenders.
* **Copper:** Earthy, metallic oranges and deep brownish-reds.
* **Gold:** Luxurious, shimmering yellows and rich metallic accents.
* **Pearl:** Soft, iridescent whites and delicate cream tones.

#### Atmosphere & Space
* **Abyss:** Dark oceanic depths and profound midnight blues.
* **Aurora:** Luminous greens, purples, and blues of the northern lights.
* **Midnight:** Deepest navy blues and shadowy evening hues.
* **Nebula:** Galactic pinks, deep purples, and cosmic starlight blues.

#### Vibrant & Energetic
* **Electric:** High-voltage neon blues, bright pinks, and cyans.
* **Fire:** Intense gradients of red, orange, and blazing yellow.
* **Prismatic:** A clean, multi-faceted spectrum that mimics refracted light.
* **Rainbow:** A full spectrum of bright, joyful primary and secondary colors.
* **Sakura:** Delicate cherry blossom pinks, soft roses, and gentle whites.
* **Toxic:** Biohazard greens, acid yellows, and sharp contrasting darks.
* **Ultraviolet:** Deep electric purples and glowing neon violet shades.
* **Wine:** Rich burgundies, deep merlots, and sophisticated berry tones.

#### Monochrome & Specialized
* **Grayscale:** Smooth transitions from deep black to pure white.
* **Custom:** Create your own tailored 5-color combination.

### Coordinates

You can see the current X and Y axes, manually adjust them and use the slider or input fields to adjust the zoom (and x-y axes).

### Sharing

You can use the buttons to download the current view as an image or generate a shareable link with your current settings and view.

## Technical Overview

### Rendering

Tiles are rendered entirely on the GPU using **WebGL2 instanced draw calls**. Each frame, all missing tiles are submitted in a single `drawArraysInstanced` call, where the vertex shader positions each tile instance into a packed grid on an offscreen canvas. The CPU then splices individual tile images out of that grid and caches them.

### Precision

At zoom levels below 1×10⁷, coordinates are passed as standard `float`. Beyond that threshold the renderer switches to **emulated double precision** — each coordinate is split into a high and low `float` component (Veltkamp splitting), and all arithmetic in the fragment shader uses double-float (df_add, df_sub, df_mul) routines to recover the lost mantissa bits. This allows zoom depths up to ~1×10¹⁴ without visible rounding artifacts.

### Tiling & LOD

The world is subdivided into a quadtree of tiles at level `L`, where each tile covers a fractal region of size `2⁻ᴸ`. The renderer maintains a tile cache keyed by `(L, x, y)` and evicts tiles that are too distant or too deep relative to the current view. When a new tile is rendered, its pixel data is back-projected into any cached parent tiles to provide smooth LOD transitions while the full-resolution tile loads.

### Iteration Count

The iteration cap scales with zoom depth: `BASE_ITERS + L × ITERS_PER_LEVEL`, capped at `MAX_ITERS`. Coloring uses the smooth escape-time formula with a log₂ correction on the final orbit magnitude, mapped through a custom 5-stop palette.

### Adaptive Performance

Tile rendering is paused while the user is panning or zooming, keeping interaction smooth. When the view is stationary, a frame-time EMA tracks rendering cost and continuously adjusts `tilesPerFrame` — scaling down when the GPU is under pressure and back up when headroom allows, keeping throughput close to the hardware's sustainable limit.

### Stack

- **React 19** — UI and event handling
- **WebGL2** — GPU rendering
- **TypeScript** — typed throughout
- **Vite** — build tooling