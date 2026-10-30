import * as React from "react";
import { useTranslation } from "react-i18next";
import {
  Home,
  Settings2,
  Wheat,
  Leaf,
  FlaskConical,
  Code,
  Beaker,
  Flame,
  Droplets,
  BookOpen,
  Search,
} from "lucide-react";
import { Link, useRouterState } from "@tanstack/react-router";
import { useBatches } from "@/lib/db/batches";
import { useRecipes } from "@/lib/db/recipes";
import { executeCommand } from "@/lib/commands/command-registry";
import { useIsMac } from "@/hooks/use-platform";

import { NavMain } from "@/components/nav-main";
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
  useSidebar,
} from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";
import { ThemeToggle } from "@/components/theme-toggle";
import { SyncStatus } from "@/components/sync-status";
import { getVersion } from "brewdio-wasm";

// Static navigation items
const staticNavItems = [
  {
    titleKey: "navigation.home",
    url: "/",
    icon: Home,
  },
  {
    titleKey: "navigation.brewery",
    url: "/brewery",
    icon: Beaker,
  },
  {
    titleKey: "common.settings",
    url: "/settings",
    icon: Settings2,
  },
];

// Context-dependent navigation for recipe view
const recipeContextNav = [
  {
    titleKey: "recipes.fermentables",
    url: "#fermentables",
    icon: Wheat,
  },
  {
    titleKey: "recipes.hops",
    url: "#hops",
    icon: Leaf,
  },
  {
    titleKey: "recipes.cultures",
    url: "#cultures",
    icon: FlaskConical,
  },
];

// Shared Recipe Menu Component
interface RecipeMenuItemsProps {
  recipeName: string;
  baseRoute: string;
  params: Record<string, string>;
  showRecipeOverview?: boolean;
  showJsonEditor?: boolean;
  showBatches?: boolean;
}

