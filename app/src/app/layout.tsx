import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { getSession } from "@/lib/auth";
import "./globals.css";

const inter = Inter({ variable: "--font-inter", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Kapima Bokför",
  description: "Bokföring, fakturering och moms för småföretag",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f5f5f7" },
    { media: "(prefers-color-scheme: dark)", color: "#000000" },
  ],
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Användarens val av tema; "system" (eller utloggad) följer operativsystemet.
  const theme = (await getSession())?.user.theme;
  return (
    <html lang="sv" data-theme={theme === "light" || theme === "dark" ? theme : undefined}>
      <body className={`${inter.variable} font-sans antialiased`}>{children}</body>
    </html>
  );
}
