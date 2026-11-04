#!/usr/bin/env bash
# Minimal Vite and Next projects with '@/...' imports to test dependency-cruiser.
set -euo pipefail
S="$1"; mkdir -p "$S" && cd "$S"

# --- Vite + React (JS, jsx). Alias in vite.config.js and jsconfig.json
mkdir -p vite/src/components vite/src/features/billing
cat > vite/package.json <<'EOF'
{ "name": "v", "private": true, "type": "module" }
EOF
cat > vite/vite.config.js <<'EOF'
import { defineConfig } from 'vite';
import path from 'node:path';
export default defineConfig({ resolve: { alias: { '@': path.resolve(__dirname, './src') } } });
EOF
cat > vite/jsconfig.json <<'EOF'
{ "compilerOptions": { "baseUrl": ".", "paths": { "@/*": ["src/*"] } } }
EOF
echo "import { Button } from '@/components/Button';
import { total } from '@/features/billing';
export const App = () => [Button, total];" > vite/src/App.jsx
echo "export const Button = 1;" > vite/src/components/Button.jsx
echo "export { total } from './total';" > vite/src/features/billing/index.js
echo "export const total = 2;" > vite/src/features/billing/total.js

# --- Next app router (TS, tsx). Alias in tsconfig.json
mkdir -p next/src/app next/src/components next/src/lib
cat > next/package.json <<'EOF'
{ "name": "n", "private": true }
EOF
cat > next/tsconfig.json <<'EOF'
{ "compilerOptions": { "target": "ES2017", "module": "esnext", "moduleResolution": "bundler", "jsx": "preserve", "baseUrl": ".", "paths": { "@/*": ["./src/*"] } }, "include": ["**/*.ts", "**/*.tsx"] }
EOF
echo "import { Card } from '@/components/Card';
import { db } from '@/lib/db';
export default function Page() { return [Card, db]; }" > next/src/app/page.tsx
echo "export const Card = 1;" > next/src/components/Card.tsx
echo "export const db = 1;" > next/src/lib/db.ts
echo ok
