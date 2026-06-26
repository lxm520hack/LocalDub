import { type ComponentProps, splitProps } from 'solid-js';
import {
	Select,
	SelectContent,
	SelectItem,
	type SelectProps,
	SelectTrigger,
	SelectValue,
} from '../../base/select';
import { FieldX } from '../comp';
import type { FieldBase, Options } from '../types';

export type ObjOptions = {
	value: string;
	label: string;
};
export type SelectFieldProps<T extends ObjOptions | string> = FieldBase &
	Omit<SelectProps<T>, 'value' | 'options' | 'onChange'> & {
		value?: T;
		options: T[];
		onChange?: (o?: T | null) => void;
		class?: string;
	};

export const SelectField = <T extends ObjOptions | string>(
	props: SelectFieldProps<T>,
) => {
	const [local, others] = splitProps(props, [
		'invalid',
		'title',
		'required',
		'fieldId',
		'description',
		'errors',
	]);
	const optionTextValue = () => {
		if (typeof others.optionTextValue === 'function') {
			return false;
		}
		return others.optionTextValue;
	};
	return (
		<FieldX {...local}>
			<Select
				// {...others}

				value={others.value}
				options={others.options}
				id={local.fieldId}
				aria-invalid={local.invalid}
				// optionValue="value"
				// optionTextValue="label"
				onChange={(o) => others.onChange?.(o)}
				itemComponent={(props) => (
					<SelectItem item={props.item}>
						{optionTextValue()
							? (props.item.rawValue as ObjOptions).label
							: (props.item.rawValue as unknown as string)}
					</SelectItem>
				)}
			>
				<SelectTrigger class={others.class}>
					<SelectValue<T>>
						{(state) =>
							typeof state.selectedOption() === 'object'
								? (state.selectedOption() as ObjOptions)?.label
								: (state.selectedOption() as unknown as string)
						}
					</SelectValue>
				</SelectTrigger>
				<SelectContent class="max-h-72 overflow-y-auto" />
			</Select>
		</FieldX>
	);
};
