import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

export const getRouter = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        // Every feed here polls on its own interval, so a refetch on focus or
        // reconnect is pure duplicate load — the data is already on its way.
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
        // Public indexers fail often enough that retrying is usually just a
        // slower failure; each fetcher already falls back through proxies.
        retry: 1,
        // Keep answers usable across a remount (opening a token page and
        // coming back) instead of refetching from scratch.
        staleTime: 20_000,
        gcTime: 10 * 60_000,
      },
    },
  });

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
  });

  return router;
};
