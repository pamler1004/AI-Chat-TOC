#!/usr/bin/env node
/**
 * 打包发布脚本:读 manifest 版本 → 语法自检 → 压缩 src/ 为 dist/ai-chat-toc-{version}.zip
 * zip 顶层即 manifest.json(不套 src/),排除 .DS_Store。
 * 运行: node scripts/package.mjs
 */
import { readFileSync, rmSync, mkdirSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const version = JSON.parse(readFileSync(resolve(root, 'src/manifest.json'), 'utf8')).version;
const zipRel = `dist/ai-chat-toc-${version}.zip`;

// 1. 语法自检
execSync('node --check src/content.js', { stdio: 'inherit', cwd: root });

// 2. 准备 dist(清掉同版本旧 zip,避免残留文件混入)
mkdirSync(resolve(root, 'dist'), { recursive: true });
rmSync(resolve(root, zipRel), { force: true });

// 3. 打包:从 src/ 压缩,zip 顶层即 manifest.json
execSync(`(cd src && zip -r ../${zipRel} . -x "*.DS_Store" -x "*/.DS_Store")`, { stdio: 'inherit', cwd: root });

// 4. 校验:顶层须含 manifest.json,且不能套 src/
const files = execSync(`unzip -Z1 ${zipRel}`, { cwd: root }).toString().split('\n').map(s => s.trim()).filter(Boolean);
const ok = files.includes('manifest.json') && !files.some(f => f.startsWith('src/'));
console.log(`\n✅ 打包完成: ${zipRel} (v${version})`);
console.log(`   顶层含 manifest.json 且未套 src/: ${ok ? '是' : '否(请检查!)'}`);
if (!ok) process.exit(1);
