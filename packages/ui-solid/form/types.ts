import type { FieldApi } from '@tanstack/solid-form';
import type { FormFieldTitleProps } from './comp';

export type CompFieldProps = {
	invalid?: boolean;
	errors?: { message?: string }[];
	description?: string;
};
export type FieldBase = FormFieldTitleProps & CompFieldProps;

export type FieldApiT<T> = FieldApi<
	any,
	string,
	T,
	any,
	any,
	any,
	any,
	any,
	any,
	any,
	any,
	any,
	any,
	any,
	any,
	any,
	any,
	any,
	any,
	any,
	any,
	any,
	any
>;

export type Option =
	| {
			readonly label?: string;
			readonly value: string;
			description?: string;
	  }
	| string;
export type Options = Option[] | readonly Option[];
