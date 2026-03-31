import type { Metadata } from "next";

import { ThemeController } from "@/components/theme-controller";
import { BRAND_NAME } from "@/lib/brand";

import "./globals.css";

export const metadata: Metadata = {
  title: BRAND_NAME,
  description:
    "AI lecture notes with recording, transcription, summaries, and chat.",
  applicationName: BRAND_NAME,
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: BRAND_NAME,
  },
  icons: {
    icon: [
      {
        url: "/favicon-32x32.png?v=2",
        sizes: "32x32",
        type: "image/png",
      },
      {
        url: "/favicon-16x16.png?v=2",
        sizes: "16x16",
        type: "image/png",
      },
      {
        url: "/favicon.ico?v=2",
        sizes: "any",
        type: "image/x-icon",
      },
    ],
    shortcut: "/favicon.ico?v=2",
    apple: [
      {
        url: "/apple-touch-icon.png?v=2",
        sizes: "180x180",
        type: "image/png",
      },
    ],
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
            __html: `
              (function () {
                try {
                  var theme = localStorage.getItem("nota-theme");
                  if (theme === "light" || theme === "dark") {
                    document.documentElement.dataset.theme = theme;
                    document.documentElement.style.colorScheme = theme;
                  } else {
                    document.documentElement.removeAttribute("data-theme");
                    document.documentElement.style.colorScheme = "";
                  }
                } catch (error) {}
              })();
            `,
          }}
        />
      </head>
      <body>
        <ThemeController />
        {children}
      </body>
    </html>
  );
}
