"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ArrowUpRight,
  Boxes,
  ChevronRight,
  CircleDot,
  LayoutDashboard,
  Layers3,
  ShieldCheck,
} from "lucide-react";

export function Navigation({
  lines,
}: {
  lines: { slug: string; name: string; count: number }[];
}) {
  const pathname = usePathname();
  return (
    <aside className="sidebar">
      <Link href="/" className="brand">
        <span className="brand-icon">
          <Boxes size={23} />
        </span>
        <span>
          AI Product<span className="brand-light">Studio / Inventory</span>
        </span>
      </Link>
      <div className="workspace">
        <span className="workspace-avatar">S</span>
        <div>
          Studio workspace<small>Local catalog · Read only</small>
        </div>
        <ShieldCheck size={16} />
      </div>
      <span className="nav-label">WORKSPACE</span>
      <Link className={`nav-item ${pathname === "/" ? "active" : ""}`} href="/">
        <LayoutDashboard size={18} /> Overview{" "}
        <ChevronRight className="nav-arrow" size={15} />
      </Link>
      <Link
        className={`nav-item ${pathname === "/attention" ? "active" : ""}`}
        href="/attention"
      >
        <CircleDot size={18} /> Needs attention
      </Link>
      <span className="nav-label line-label">
        PRODUCT LINES <Layers3 size={13} />
      </span>
      <nav aria-label="Product lines">
        {lines.map((line, index) => (
          <Link
            key={line.slug}
            className={`nav-item ${pathname.startsWith(`/lines/${line.slug}`) ? "active" : ""}`}
            href={`/lines/${line.slug}`}
          >
            <span className={`line-dot color-${index % 5}`} />
            {line.name}
            <span className="nav-count">{line.count}</span>
          </Link>
        ))}
      </nav>
      <div className="sidebar-bottom">
        <span className="live-dot" /> Connected to filesystem
        <small>
          Source files stay in your studio.
          <br />
          No uploads. No catalog changes.
        </small>
        <a href="https://nextjs.org" target="_blank" rel="noreferrer">
          Built with Next.js <ArrowUpRight size={13} />
        </a>
      </div>
    </aside>
  );
}
