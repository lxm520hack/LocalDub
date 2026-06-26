import { getSafeLength } from '@repo/shared/lib/utils/len';
import {
	type ComponentProps,
	createEffect,
	type JSX,
	splitProps,
} from 'solid-js';
import {
	InputGroup,
	InputGroupAddon,
	InputGroupInput,
	InputGroupTextarea,
} from '../../base/input-group';
import { Textarea } from '../../base/textarea';
import { FieldX, FormFieldTitle } from '../comp';
import type { FieldBase } from '../types';

export type InputFieldProps = FieldBase &
	ComponentProps<'input'> & {
		Addon?: JSX.Element;
		AddonInlineEnd?: JSX.Element;
	};
export const InputField = (props: InputFieldProps) => {
	const [local, others] = splitProps(props, [
		'invalid',
		'title',
		'required',
		'fieldId',
		'description',
		'errors',
		'Addon',
		'AddonInlineEnd',
	]);
	createEffect(() => {
		console.log('InputField.props.errors', props.errors);
		console.log('InputField.local.errors', local.errors);
	});
	return (
		<FieldX {...local}>
			<InputGroup class={others.class}>
				<InputGroupInput
					{...others}
					id={local.fieldId}
					aria-invalid={local.invalid}
				/>

				{local.Addon && <InputGroupAddon>{local.Addon}</InputGroupAddon>}
				{props.maxLength && (
					<InputGroupAddon align="inline-end">
						{getSafeLength(props.value)}/{props.maxLength}
					</InputGroupAddon>
				)}
				{local.AddonInlineEnd && (
					<InputGroupAddon align="inline-end">
						{local.AddonInlineEnd}
					</InputGroupAddon>
				)}
			</InputGroup>
		</FieldX>
	);
};
export type TextareaProps = FieldBase & ComponentProps<'textarea'>;
export const TextareaField = (props: TextareaProps) => {
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
			<Textarea {...others} id={local.fieldId} aria-invalid={local.invalid} />
		</FieldX>
	);
};
export type InputGroupTextareaProps = FieldBase &
	ComponentProps<'textarea'> & {
		Addon?: JSX.Element;
		AddonInlineEnd?: JSX.Element;
	};
export const InputGroupTextareaField = (props: InputGroupTextareaProps) => {
	const [local, others] = splitProps(props, [
		'invalid',
		'title',
		'required',
		'fieldId',
		'description',
		'errors',
		'Addon',
		'AddonInlineEnd',
	]);
	return (
		<FieldX {...local}>
			<InputGroup class={others.class}>
				<InputGroupTextarea
					{...others}
					id={local.fieldId}
					aria-invalid={local.invalid}
				/>
				{local.Addon && <InputGroupAddon>{local.Addon}</InputGroupAddon>}
				{props.maxLength && (
					<InputGroupAddon align="inline-end">
						{getSafeLength(props.value)}/{props.maxLength}
					</InputGroupAddon>
				)}
				{local.AddonInlineEnd && (
					<InputGroupAddon align="inline-end">
						{local.AddonInlineEnd}
					</InputGroupAddon>
				)}
			</InputGroup>
		</FieldX>
	);
};
