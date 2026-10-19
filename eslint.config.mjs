import nextConfig from "eslint-config-next";

const eslintConfig = [
  ...nextConfig,
  {
    ignores: [
      "podtask 2/**",
      // Agent worktrees (each a full checkout with its own .next build).
      ".claude/**",
      ".next/**",
      "node_modules/**",
      "supabase/functions/**", "tests/**", "bench/**", "load/**",
    ],
  },
];

export default eslintConfig;
