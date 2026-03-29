#!/bin/bash
# Paperclip Integration Setup for SecOpsAI Dashboard

set -e

echo "🧷 Setting up Paperclip for SecOpsAI Dashboard..."

# Check prerequisites
if ! command -v node &> /dev/null; then
    echo "❌ Node.js not found. Please install Node.js 20+ first."
    exit 1
fi

if ! command -v pnpm &> /dev/null; then
    echo "📦 Installing pnpm..."
    npm install -g pnpm@9.15+
fi

# Install dependencies
echo "📦 Installing dependencies..."
pnpm install

# Clone Paperclip if not already present
if [ ! -d "node_modules/paperclip" ]; then
    echo "🧷 Installing Paperclip..."
    pnpm add paperclip@github:paperclipai/paperclip
fi

# Create Paperclip config
echo "⚙️  Creating Paperclip configuration..."
cat > paperclip.config.json << 'EOF'
{
  "company": {
    "name": "SecOpsAI",
    "mission": "Autonomous security operations and threat detection",
    "goals": [
      "Achieve 99% detection accuracy",
      "Reduce incident response time to under 5 minutes",
      "Maintain SOC 2 compliance"
    ]
  },
  "agents": [
    {
      "role": "exec/agents-orchestrator",
      "name": "Agents Orchestrator",
      "department": "Executive",
      "responsibilities": ["Coordinate agent teams", "Prioritize security incidents", "Resource allocation"]
    },
    {
      "role": "security/security-engineer",
      "name": "Security Engineer",
      "department": "Security",
      "responsibilities": ["Threat detection", "Incident response", "Vulnerability analysis"]
    },
    {
      "role": "platform/backend-architect",
      "name": "Backend Architect",
      "department": "Platform",
      "responsibilities": ["System design", "Performance optimization", "Infrastructure"]
    },
    {
      "role": "product/product-manager",
      "name": "Product Manager",
      "department": "Product",
      "responsibilities": ["Feature prioritization", "User experience", "Roadmap planning"]
    }
  ],
  "integrations": {
    "supabase": {
      "url": "${SUPABASE_URL}",
      "key": "${SUPABASE_ANON_KEY}"
    },
    "discord": {
      "server_id": "${DISCORD_SERVER_ID}"
    }
  }
}
EOF

echo "✅ Paperclip setup complete!"
echo ""
echo "🚀 To start Paperclip:"
echo "   pnpm paperclip:dev"
echo ""
echo "🌐 Paperclip will be available at http://localhost:3100"
echo ""
echo "📋 Next steps:"
echo "   1. Configure your agents in paperclip.config.json"
echo "   2. Set environment variables in .env"
echo "   3. Run 'pnpm paperclip:onboard' to initialize"
echo "   4. Start SecOpsAI dashboard: python3 dashboard_server.py"
