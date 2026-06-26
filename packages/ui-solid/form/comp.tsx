import type { JSX } from 'solid-js';
import { Field, FieldDescription, FieldError, FieldLabel } from '../base/field';
import { FieldBase } from './types';

export const Required = (props: { required?: boolean }) => {
	return props.required ? <span class="text-red-400">*</span> : '';
};

export type FormFieldTitleProps = {
	title?: string;
	required?: boolean;
	fieldId?: string;
};
export const FormFieldTitle = (props: FormFieldTitleProps) =>
	props.title ? (
		<FieldLabel for={props.fieldId}>
			{props.title} <Required required={props.required} />
		</FieldLabel>
	) : null;


export const  FieldX = (props: FieldBase & {
	children?: JSX.Element;
}) => 	<Field data-invalid={props.invalid}>
			<FormFieldTitle title={props.title} required={props.required} fieldId={props.fieldId} /> 
			{props.children}
						{props.description && <FieldDescription>{props.description}</FieldDescription>}
			{props.invalid && <FieldError errors={props.errors} />}
		</Field>