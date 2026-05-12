import { useEffect, type ReactNode } from "react";

export function ThemeProvider({ children }: { children: ReactNode }) {
	useEffect(() => {
		document.documentElement.classList.add("dark");
		return () => document.documentElement.classList.remove("dark");
	}, []);

	return children;
}
