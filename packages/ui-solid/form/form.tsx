import { cn } from "@repo/shared/lib/utils";
import {
	type AnyFieldMeta,
	createFormHookContexts,
	FieldApi,
	useStore,
} from "@tanstack/solid-form";
import { ClientOnly } from "@tanstack/solid-router";
import { ChevronRight } from "lucide-solid";
import {
	type ComponentProps,
	createEffect,
	type JSX,
	mergeProps,
	splitProps,
} from "solid-js";
import { Button } from "../base/button";
import { Toaster, toast } from "../base/sonner";
import { Spinner } from "../base/spinner";
import { toastError } from "../custom/toast";
import { useTheme } from "../theme";
export const { fieldContext, formContext, useFieldContext, useFormContext } =
	createFormHookContexts();

export const Form = (p: {
	class?: string;
	children: JSX.Element;
	onSubmit?: () => void | Promise<void>;
	id?: string;
}) => {
	const form = useFormContext();
	return (
		<ClientOnly>
			<form
				class={p.class}
				onSubmit={async (e) => {
					e.preventDefault();
					try {
						await (p.onSubmit ? p.onSubmit!() : form.handleSubmit());
					} catch (error) {
						toastError(error);
					}
				}}
				id={p.id}
			>
				{p.children}
			</form>
		</ClientOnly>
	);
};
export const SubmitButton = (
	props: ComponentProps<typeof Button> & {
		label?: string;
		class?: string;
		icon?: JSX.Element;
		form?: string;
		canSubmitDefault?: boolean;
	},
) => {
	const merged = mergeProps({ label: "提交", canSubmitDefault: false }, props);
	const [p, others] = splitProps(merged, [
		"class",
		"canSubmitDefault",
		"icon",
		"form",
		"label",
	]);
	const form = useFormContext();
	return (
		<form.Subscribe
			selector={(state) => {
				return {
					canNext: state.errors.length === 0,
					isSubmitting: state.isSubmitting,
					isDefaultValue: state.isDefaultValue,
				};
			}}
		>
			{(state) => (
				<Button
					{...others}
					type="submit"
					disabled={
						state().isSubmitting ||
						!state().canNext ||
						(state().isDefaultValue && !p.canSubmitDefault)
					}
					class={p.class}
					form={p.form}
				>
					{p.icon ? (
						<span class={`shrink-0 ${state().isSubmitting && "animate-spin"}`}>
							{p.icon}
						</span>
					) : (
						state().isSubmitting && <Spinner />
					)}
					{p.label}
				</Button>
			)}
		</form.Subscribe>
	);
};

// return a form.Subscribe.selector
const selector =
	({
		isFirstStep = true,
		currentFields,
	}: {
		isFirstStep: boolean;
		currentFields: "all" | readonly string[];
	}) =>
	(state: ReturnType<typeof useFormContext>["state"]) => {
		let hasErrors = false;
		let isTouched = false;
		for (const field of currentFields) {
			const meta = (state.fieldMeta as Record<string, AnyFieldMeta>)[field];
			if (meta) {
				if (meta.errors.length > 0) hasErrors = true;
				if (meta.isTouched) isTouched = true;
			}
			// 早停：如果已确定 hasErrors 和 hasTouched，都 true 时停止
			if (hasErrors && isTouched) break;
		}
		return {
			canNext: !(hasErrors || (isFirstStep && !isTouched)),
			isTouched,
			isSubmitting: state.isSubmitting,
		};
	};

