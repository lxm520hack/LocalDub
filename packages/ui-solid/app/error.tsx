import { ErrorComponent, rootRouteId, useMatch, useNavigate, useRouter, type ErrorComponentProps } from '@tanstack/solid-router';
import { ArrowLeft, RotateCw } from 'lucide-solid';
import { Button } from '../base/button';
import { UxAlert } from '../custom/alert';
import { Description } from '../custom/label';
import { i18n } from '@repo/shared/i18n/utils';

export function ErrorCard({error, info, reset}: ErrorComponentProps) {
	  const router = useRouter()
  const isRoot = useMatch({
    strict: false,
    select: (state) => state.id === rootRouteId,
  })
	console.log(error)
	const navigate = useNavigate()
	return (
		<div class={'grid place-items-center  w-full h-full my-auto'}>
			<main class="bg-card rounded-md shadow-lg p-4 h-fit sm:max-w-md w-full flex flex-col gap-3">
				{/* <h2>Something went wrong!</h2> */}
				<ErrorComponent error={error} />
				<h2>{error.name}</h2>
				<UxAlert variant={'destructive'} title={error.message} />
				<Description>{String(error.cause)}</Description>
				<Description>{info?.componentStack}</Description>
				<Description>{error.stack}</Description>
				<div class="grid grid-cols-2 gap-3 mt-2 ">
					<Button variant="secondary" onClick={() => isRoot() ? navigate({ to: '/' }) : window.history.back()}>
						<ArrowLeft />
						{i18n.goBack()}
					</Button>
					<Button  onClick={()=>router.invalidate()}>
						<RotateCw />
						{i18n.tryAgain()}
					</Button>
				</div>
			</main>
		</div>
	);
}
