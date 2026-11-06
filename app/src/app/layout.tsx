import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { getSession } from "@/lib/auth";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Kapima Bokför",
  description: "Bokföring, fakturering och moms för småföretag",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#faf9f7" },
    { media: "(prefers-color-scheme: dark)", color: "#141312" },
  ],
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Användarens val av tema; "system" (eller utloggad) följer operativsystemet.
  const theme = (await getSession())?.user.theme;
  return (
    <html lang="sv" data-theme={theme === "light" || theme === "dark" ? theme : undefined}>
      <body className={`${geistSans.variable} ${geistMono.variable} font-sans antialiased`}>{children}</body>
    </html>
  );
}
