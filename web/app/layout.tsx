import type { Metadata } from "next";
import "./globals.css";
import { SiteNav } from "./SiteNav";

export const metadata: Metadata = {
  title: "Wilderstep: Infinite Abyss",
  description:
    "A turn-based RPG, loosely inspired by classic D&D and Ultima games.",
  // iPhone / iPad "Add to Home Screen": launch without Safari's
  // toolbars so the game gets the whole screen. Only iOS reads these
  // tags; desktop browsers ignore them. (The icon is app/apple-icon.png.)
  appleWebApp: {
    capable: true,
    title: "Wilderstep",
    statusBarStyle: "black-translucent",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      {/* App shell: a global nav bar (hidden during active gameplay) on
          top of a flex-1 content area, so each screen fills the space
          below the bar. */}
      <body className="flex min-h-screen flex-col antialiased">
        <SiteNav />
        <div className="flex min-h-0 flex-1 flex-col">{children}</div>
      </body>
    </html>
  );
}
