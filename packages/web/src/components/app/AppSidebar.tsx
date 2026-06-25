import { Link } from '@tanstack/solid-router';
import packageJson from '../../../package.json';
import {
	Sidebar,
	SidebarContent,
	SidebarFooter,
	SidebarGroup,
	SidebarHeader,
	SidebarMenu,
	SidebarMenuButton,
	SidebarMenuItem,
} from '@repo/ui-solid/base/sidebar';
import { TooltipX } from '@repo/ui-solid/custom/tooltip';
import { openSettings } from './settings/settings';
import { Settings } from 'lucide-solid';

export function AppSidebar() {
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
				<SidebarGroup />
				<SidebarGroup />
			</SidebarContent>
			<SidebarFooter>
				<SidebarMenuButton onClick={()=> openSettings()}><Settings /></SidebarMenuButton>
			</SidebarFooter>
		</Sidebar>
	);
}
