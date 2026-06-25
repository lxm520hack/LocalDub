import {
	createContext,
	createEffect,
	createMemo,
	createSignal,
	type JSX,
	onCleanup,
	onMount,
	useContext,
} from 'solid-js';
import { isServer } from 'solid-js/web';

export type Theme = 'dark' | 'light' | 'auto';
type ActiveTheme = 'dark' | 'light';
export const themeScript = `(()=>{
try{var t=localStorage.getItem('theme')||'auto'}catch(e){t='auto'};
if(!['light','dark','auto'].includes(t)) t='auto';
var a=t==='auto'?matchMedia('(prefers-color-scheme:dark)').matches?'dark':'light':t;
document.documentElement.classList.add(a)
})()`

type ThemeProviderState = {
	theme: () => Theme;
	setTheme: (theme: Theme) => void;
	systemTheme: () => 'light' | 'dark';
	activeTheme: () => ActiveTheme;
};

const ThemeProviderContext = createContext<ThemeProviderState>();

const getSystemTheme = () =>
	typeof window !== 'undefined' ?
	window.matchMedia('(prefers-color-scheme: dark)').matches
		? 'dark'  as const
		: 'light' as const
	: 'light' as const
export function ThemeProvider(props: {
	children: JSX.Element;
	defaultTheme?: Theme;
	storageKey?: string;
}) {
	const storageKey = props.storageKey ?? 'theme';

	const [theme, _setTheme] = createSignal<Theme>(
		props.defaultTheme ?? 'auto',
	);

	const [systemTheme, setSystemTheme] = createSignal(getSystemTheme());

	const [mounted, setMounted] = createSignal(!isServer);

	onMount(() => {
		setMounted(true);

		const savedTheme = localStorage.getItem(storageKey) as Theme | null;
		if (savedTheme) {
			_setTheme(savedTheme);
		}
const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
		setSystemTheme(
			mediaQuery.matches
				? 'dark'
				: 'light',
		);
		
		const handleChange = () =>
			setSystemTheme(mediaQuery.matches ? 'dark' : 'light');

		mediaQuery.addEventListener('change', handleChange);
		onCleanup(() => mediaQuery.removeEventListener('change', handleChange));
	});

	createEffect(() => {
		if (!mounted()) return;

		const root = window.document.documentElement;
		const activeTheme = theme() === 'auto' ? systemTheme() : theme();

		root.classList.remove('light', 'dark');
		root.classList.add(activeTheme);
	});

	const value = {
		theme,
		setTheme: (newTheme: Theme) => {
			localStorage.setItem(storageKey, newTheme);
			_setTheme(newTheme);
		},
		systemTheme,
		 activeTheme: createMemo(() => theme() === 'auto' ? systemTheme() : theme() as ActiveTheme),
	};

	return (
		<ThemeProviderContext.Provider value={value}>
			{props.children}
		</ThemeProviderContext.Provider>
	);
}

export const useTheme = () => {
	const context = useContext(ThemeProviderContext);
	if (!context) throw new Error('useTheme must be used within a ThemeProvider');
	return context;
};
