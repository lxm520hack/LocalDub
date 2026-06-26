import { type ComponentProps, splitProps } from 'solid-js';
import { Input } from '../../base/input';
import { FieldX } from '../comp';
import type { FieldBase } from '../types';

export type FileInputFieldProps = FieldBase &
	ComponentProps<'input'> & {
		onValueChange?: (f?: File) => void;
	};

export const FileInputField = (props: FileInputFieldProps) => {
	const [local, others] = splitProps(props, [
		'invalid',
		'title',
		'required',
		'fieldId',
		'description',
		'errors',
	]);
	return (
		<FieldX {...local}>
			<Input
				{...others}
				id={local.fieldId}
				aria-invalid={local.invalid}
				type="file"
				onChange={(e) => {
					others.onValueChange?.(Array.from(e.target.files ?? [])[0]);
					e.target.value = '';
				}}
			/>
		</FieldX>
	);
};