function RecipeMenuItems({
  recipeName,
  baseRoute,
  params,
  showRecipeOverview = true,
  showJsonEditor = true,
  showBatches = true,
}: RecipeMenuItemsProps) {
  const { t } = useTranslation();

  return (
    <>
      <Separator className="my-2" />
      <SidebarGroup>
        <SidebarGroupLabel>{recipeName}</SidebarGroupLabel>
        <SidebarMenu>
          {/* Recipe Overview */}
          {showRecipeOverview && (
            <SidebarMenuItem>
              <SidebarMenuButton tooltip={t("recipes.overview")} asChild>
                <Link to={baseRoute} params={params}>
                  <Home />
                  <span>{t("recipes.overview")}</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          )}

          {/* Recipe Sections */}
          {recipeContextNav.map((item) => (
            <SidebarMenuItem key={item.titleKey}>
              <SidebarMenuButton tooltip={t(item.titleKey)} asChild>
                <Link to={baseRoute} params={params} hash={item.url}>
                  <item.icon />
                  <span>{t(item.titleKey)}</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}

          {/* Mash */}
          <SidebarMenuItem>
            <SidebarMenuButton tooltip={t("recipes.mash")} asChild>
              <Link to={`${baseRoute}/mash` as string} params={params}>
                <Flame />
                <span>{t("recipes.mash")}</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>

          {/* Water */}
          <SidebarMenuItem>
            <SidebarMenuButton tooltip={t("recipes.water")} asChild>
              <Link to={`${baseRoute}/water` as string} params={params}>
                <Droplets />
                <span>{t("recipes.water")}</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>

          {/* Batches - Only show in recipe mode */}
          {showBatches && (
            <SidebarMenuItem>
              <SidebarMenuButton tooltip={t("batches.title")} asChild>
                <Link to={`${baseRoute}/batches` as string} params={params}>
                  <Beaker />
                  <span>{t("batches.title")}</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          )}

          {/* JSON Editor */}
          {showJsonEditor && (
            <SidebarMenuItem>
              <SidebarMenuButton tooltip={t("recipes.jsonEditor")} asChild>
                <Link to={`${baseRoute}/json` as string} params={params}>
                  <Code />
                  <span>{t("recipes.jsonEditor")}</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          )}
        </SidebarMenu>
      </SidebarGroup>
    </>
  );
}

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const { t } = useTranslation();
  const isMac = useIsMac();
  const { state } = useSidebar();
  const isCollapsed = state === "collapsed";
  const router = useRouterState();
  const isRecipeView = router.location.pathname.startsWith("/recipes/");
  const isBatchView = router.location.pathname.startsWith("/batches/");
  const { data: recipesData } = useRecipes();
  const { data: batchesData } = useBatches();

  const translatedNavItems = staticNavItems.map((item) => ({
    ...item,
    title: t(item.titleKey),
  }));

  // Extract recipe ID from pathname
  const recipeId = React.useMemo(() => {
    const match = router.location.pathname.match(/^\/recipes\/([^/]+)/);
    return match ? match[1] : null;
  }, [router.location.pathname]);

  // Extract batch ID from pathname
  const batchId = React.useMemo(() => {
    const match = router.location.pathname.match(/^\/batches\/([^/]+)/);
    return match ? match[1] : null;
  }, [router.location.pathname]);

  // Get current recipe
  const currentRecipe = React.useMemo(() => {
    if (!recipeId || !recipesData) return null;
    return recipesData.find((r) => r.id === recipeId);
  }, [recipeId, recipesData]);

  // Get current batch
  const currentBatch = React.useMemo(() => {
    if (!batchId || !batchesData) return null;
    return batchesData.find((b) => b.id === batchId);
  }, [batchId, batchesData]);

  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              asChild
              tooltip="brewdio"
              className="data-[slot=sidebar-menu-button]:!p-1.5 group-data-[collapsible=icon]:justify-center"
            >
              <Link to="/">
                <span className="text-base font-semibold">
                  {isCollapsed ? "b." : "brewdio."}
                </span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        {/* Static Navigation */}
        <NavMain items={translatedNavItems} />

        {/* Context-dependent sections for Batch View */}
        {isBatchView && batchId && currentBatch && (
          <RecipeMenuItems
            recipeName={currentBatch.name}
            baseRoute="/batches/$batchId"
            params={{ batchId }}
            showRecipeOverview={true}
            showJsonEditor={true}
            showBatches={false}
          />
        )}

        {/* Context-dependent sections for Recipe View */}
        {isRecipeView && recipeId && currentRecipe && (
          <RecipeMenuItems
            recipeName={currentRecipe.recipe.name}
            baseRoute="/recipes/$recipeId"
            params={{ recipeId }}
            showRecipeOverview={true}
            showJsonEditor={true}
          />
        )}
      </SidebarContent>
      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              tooltip={t("common.search")}
              onClick={() => executeCommand("palette.open")}
              className="text-muted-foreground"
            >
              <Search className="h-4 w-4" />
              <span>{t("common.search")}</span>
              <kbd className="ml-auto inline-flex h-5 items-center gap-0.5 rounded border bg-muted px-1.5 text-[10px] font-medium text-muted-foreground pointer-events-none group-data-[collapsible=icon]:hidden">
                {isMac ? "\u2318" : "Ctrl+"}K
              </kbd>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SyncStatus />
          </SidebarMenuItem>
          <SidebarMenuItem>
            <ThemeToggle />
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton tooltip={t("navigation.docs")} asChild>
              <a href="https://docs.brewdio.beer" target="_blank" rel="noopener noreferrer">
                <BookOpen />
                <span>{t("navigation.docs")}</span>
              </a>
            </SidebarMenuButton>
          </SidebarMenuItem>
          {!isCollapsed && (
            <SidebarMenuItem>
              <a
                href="https://docs.brewdio.beer/changelog/"
                target="_blank"
                rel="noopener noreferrer"
                className="px-2 py-1 text-xs text-muted-foreground hover:underline"
              >
                {getVersion()}
              </a>
            </SidebarMenuItem>
          )}
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
