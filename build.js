#!/usr/bin/env node
/**
 * Build script to minify JavaScript and CSS for production
 */

import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync, existsSync, cpSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const distDir = join(__dirname, 'dist');

// Ensure dist directory exists
if (!existsSync(distDir)) {
  mkdirSync(distDir, { recursive: true });
}

async function minifyJS() {
  console.log('Minifying content.js...');
  
  await build({
    entryPoints: ['content.js'],
    bundle: false, // Already bundled
    minify: true,
    outfile: join(distDir, 'content.js'),
    format: 'iife',
    target: 'es2020',
    legalComments: 'none',
  });
  
  console.log('✓ content.js minified');
}

async function minifyCSS() {
  console.log('Minifying content.css...');
  
  const cssContent = readFileSync('content.css', 'utf-8');
  
  await build({
    stdin: {
      contents: cssContent,
      loader: 'css',
      resolveDir: __dirname,
    },
    bundle: false,
    minify: true,
    outfile: join(distDir, 'content.css'),
    write: true,
  });
  
  console.log('✓ content.css minified');
}

async function copyManifest() {
  console.log('Copying manifest.json...');
  const manifest = readFileSync('manifest.json', 'utf-8');
  writeFileSync(join(distDir, 'manifest.json'), manifest);
  console.log('✓ manifest.json copied');
}

function copyIcons() {
  console.log('Copying icons...');
  const iconsDir = join(distDir, 'icons');
  if (!existsSync(iconsDir)) {
    mkdirSync(iconsDir, { recursive: true });
  }
  cpSync('icons', iconsDir, { recursive: true });
  console.log('✓ icons copied');
}

async function runBuild() {
  try {
    console.log('Starting build...\n');
    await minifyJS();
    await minifyCSS();
    copyManifest();
    copyIcons();
    console.log('\n✓ Build complete! Output in dist/');
  } catch (error) {
    console.error('Build failed:', error);
    process.exit(1);
  }
}

runBuild();
