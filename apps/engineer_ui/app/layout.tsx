import type { Metadata } from "next";
import Link from "next/link";
import { ChevronRight, FolderOpen } from "lucide-react";
import { Navigation } from "@/components/navigation";
import { getCatalog } from "@/lib/server";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Overview | AI Product Studio",
    template: "%s | AI Product Studio",
  },
  description: "A read-only window into your printable product catalog.",
  robots: { index: false, follow: false },
};
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const catalog = await getCatalog();
  return (
    <html lang="en">
      <body>
        <a className="skip-link" href="#main">
          Skip to content
        </a>
        <Navigation
          lines={catalog.lines.map((line) => ({
            slug: line.slug,
            name: line.name,
            count: catalog.products.filter(
              (product) => product.line === line.slug,
            ).length,
          }))}
        />
        <div className="main-shell">
          <div className="topbar">
            <div>
              <FolderOpen size={15} />
              <Link href="/">Workspace</Link>
              <ChevronRight size={13} />
              <span>Inventory</span>
            </div>
            <span className="local-label">
              <span className="live-dot" /> LOCAL STUDIO{" "}
              <span className="read-only">Read only</span>
            </span>
          </div>
          <main id="main">{children}</main>
          <footer>
            AI Product Studio{" "}
            <span>Geometry ≠ package ≠ slice ≠ physical validation</span>
          </footer>
        </div>
      </body>
    </html>
  );
}
