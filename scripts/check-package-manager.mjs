if (!process.env.npm_config_user_agent?.startsWith("pnpm/")) {
  console.error("Use pnpm (or npx pnpm@10.26.1) for this workspace.");
  process.exit(1);
}
