import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "City in Motion",
  description: "New York in motion. Scheduled and live subway and ferry journeys on a quiet map.",
  other: {
    "codex-preview": "development",
  },
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
