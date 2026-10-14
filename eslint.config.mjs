import nextConfig from "eslint-config-next";

const eslintConfig = [
  ...nextConfig,
  {
    ignores: [
      "podtask 2/**",
      ".next/**",
      "node_modules/**",
      "supabase/functions/**", "tests/**", "bench/**", "load/**",
    ],
  },
];

export default eslintConfig;
