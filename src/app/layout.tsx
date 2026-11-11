import type { Metadata, Viewport } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Uray Commerce Intelligence",
    template: "%s · Uray Commerce Intelligence",
  },
  description:
    "Aplikasi internal Madu Uray untuk intelijen e-commerce, portofolio produk, kreatif, event dan afiliasi.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: "#fbfaf7",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="id" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body className="min-h-svh font-sans">{children}</body>
    </html>
  );
}
