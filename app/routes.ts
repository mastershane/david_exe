import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("event/:id", "routes/event.$id.tsx"),
  route("event/:id/details", "routes/event.$id.details.tsx"),
  route("players", "routes/players.tsx"),
  route("players/:id", "routes/players.$id.tsx"),
  route("info", "routes/info.tsx"),
  route("settings", "routes/settings.tsx"),
  // API resource routes (no UI)
  route("api/events", "routes/api.events.tsx"),
  route("api/events/:id", "routes/api.events.$id.tsx"),
  route("api/registry", "routes/api.registry.tsx"),
] satisfies RouteConfig;
