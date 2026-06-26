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
    SidebarRail,
} from '@repo/ui-solid/base/sidebar';
import { TooltipX } from '@repo/ui-solid/custom/tooltip';
import { openSettings } from './settings/settings';
import { Server, LayoutDashboard, Settings } from 'lucide-solid';

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
				<SidebarGroup>
					<SidebarGroupLabel>General</SidebarGroupLabel>
					<SidebarMenu>
						<SidebarMenuItem>
							<SidebarMenuButton as={Link} to="/">
								<LayoutDashboard /> Dashboard
							</SidebarMenuButton>
						</SidebarMenuItem>
					</SidebarMenu>
				</SidebarGroup>
				<SidebarGroup>
					<SidebarGroupLabel>Servers</SidebarGroupLabel>
					<SidebarMenu>
						<SidebarMenuItem>
							<SidebarMenuButton as={Link} to="/server/torch">
								<Server /> Torch Server
							</SidebarMenuButton>
						</SidebarMenuItem>
					</SidebarMenu>
				</SidebarGroup>
			</SidebarContent>
			<SidebarFooter>
				<SidebarMenuButton onClick={()=> openSettings()}><Settings /> Settings</SidebarMenuButton>
			</SidebarFooter>
			<SidebarRail />
		</Sidebar>
	);
}
