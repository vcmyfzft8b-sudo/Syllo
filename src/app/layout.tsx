import type { Metadata } from "next";
import { Analytics } from "@vercel/analytics/next";

import { ThemeController } from "@/components/theme-controller";
import {
  BRAND_SHORTLINE,
  SEO_BRAND_NAME,
  SEO_SITE_DESCRIPTION,
  SEO_SITE_URL,
} from "@/lib/brand";

import "./globals.css";

const siteTitle = `${SEO_BRAND_NAME} | ${BRAND_SHORTLINE}`;

export const metadata: Metadata = {
  metadataBase: new URL(SEO_SITE_URL),
  title: {
    default: siteTitle,
    template: `%s | ${SEO_BRAND_NAME}`,
  },
  description: SEO_SITE_DESCRIPTION,
  applicationName: SEO_BRAND_NAME,
  openGraph: {
    title: siteTitle,
    description: SEO_SITE_DESCRIPTION,
    url: "/",
    siteName: SEO_BRAND_NAME,
    locale: "sl_SI",
    type: "website",
  },
  twitter: {
    card: "summary",
    title: siteTitle,
    description: SEO_SITE_DESCRIPTION,
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: SEO_BRAND_NAME,
  },
  icons: {
    icon: [
      {
        url: "/memo-favicon-96x96.png?v=4",
        sizes: "96x96",
        type: "image/png",
      },
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
