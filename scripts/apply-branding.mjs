#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

// List of target files to brand for HydraROUTER
const brandingReplacements = [
  // Footer.js
  {
    file: 'src/app/landing/components/Footer.js',
    rules: [
      { from: /<h3 className="text-white text-lg font-bold">9Router<\/h3>/g, to: '<h3 className="text-white text-lg font-bold">HydraROUTER</h3>' },
      { from: /https:\/\/github\.com\/decolua\/9router/g, to: 'https://github.com/hydraromania/HydraROUTER' },
      { from: /© \d+ 9Router/g, to: '© 2026 HydraROUTER' },
    ]
  },
  // GetStarted.js
  {
    file: 'src/app/landing/components/GetStarted.js',
    rules: [
      { from: /Install 9Router/g, to: 'Install HydraROUTER' },
      { from: /Starting 9Router/g, to: 'Starting HydraROUTER' },
      { from: /Install 9Router, configure/g, to: 'Install HydraROUTER, configure' },
      { from: /npx 9router/g, to: 'npx hydrarouter' },
      { from: /~\/\.9router/g, to: '~/.hydrarouter' },
      { from: /%APPDATA%\/9router/g, to: '%APPDATA%/hydrarouter' },
    ]
  },
  // HeroSection.js
  {
    file: 'src/app/landing/components/HeroSection.js',
    rules: [
      { from: /https:\/\/github\.com\/decolua\/9router/g, to: 'https://github.com/hydraromania/HydraROUTER' },
    ]
  },
  // HowItWorks.js
  {
    file: 'src/app/landing/components/HowItWorks.js',
    rules: [
      { from: /How 9Router Works/g, to: 'How HydraROUTER Works' },
      { from: /2\. 9Router Hub/g, to: '2. HydraROUTER Hub' },
    ]
  },
  // Navigation.js
  {
    file: 'src/app/landing/components/Navigation.js',
    rules: [
      { from: /https:\/\/github\.com\/decolua\/9router/g, to: 'https://github.com/hydraromania/HydraROUTER' },
    ]
  },
  // landing page.js
  {
    file: 'src/app/landing/page.js',
    rules: [
      { from: /with 9Router\./g, to: 'with HydraROUTER.' },
      { from: /https:\/\/github\.com\/decolua\/9router/g, to: 'https://github.com/hydraromania/HydraROUTER' },
    ]
  },
  // Login page
  {
    file: 'src/app/login/page.js',
    rules: [
      { from: /9router CLI/g, to: 'HydraROUTER CLI' },
    ]
  },
  // Endpoint page client
  {
    file: 'src/app/(dashboard)/dashboard/endpoint/EndpointPageClient.js',
    rules: [
      { from: /local 9Router/g, to: 'local HydraROUTER' },
    ]
  },
  // Profile page
  {
    file: 'src/app/(dashboard)/dashboard/profile/page.js',
    rules: [
      { from: /~\/\.9router/g, to: '~/.hydrarouter' },
    ]
  },
  // ProviderTopology.js
  {
    file: 'src/app/(dashboard)/dashboard/usage/components/ProviderTopology.js',
    rules: [
      { from: /Center 9Router node/g, to: 'Center HydraROUTER node' },
      { from: /alt="9Router"/g, to: 'alt="HydraROUTER"' },
      { from: /(>\s*)9Router(\s*<)/g, to: '$1HydraROUTER$2' },
    ]
  },
  // TokenSaverClient.js
  {
    file: 'src/app/(dashboard)/dashboard/token-saver/TokenSaverClient.js',
    rules: [
      { from: /the 9Router data directory/g, to: 'the HydraROUTER data directory' },
    ]
  },
  // Header.js
  {
    file: 'src/shared/components/Header.js',
    rules: [
      { from: /route through 9Router/g, to: 'route through HydraROUTER' },
      { from: /use 9Router — no install needed/g, to: 'use HydraROUTER — no install needed' },
    ]
  },
  // DonateModal.js
  {
    file: 'src/shared/components/DonateModal.js',
    rules: [
      { from: /Support 9Router/g, to: 'Support HydraROUTER' },
    ]
  },
  // layout.js
  {
    file: 'src/app/layout.js',
    rules: [
      { from: /title:\s*"9Router/g, to: 'title: "HydraROUTER' },
    ]
  },
  // manifest.js
  {
    file: 'src/app/manifest.js',
    rules: [
      { from: /9Router - AI Infrastructure Management/g, to: 'HydraROUTER - AI Infrastructure Management' },
      { from: /'9Router'/g, to: "'HydraROUTER'" },
    ]
  }
];

let updatedCount = 0;

for (const item of brandingReplacements) {
  const filePath = path.join(rootDir, item.file);
  if (!fs.existsSync(filePath)) {
    console.log(`[apply-branding] File not found: ${item.file}`);
    continue;
  }

  let content = fs.readFileSync(filePath, 'utf8');
  let originalContent = content;

  for (const rule of item.rules) {
    content = content.replace(rule.from, rule.to);
  }

  if (content !== originalContent) {
    fs.writeFileSync(filePath, content, 'utf8');
    console.log(`[apply-branding] Applied branding to ${item.file}`);
    updatedCount++;
  }
}

console.log(`[apply-branding] Done! Updated ${updatedCount} files.`);