export const NextButton = ({
	label = "下一步",
	isFirstStep = true,
	currentFields,
	handleNext,
}: {
	label?: string;
	isFirstStep: boolean;
	currentFields: readonly string[];
	handleNext: () => void | Promise<void>;
}) => {
	const form = useFormContext();
	return (
		<form.Subscribe selector={selector({ isFirstStep, currentFields })}>
			{(s) =>
				(!isFirstStep || s().isTouched) && (
					<Button
						type="button"
						variant="secondary"
						onClick={handleNext}
						disabled={!s().canNext}
					>
						{label}
						<ChevronRight />
					</Button>
				)
			}
		</form.Subscribe>
	);
};
export const FloatingSaveBar = ({
	view,
	isSubmitting,
	reset,
	isSubmitSuccessful,
}: {
	view: boolean;
	isSubmitting: boolean;
	reset: () => void;
	isSubmitSuccessful: boolean;
}) => {
	const { activeTheme } = useTheme();
	const TOAST_ID = "floating_save_bar";
	createEffect(() => {
		console.log("FloatingSaveBar.useEffect:", view);
		if (view) {
			toast(
				<div class="flex justify-between items-center w-full py-2.5 px-3 bg-popover rounded-md">
					<span class="text-foreground">注意！您尚未保存更改！</span>
					<div class="flex items-center gap-2">
						<Button
							variant="link"
							onClick={() => {
								reset();
								// toast.dismiss(TOAST_ID)
							}}
						>
							重置
						</Button>
						<Button type="submit" disabled={isSubmitting}>
							{isSubmitting && <Spinner />}
							保存更改
						</Button>
					</div>
				</div>,
				{
					id: TOAST_ID,
					toasterId: "form",
					position: "bottom-center",
					classes: {
						toast: "p-0! border-0!",
						content: cn("w-full"),
					},
					duration: Infinity,
					richColors: true,
				},
			);
		} else {
			toast.dismiss(TOAST_ID);
		}
	});
	createEffect(() => {
		if (isSubmitSuccessful) {
			console.log("FloatingSaveBar.useEffect: isSubmitSuccessful");
			reset();
			toast.dismiss(TOAST_ID);
		}
	});

	return <Toaster id="form" theme={activeTheme()} />;
};
export const FormFloatingSaveBar = ({
	watchedFields,
}: {
	watchedFields?: readonly string[];
}) => {
	const form = useFormContext();
	return (
		<form.Subscribe
			selector={(state) => {
				if (!watchedFields) {
					return {
						view:
							state.isDirty &&
							state.errors.length === 0 &&
							!state.isDefaultValue,
						isSubmitSuccessful: state.isSubmitSuccessful,
						isSubmitting: state.isSubmitting,
					};
				}
				let hasErrors = false;
				let isDirty = false;
				let isDefaultValue = true;
				// TODO: 注意检查是否存在逻辑错误
				for (const field of watchedFields) {
					const meta = (state.fieldMeta as Record<string, AnyFieldMeta>)[field];
					if (meta) {
						if (meta.errors.length > 0) hasErrors = true;
						if (meta.isDirty) isDirty = true;
						if (!meta.isDefaultValue) isDefaultValue = false;
					}

					if (!hasErrors && isDirty && !isDefaultValue) break;
				}
				return {
					view: isDirty && !hasErrors && !isDefaultValue,
					isSubmitSuccessful: state.isSubmitSuccessful,
					isSubmitting: state.isSubmitting,
				};
			}}
		>
			{(s) => (
				<FloatingSaveBar
					view={s().view}
					isSubmitting={s().isSubmitting}
					reset={form.reset}
					isSubmitSuccessful={s().isSubmitSuccessful}
				/>
			)}
		</form.Subscribe>
	);
};

// 同步到 localStorage
export const SyncToLocalStorage = () => {
	const form = useFormContext();
	const values = useStore(form.store, (state) => state.values);
	createEffect(() => {
		// 如果是 空对象 或 { k: undefined } 这种形式，说明没有实际的值，避免误覆盖 localStorage 中的有效数据
		if (
			Object.keys(values()).length === 0 ||
			Object.values(values()).every((v) => v === undefined)
		)
			return;
		console.log("SyncToLocalStorage.useEffect:", values());
		localStorage.setItem(form.formId, JSON.stringify(values()));
	});
	return null;
};
