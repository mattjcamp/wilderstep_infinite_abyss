import type { Metadata } from "next";
import "./globals.css";
import { SiteNav } from "./SiteNav";

export const metadata: Metadata = {
  title: "Wilderstep: Infinite Abyss",
  description:
    "A turn-based RPG, loosely inspired by classic D&D and Ultima games.",
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
