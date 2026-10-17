import Link from "next/link";
import { GITHUB_URL } from "@/lib/client/format";

/** Shared top bar for the bench (/) and /about. */
export function TopBar({ page }: { page: "home" | "about" }) {
  return (
    <header className="flex h-12 items-center justify-between gap-4">
      <Link href={page === "home" ? "#top" : "/"} className="wordmark text-[18px] font-extrabold leading-none tracking-[-0.03em]">
        Peppolsmith
      </Link>
      <nav className="flex items-center gap-4 text-[14px] font-medium lg:gap-6">
        {page === "home" ? (
          <button type="button" popoverTarget="judge" className="toplink">
            How to judge<span className="hidden sm:inline"> this (90 s)</span>
          </button>
        ) : (
          <Link href="/" className="toplink">
            Try it
          </Link>
        )}
        {page === "home" ? (
          <Link href="/about" className="toplink">
            About
          </Link>
        ) : (
          <span aria-current="page" className="font-semibold text-ink">
            About
          </span>
        )}
        <a href={GITHUB_URL} className="toplink hidden md:inline" target="_blank" rel="noreferrer">
          Source on GitHub
        </a>
      </nav>
    </header>
  );
}
