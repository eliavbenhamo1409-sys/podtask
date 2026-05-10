import nextConfig from "eslint-config-next";

const eslintConfig = [
  ...nextConfig,
  {
    ignores: [
      "podtask 2/**",
      ".next/**",
      "node_modules/**",
      "supabase/functions/**",
    ],
  },
];

export default eslintConfig;
