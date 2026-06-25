import { m } from '@repo/shared/i18n/paraglide/messages';
import {
	getLocale,
	locales,
	setLocale,
} from '@repo/shared/i18n/paraglide/runtime';
import { Button, buttonVariants } from '@repo/ui-solid/base/button';
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from '@repo/ui-solid/base/dialog';
// #/components/base/dialog.tsx
import { Input } from '@repo/ui-solid/base/input';
import { Label } from '@repo/ui-solid/base/label';
import { toast } from '@repo/ui-solid/base/sonner';
import { Textarea } from '@repo/ui-solid/base/textarea';
import { toastError } from '@repo/ui-solid/custom/toast';
import { createQuery, useMutation } from '@tanstack/solid-query';
import { useSelector } from '@tanstack/solid-store';
import { Eye, EyeOff, RefreshCw, Settings } from 'lucide-solid';
import { createEffect, createSignal, Show } from 'solid-js';


const localeNames: Record<string, string> = {
	en: m.en?.(),
	zh: m.zh?.(),
};

const uniqueModels = (models: string[]) => {
	return Array.from(
		new Set(models.map((model) => model.trim()).filter(Boolean)),
	);
};
export function SettingsDialog() {

	const currentLocale = getLocale();

	const [modelOptions, setModelOptions] = createSignal<string[]>([
		'gpt-4o-mini',
	]);

	return (
		<Dialog>
			<DialogTrigger
				class={buttonVariants({
					variant: 'outline',
				})}
			>
				<Settings class="size-4" />
				{m.settings_button()}
			</DialogTrigger>
			<DialogContent size="2xl" showCloseButton>

			</DialogContent>
		</Dialog>
	);
}
