import type { Metadata, Viewport } from "next";
import { Toaster } from "sonner";
import { PLATFORM_NAME } from "@/lib/brand";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: PLATFORM_NAME, template: `%s · ${PLATFORM_NAME}` },
  description: "Operations for print, sign and design shops: jobs, quotes, proofs, production and money.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#1a8fe3" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        {children}
        <Toaster position="bottom-right" richColors closeButton duration={3000} />
      </body>
    </html>
  );
}
