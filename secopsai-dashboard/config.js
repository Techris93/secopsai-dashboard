window.SECOPSAI_CONFIG = {
  supabaseUrl: "https://wjxvdjsatfepfcbxunfs.supabase.co",
  supabaseAnonKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndqeHZkanNhdGZlcGZjYnh1bmZzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQxMjExNDUsImV4cCI6MjA4OTY5NzE0NX0.R9XQpSO3YBmlvXZyaD5DUV-L847nXrDWWYadm27LDFU",
  appName: "SecOpsAI Mission Control",
  serverId: "1484917962245668874",
  discordNotifyEndpoint: "/api/discord-notify",
  integrationStatusEndpoint: "/api/integration-status",
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
