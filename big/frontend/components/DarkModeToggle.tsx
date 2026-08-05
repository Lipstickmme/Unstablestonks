"use client";

import { useEffect, useState } from "react";

export function DarkModeToggle() {
  const [isDark, setIsDark] = useState(true);

  useEffect(() => {
    const saved = localStorage.getItem("theme");
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    const dark = saved === "dark" || (saved !== "light" && prefersDark);
    setIsDark(dark);
    document.documentElement.classList.toggle("dark", dark);
  }, []);

  const toggle = () => {
    const next = !isDark;
    setIsDark(next);
    document.documentElement.classList.toggle("dark", next);
    localStorage.setItem("theme", next ? "dark" : "light");
  };

  return (
    <button
      type="button"
      onClick={toggle}
      className="p-2 rounded-lg text-gray-600 dark:text-neutral-400 hover:text-amber-500 dark:hover:text-amber-400 hover:bg-gray-100 dark:hover:bg-white/5 transition-colors"
      aria-label="Toggle theme"
    >
      {isDark ? "☀️" : "🌙"}
    </button>
  );
}
