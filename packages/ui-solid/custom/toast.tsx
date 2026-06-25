
// import { Alert, AlertTitle } from "#/components/ui/alert";
import { AlertCircleIcon, XIcon } from 'lucide-solid';
import { type ExternalToast, toast as sonnerToast } from 'solid-sonner';
import { Button } from '../base/button';
import { UxAlert } from './alert';
import { JsonViewer } from './CodeBlock/JsonViewer';
import type { JSX } from 'solid-js';

const any2str = (value: any): string => {
	if (value == null) return '';
	if (typeof value === 'object') {
		try {
			return JSON.stringify(value);
		} catch {
			return '[Unserializable Object]';
		}
	}
	return String(value);
};

export const toastError = (error: unknown, title?: string) => {
	console.log(error);
	let description: object | undefined | null | JSON;

	if (error instanceof Error) {
		console.log(error.cause);
		// const eerJson = analyzeError(error);
		description = {
			name: error.name,
			message: error.message,
			cause: error.cause,
			stack: error.stack,
			status: 'status' in error ? error.status : undefined,
		};
		title = title ?? (error.message || `${error.name} ${error.cause}`);
	} else if (typeof error === 'object' && error !== null) {
		const errObj = error as {
			name?: string;
			message?: string;
			cause?: string;
		};

		title = title ?? (errObj?.message || `${errObj?.name} ${errObj?.cause}`);
		description = error;
	} else {
		// description = error;
	}
	console.log({
		title,
		description,
	});
	// sonnerToast.error(title, { description });
	sonnerToast.custom((t) => (
		<div class="bg-popover flex flex-col gap-2 rounded-md border p-4 w-89 z-100">
			<UxAlert variant="destructive" title={title} />
			{description && <JsonViewer data={description} />}
			<Button
				size="icon-sm"
				variant="ghost"
				class="absolute top-1 right-1"
				onClick={() => sonnerToast.dismiss(t)}
			>
				<XIcon />
			</Button>
		</div>
	));
};
export const toastWarning = (title?: string, description?: any) =>
	sonnerToast.warning(title, {
		description: any2str(description),
	});
export const toastInfo = (title?: string, description?: any) =>
	sonnerToast.info(title, {
		description: any2str(description),
	});
export const toastSuccess = (title?: string, description?: any) =>
	sonnerToast.success(title, {
		description: any2str(description),
	});

