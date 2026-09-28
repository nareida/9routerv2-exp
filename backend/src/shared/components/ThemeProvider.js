"use client";

import { useEffect } from "react";
import useThemeStore from "../../store/themeStore.js";

export function ThemeProvider({ children }) {
  const { initTheme } = useThemeStore();

  useEffect(() => {
    initTheme();
  }, [initTheme]);

  return <>{children}</>;
}

