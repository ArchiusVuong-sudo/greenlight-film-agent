import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Greenlight - film assistant",
  description: "Hand the assistant a brief and a credit budget. It plans, prices, asks before it spends and assembles the cut. Synthetic data, simulated renders.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen">{children}</body>
    </html>
  );
}
