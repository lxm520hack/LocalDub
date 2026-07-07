import { Link } from '@tanstack/solid-router';
import packageJson from '../../../package.json';
import {
	Sidebar,
	SidebarContent,
	SidebarFooter,
	SidebarGroup,
	SidebarGroupLabel,
	SidebarHeader,
	SidebarMenu,
	SidebarMenuButton,
	SidebarMenuItem,
    SidebarMenuSub,
    SidebarRail,
} from '@repo/ui-solid/base/sidebar';
import { TooltipX } from '@repo/ui-solid/custom/tooltip';
import { openSettings } from './settings/settings';
import { ChevronRight, Folder, LayoutDashboard, Settings } from 'lucide-solid';
import { useClientApi } from '@repo/ui/app/api/context';
import { useQuery } from '@tanstack/solid-query';
import { GroupInfo } from '@repo/core/cmd/tasks/get_group_list';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@repo/ui-solid/base/collapsible';
import { Show } from 'solid-js';
import { Separator } from '@repo/ui-solid/base/separator';
import { cn } from '@repo/shared/lib/utils';
import { client, rspc } from '#/integrations/rspc/rspc.ts';
import { ScrollArea } from '@repo/ui-solid/base/scroll-area';

const getButtonPx = (depth: number) => ({
	'padding-left': `${(2 + 6 * depth) * 0.25}rem`,
	'padding-right': `${(2 + 6 * depth) * 0.25}rem`,
});
const TaskTree = (p: {items: GroupInfo[]}) => {
	return p.items.map(item => (<SidebarMenuItem class='h-fit '>
		<Collapsible
			class="group/collapsible [&[data-expanded]>button>svg:first-child]:rotate-90"
		>
			<CollapsibleTrigger as={SidebarMenuButton} class='gap-px rounded-none items-center'>	
				<ChevronRight class="transition-transform" />
				<Folder />
				<span class='h-4 text-sm pl-0.75'>{item.group_id}</span>
			</CollapsibleTrigger>
			<CollapsibleContent class="relative">
				<Separator
						orientation="vertical"
						class={cn(`absolute bg-accent-foreground z-1`)}
						style={{
							left: `${1}rem`, // 直接用 inline style，最可靠
						}}
					/>
				<SidebarMenuSub class="border-0 m-0 p-0 gap-0">
					{item.tasks.map(task => (<SidebarMenuButton class='rounded-none' style={getButtonPx(1)}
						as={Link} 
						to={`/group/${item.group_id}/${task.id}`}
						activeProps={{
							class: "bg-accent/70!"
						}}
					>
						{task.id}
					</SidebarMenuButton>))}
				</SidebarMenuSub>
			</CollapsibleContent>
		</Collapsible>
	</SidebarMenuItem>))
}

export function AppSidebar() {
	// const api = useClientApi()
	const groupList = useQuery(()=>({
			queryKey: ['groupList'],
			queryFn: () => client.query(['getGroupList', null]) 
		}))
	// const groupList0 = rspc.createQuery(() => ['getGroupList', null])
	return (
		<Sidebar>
			<SidebarHeader class="flex-row">
				<TooltipX content={`Version ${packageJson.version}`}>
					<Link to="/">
						<h1 class="flex gap-1">
							<span>Local</span>
							<span class="text-muted-foreground">Dub</span>
						</h1>
					</Link>
				</TooltipX>
			</SidebarHeader>
			<SidebarContent>
				<ScrollArea scrollbarSize={10}>

				<SidebarMenu class='gap-0 p-0'>
					<Show when={groupList.data} fallback={<div class='p-2 text-sm text-muted-foreground'>Loading...</div>}>
						{(items)=><TaskTree items={items()} />}
					</Show>
				</SidebarMenu>
				</ScrollArea>
					
					{/* <SidebarMenu>
						<SidebarMenuItem>
							<SidebarMenuButton as={Link} to="/">
								<LayoutDashboard /> Dashboard
							</SidebarMenuButton>
						</SidebarMenuItem>
					</SidebarMenu> */}
			</SidebarContent>
			<SidebarFooter>
				<SidebarMenuButton onClick={()=> openSettings()}><Settings /> Settings</SidebarMenuButton>
			</SidebarFooter>
			<SidebarRail size='sm' />
		</Sidebar>
	);
}
