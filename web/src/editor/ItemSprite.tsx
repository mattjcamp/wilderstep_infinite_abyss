import { spriteUrl } from "@/data_model/spriteUrl";

/** Small item sprite for an inventory / shop row. Resolves the icon
 *  stem through `spriteUrl` (the same path the game loads item textures
 *  from, so hosted module uploads route correctly). Falls back to a
 *  neutral box when an item has no icon, and hides a broken image rather
 *  than showing the browser's missing-image glyph.
 *
 *  Shared by the counter shop, the party stash, the personal inventory,
 *  and the equipped-slot rows so item art reads identically everywhere.
 *  `size` defaults to 20px (the shop/stash row size); pass a smaller
 *  value for denser lists. */
export function ItemSprite({
  icon,
  size = 20,
  aflame = false,
}: {
  icon?: string;
  size?: number;
  /** Burning item (Sun Sword): flickering fire glow + rising embers. */
  aflame?: boolean;
}) {
  if (!icon) {
    return (
      <span
        aria-hidden
        className="shrink-0 rounded-sm border border-parchment/15 bg-ink/60"
        style={{ width: size, height: size }}
      />
    );
  }
  if (aflame) {
    const ember = Math.max(2, Math.round(size * 0.14));
    return (
      <span
        className="relative inline-block shrink-0"
        style={{ width: size, height: size }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={spriteUrl(`item/${icon}.png`)}
          alt=""
          width={size}
          height={size}
          style={{ imageRendering: "pixelated", width: size, height: size }}
          className="item-aflame-icon object-contain"
          onError={(e) => {
            (e.currentTarget as HTMLImageElement).style.visibility = "hidden";
          }}
        />
        {[
          { left: "28%", delay: "0s", drift: "-2px" },
          { left: "50%", delay: "0.3s", drift: "1px" },
          { left: "66%", delay: "0.6s", drift: "2px" },
        ].map((e) => (
          <span
            key={e.left}
            aria-hidden
            className="item-aflame-ember"
            style={
              {
                left: e.left,
                width: ember,
                height: ember,
                animationDelay: e.delay,
                "--drift": e.drift,
              } as React.CSSProperties
            }
          />
        ))}
      </span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={spriteUrl(`item/${icon}.png`)}
      alt=""
      width={size}
      height={size}
      style={{ imageRendering: "pixelated", width: size, height: size }}
      className="shrink-0 object-contain"
      onError={(e) => {
        (e.currentTarget as HTMLImageElement).style.visibility = "hidden";
      }}
    />
  );
}
