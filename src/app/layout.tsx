import type { Metadata } from "next";

import { BRAND_NAME } from "@/lib/brand";

import "./globals.css";

export const metadata: Metadata = {
  title: BRAND_NAME,
  description:
    "AI lecture notes with recording, transcription, summaries, and chat.",
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
      <body>{children}</body>
    </html>
  );
}
