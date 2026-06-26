import { EyeIcon, EyeOff, LockKeyhole } from 'lucide-solid';
import { type ComponentProps, createSignal } from 'solid-js';
import { Button } from '../../base/button';
import {
	InputGroup,
	InputGroupAddon,
	InputGroupInput,
} from '../../base/input-group';
import { FieldX } from '../comp';
import { useFieldContext } from '../form';

export const PasswordField = (
	props: ComponentProps<'input'> & {
		title?: string;
		placeholder?: string;
		description?: string;
		required?: boolean;
		withIcon?: boolean;
	},
) => {
	const field = useFieldContext<string>();
	const invalid = () =>
		!field().state.meta.isValid && field().state.meta.isTouched;
	const [isVisible, setIsVisible] = createSignal(false);
	return (
		<FieldX
			title={props.title}
			required={props.required || true}
			errors={field().state.meta.errors}
			description={props.description}
			invalid={invalid()}
		>
			<InputGroup class={props.class}>
				<InputGroupInput
					class={props.class}
					placeholder={props.placeholder}
					value={field().state.value}
					onInput={(e) => field().handleChange(e.target.value)}
					type={isVisible() ? 'text' : 'password'}
				/>
				{props.withIcon && (
					<InputGroupAddon>
						<LockKeyhole />
					</InputGroupAddon>
				)}
				<InputGroupAddon align="inline-end">
					<button
						aria-label="toggle password visibility"
						class="focus:outline-hidden mr-1 cursor-pointer"
						type="button"
						onClick={() => setIsVisible(!isVisible())}
					>
						{isVisible() ? <EyeOff size={16} /> : <EyeIcon size={16} />}
					</button>
				</InputGroupAddon>
			</InputGroup>
		</FieldX>
	);
};
