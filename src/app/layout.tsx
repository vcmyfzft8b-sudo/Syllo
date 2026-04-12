import type { Metadata } from "next";
import { Analytics } from "@vercel/analytics/next";

import { ThemeController } from "@/components/theme-controller";
import { BRAND_NAME } from "@/lib/brand";

import "./globals.css";

export const metadata: Metadata = {
  title: BRAND_NAME,
  description:
    "AI zapiski predavanj s snemanjem, prepisom, povzetki in klepetom.",
  applicationName: BRAND_NAME,
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: BRAND_NAME,
  },
  icons: {
    icon: [
      {
        url: "/memo-favicon-32x32.png?v=3",
        sizes: "32x32",
        type: "image/png",
      },
      {
        url: "/memo-favicon-16x16.png?v=3",
        sizes: "16x16",
        type: "image/png",
      },
      {
        url: "/memo-favicon.ico?v=3",
        sizes: "any",
        type: "image/x-icon",
      },
    ],
    shortcut: "/memo-favicon.ico?v=3",
    apple: [
      {
        url: "/apple-touch-icon.png?v=3",
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
    <html lang="sl" suppressHydrationWarning>
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
        <Analytics />
      </body>
    </html>
  );
}
