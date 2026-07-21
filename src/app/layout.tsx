import type { Metadata } from "next";
import { Geist, Geist_Mono, Playfair_Display } from "next/font/google";
import Image from "next/image";
import Link from "next/link";
import "./globals.css";
import ThemeScript from "@/components/ThemeScript";
import SpotPriceTicker from "@/components/SpotPriceTicker";
import SalesQuoteBanner from "@/components/SalesQuoteBanner";
import SettingsMenu from "@/components/SettingsMenu";
import GlobalSearch from "@/components/GlobalSearch";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const playfair = Playfair_Display({
  variable: "--font-playfair",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Premier Rare Coins — New Client Tracker",
  description: "15-day new client blitz tracker",
  icons: {
    icon: "/brand/favicon-32.png",
    apple: "/brand/eagle-mark-180.png",
  },
};

const NAV_LINKS = [
  { href: "/", label: "Dashboard" },
  { href: "/follow-up", label: "50% Follow-Up" },
  { href: "/book", label: "Clients" },
  { href: "/campaigns", label: "Campaigns" },
];

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${playfair.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        <ThemeScript />
      </head>
      <body className="flex min-h-full flex-col bg-background text-foreground">
        <header className="bg-header-bg text-header-foreground">
          <SalesQuoteBanner />
          <nav className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
            <Link href="/" className="flex items-center gap-2.5">
              <Image
                src="/brand/eagle-mark-512.png"
                alt=""
                width={32}
                height={32}
                priority
                className="h-8 w-8"
              />
              <span className="font-sans text-lg font-bold tracking-widest text-gold-bright">PRC</span>
            </Link>

            <div className="flex flex-wrap gap-x-6 gap-y-1 font-sans text-sm font-semibold uppercase tracking-widest text-header-foreground">
              {NAV_LINKS.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  className="transition-colors hover:text-gold-bright"
                >
                  {link.label}
                </Link>
              ))}
            </div>

            <div className="ml-auto flex items-center gap-4">
              <GlobalSearch />
              <SpotPriceTicker />
              <SettingsMenu />
            </div>
          </nav>
        </header>

        <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6">{children}</main>

        <footer className="border-t border-border py-4 text-center text-xs text-muted-foreground">
          Premier Rare Coins &middot; prc.gold
        </footer>
      </body>
    </html>
  );
}
