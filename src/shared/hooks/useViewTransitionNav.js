"use client";

// Wrap a router navigation in the native View Transitions API when available.
// Fallback: plain navigation. Safe on SSR (typeof check).
export default function viewTransitionNav(router, href, opts = {}) {
  const go = () => router.push(href, { scroll: false, ...opts });
  if (
    typeof document !== "undefined" &&
    typeof document.startViewTransition === "function" &&
    !window.matchMedia("(prefers-reduced-motion: reduce)").matches
  ) {
    document.startViewTransition(go);
  } else {
    go();
  }
}
