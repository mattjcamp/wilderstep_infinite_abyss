Good question to ask before commissioning art. Let me check how the engine actually handles sprite dimensions and scaling, so I give you accurate constraints rather than generic advice.Good news: there's effectively **no limit on the source resolution** of your tile art — and that's exactly why the higher-pixel one looked better. Here's how the engine actually treats sprites, based on the code:

Every map/tile sprite is drawn into a fixed cell via `setDisplaySize(TILE_SIZE, TILE_SIZE)`, and `TILE_SIZE` is **32**. So whatever pixel dimensions your PNG is — 32×32, 64×64, 256×256 — it gets scaled to occupy one 32-pixel cell on screen. A finely-detailed source downsamples to a crisp 32px tile, which reads cleaner than native 32×32 art. (Your set already has a 64×64 and even a 1254×1254 PNG sitting in `public/sprites/` and they render fine.)

So the limits aren't about source size — they're about the grid:

- **Fixed 32px square grid.** Every tile is forced into a 32×32 *square* cell. Commission tiles **square and all the same dimensions**; a non-square source gets squished to fit.
- **One sprite = one cell.** A sprite always occupies a single 32px tile; it can't span a 2×2 footprint. A "big castle" is still one 32px tile, not four.
- **Format is PNG with alpha.** The in-editor Publish path requires `image/png` and lowercase `.png` filenames in lowercase category folders; you can also just drop PNGs into `public/sprites/<category>/` and list them in `index.json`.
- **Rendering is `pixelArt: true` (nearest-neighbor).** Perfect for pixel art at integer scales. For *smooth/HD* art downscaled to 32px, nearest-neighbor point-samples and can look a touch aliased — if you go HD you'd want me to switch those textures to linear filtering.

One layering caveat worth knowing before you commission: terrain and building tiles render as a **single base cell** — transparent areas show the dark canvas behind, *not* an underlying terrain tile. Only items, NPCs, and quest-givers render as overlays *on top of* a base tile. So a "tower sitting on grass" tile needs the ground baked into it (or it sits on the dark background — the current Ultima-style look). True transparent-object-over-terrain layering isn't in the engine today.

For a professional set, my recommendation:

- **Safest:** commission at **64×64, square, consistent, PNG with alpha**, in your palette. It downscales to the current 32px grid cleanly and future-proofs you if you later want bigger tiles.
- **If you want a genuinely bigger/HD on-screen look**, I can raise `TILE_SIZE` (it's essentially one constant, mirrored in `WorldRenderer.ts` and `MapEditor.tsx`) and switch filtering to linear. That's a coordinated change — the play canvas is a fixed 960×720, so larger tiles mean fewer tiles visible, plus the combat arena and camera math key off the tile size — but it's very doable.

If you tell me the native tile size of the set you're eyeing (32, 48, 64…) and whether it's pixel-art or smooth/painted, I can set the engine up to render it at full fidelity rather than downscaling — and confirm the camera/arena framing still works at that size.