window.SECOPSAI_CONFIG = {
  supabaseUrl: "__SUPABASE_URL__",
  supabaseAnonKey: "__SUPABASE_ANON_KEY__",
  appName: "__APP_NAME__",
  integrationStatusEndpoint: "/api/integration-status",
  runOutputEndpoint: "/api/run-output",
  aiGuard: {
    hostedEnabled: __HOSTED_AI_ENABLED__,
    defaultModel: "__HOSTED_AI_MODEL__",
    maxCostUsd: __HOSTED_AI_MAX_COST_USD__,
    allowMutations: __HOSTED_AI_ALLOW_MUTATIONS__
  },
  departments: {
    exec: "#06B6D4",
    platform: "#3B82F6",
    security: "#8B5CF6",
    product: "#6366F1",
    revenue: "#F59E0B",
    support: "#10B981"
  },
  roleGroups: {
    exec: ["exec/agents-orchestrator"],
    platform: [
      "platform/software-architect",
      "platform/backend-architect",
      "platform/ai-engineer",
      "platform/devops-automator"
    ],
    security: [
      "security/security-engineer",
      "security/threat-detection-engineer"
    ],
    product: [
      "product/product-manager",
      "product/ui-designer"
    ],
    revenue: [
      "revenue/content-creator",
      "revenue/outbound-strategist",
      "revenue/sales-engineer"
    ],
    support: ["support/support-responder"]
  }
};
