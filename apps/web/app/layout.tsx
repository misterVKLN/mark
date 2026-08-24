import "./globals.css";
import type { Metadata } from "next";
import { Inter } from "next/font/google";
import type { ReactNode } from "react";
import LayoutContent from "../components/LayoutContent";

const inter = Inter({ subsets: ["latin"] });

// Render the layout per request rather than statically prerendering it.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "UNI-Test",
  description: "Grade your learners' work with the power of AI.",
  icons: {
    icon: "/logo.png",
    apple: "/logo.png",
  },
  keywords: [
    "uni-test",
    "intela education",
    "ai",
    "AI graded assignments",
    "online learning",
    "online courses",
  ],

  authors: [
    {
      name: "Skills Network",
      url: "https://skills.network",
    },
    {
      name: "Rami Maalouf",
      url: "https://rami-maalouf.tech",
    },
    {
      name: "Intela Education",
      url: "https://intela-edu.online",
    },
  ],
};

export default function RootLayout({ children }: { children: ReactNode }) {
  // Dark only when explicitly stored as "dark", or stored as "system" and the
  // OS prefers dark. Anything else (unset, legacy or corrupted writes) stays
  // light, mirroring getStoredTheme's DEFAULT_THEME fallback.
  const themeBootstrapScript = `(function(){try{var t=localStorage.getItem("mark-theme");var d=t==="dark"||(t==="system"&&window.matchMedia("(prefers-color-scheme: dark)").matches);var e=document.documentElement;e.classList.toggle("dark",d);e.setAttribute("data-color-mode",d?"dark":"light");}catch(e){}})();`;

  return (
    <html
      lang="en"
      className="h-full"
      // SSR fallback so @uiw markdown surfaces stay light when the bootstrap
      // script can't run (blocked inline scripts, storage errors, no JS).
      data-color-mode="light"
      // The bootstrap script mutates class/data-color-mode before hydration.
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootstrapScript }} />
      </head>
      <body className={`${inter.className} h-full m-0 p-0`}>
        <LayoutContent>{children}</LayoutContent>
      </body>
    </html>
  );
}
