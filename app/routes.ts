import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("players", "routes/players.tsx"),
  route("players/:name", "routes/players.$name.tsx"),
  route("info", "routes/info.tsx"),
] satisfies RouteConfig;
