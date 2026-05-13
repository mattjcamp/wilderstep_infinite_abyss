import type { Metadata } from "next";
import "./globals.css";

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
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
