import { useRef, useEffect, useState, useLayoutEffect } from 'react'
export function usePrevious<T>(value: T): T {
    const ref: any = useRef<T>();
    useEffect(() => {
        ref.current = value;
    }, [value]);
    return ref.current;
}

export function useDarkMode(): boolean {
    const [isDark, setIsDark] = useState(() =>
        window.matchMedia('(prefers-color-scheme: dark)').matches
    );

    useLayoutEffect(() => {
        const darkModeQuery = window.matchMedia('(prefers-color-scheme: dark)');
        function handleModeChange(e: MediaQueryListEvent) {
            setIsDark(e.matches);
        }
        darkModeQuery.addEventListener('change', handleModeChange);
        return () => {
            darkModeQuery.removeEventListener('change', handleModeChange);
        };
    }, []);

    return isDark;
}