import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "NYC Transit Map",
  description: "A map showing the positions of subways and ferries in NYC.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
