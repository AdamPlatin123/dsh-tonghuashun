import { build } from 'esbuild';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

await mkdir('dist', { recursive: true });
await build({ entryPoints: ['src/index.js'], bundle: true, platform: 'node', format: 'esm', target: 'node22', outfile: 'dist/index.js', sourcemap: true });
const css = await readFile('src/client/styles.css', 'utf8');
const client = await build({ entryPoints: ['src/client/plugin.jsx'], bundle: true, platform: 'browser', format: 'cjs', target: 'es2022', write: false, minify: true, external: ['react', 'react/jsx-runtime', 'react-dom', 'react-dom/client', '@deepseek-ai/cordis'] });
const code = client.outputFiles[0].text;
await writeFile('dist/client.js', `window.__ModuleLoader__.load({id:"dsh-tonghuashun",factory:(require)=>{var module={exports:{}};var exports=module.exports;\n${code}\nconst apply=module.exports.apply;return {...module.exports,apply:function(ctx,...args){ctx.effect(()=>{const style=document.createElement('style');style.dataset.ths='skin';style.textContent=${JSON.stringify(css)};document.head.appendChild(style);return()=>style.remove();});return apply(ctx,...args);}};}});\n`);
await build({ entryPoints: ['src/client/preview.jsx'], bundle: true, platform: 'browser', format: 'esm', target: 'es2022', outfile: 'dist/preview.js', sourcemap: true });
await writeFile('dist/styles.css', css);
const notices = ['Third-party software included in the plugin or its standalone preview.\n'];
for (const name of ['diff', 'lightweight-charts', 'lucide-react', 'react', 'react-dom', 'scheduler']) {
  const metadata = JSON.parse(await readFile(`node_modules/${name}/package.json`, 'utf8'));
  notices.push(`${name} ${metadata.version}\n${await readFile(`node_modules/${name}/LICENSE`, 'utf8')}`);
}
const canvas = JSON.parse(await readFile('node_modules/fancy-canvas/package.json', 'utf8'));
notices.push(`fancy-canvas ${canvas.version}\nLicense: ${canvas.license}\nAuthor: ${canvas.author}\nThe distributed npm package does not include a separate license file.\n`);
notices.push('Lightweight Charts attribution: Copyright (c) TradingView, Inc. https://www.tradingview.com/\n');
await writeFile('dist/THIRD_PARTY_NOTICES.txt', notices.join('\n\n============================================================\n\n'));
console.log('Built host plugin, DSH client module, and preview.');
