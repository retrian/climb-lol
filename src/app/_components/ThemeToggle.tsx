"use client"

import { useEffect, useState } from "react"

type ThemePreference = "light" | "dark"

const STORAGE_KEY = "theme-preference"

const normalizePreference = (value: string | null): ThemePreference => {
  if (value === "dark" || value === "light") {
    return value
  }
  return "dark"
}

const applyPreference = (preference: ThemePreference) => {
  const root = document.documentElement
  const isDark = preference === "dark"
  root.classList.toggle("dark", isDark)
  root.dataset.theme = isDark ? "dark" : "light"
  root.style.colorScheme = isDark ? "dark" : "light"
  return isDark
}

export function ThemeToggle() {
  const [preference, setPreference] = useState<ThemePreference>(() => {
    if (typeof window === "undefined") return "dark"
    try {
      return normalizePreference(localStorage.getItem(STORAGE_KEY))
    } catch {
      return "dark"
    }
  })

  useEffect(() => {
    applyPreference(preference)

    const onChange = () => {
      const nextPref = normalizePreference(localStorage.getItem(STORAGE_KEY))
      setPreference(nextPref)
    }

    window.addEventListener("storage", onChange)

    return () => {
      window.removeEventListener("storage", onChange)
    }
  }, [preference])

  const toggleTheme = () => {
    const next: ThemePreference = preference === "dark" ? "light" : "dark"
    try {
      localStorage.setItem(STORAGE_KEY, next)
    } catch {
      // Ignore storage failures (private mode, etc.)
    }
    setPreference(next)
  }

  const isDark = preference === "dark"
  const modeLabel = isDark ? "dark" : "light"
  const actionLabel = isDark ? "light" : "dark"

  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={`Theme is ${modeLabel}. Switch to ${actionLabel} mode.`}
      className="inline-flex h-[38px] w-[38px] items-center justify-center rounded-none text-slate-700 transition hover:bg-slate-100 hover:text-slate-900 dark:text-slate-200 dark:hover:bg-slate-800 dark:hover:text-white"
    >
      {isDark ? (
        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <path d="M21 12.79A9 9 0 1 1 11.21 3a7 7 0 0 0 9.79 9.79Z" />
        </svg>
      ) : (
        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2" />
          <path d="M12 20v2" />
          <path d="m4.93 4.93 1.41 1.41" />
          <path d="m17.66 17.66 1.41 1.41" />
          <path d="M2 12h2" />
          <path d="M20 12h2" />
          <path d="m6.34 17.66-1.41 1.41" />
          <path d="m19.07 4.93-1.41 1.41" />
        </svg>
      )}
    </button>
  )
}
