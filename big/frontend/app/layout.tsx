import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "./providers";
import { ErrorBoundary } from "@/components/ErrorBoundary";

export const metadata: Metadata = {
  title: "BIG Market - Prediction Market",
  description: "Decentralized prediction market platform",
  icons: {
    icon: "/favicon.png",
    shortcut: "/favicon.png",
    apple: "/favicon.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){var s=document.documentElement.getAttribute('data-theme')||localStorage.getItem('theme');var p=window.matchMedia('(prefers-color-scheme: dark)').matches;var d=s==='dark'||(s!=='light'&&p);document.documentElement.classList.toggle('dark',d);})();`,
          }}
        />
      </head>
      <body className="min-h-screen bg-[var(--bg)] text-[var(--fg)] antialiased">
        <ErrorBoundary>
          <Providers>{children}</Providers>
        </ErrorBoundary>
      </body>
    </html>
  );
}
