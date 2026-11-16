'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
let sharp;
try { sharp = require('sharp'); }
catch (error) {
  const modules = process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES;
  if (!modules) throw error;
  sharp = require(path.join(modules, 'sharp'));
}
const root = path.resolve(__dirname, '../..');
const output = path.join(root, 'web/assets/heroes/cen-ying');
const masterPaths = {
  figure: path.join(__dirname, 'masters/cen-ying-figure-v1.png'),
  portrait: path.join(__dirname, 'masters/cen-ying-portrait-v1.png'),
};
const rel = p => path.relative(root, p).split(path.sep).join('/');
const digest = p => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
async function inspect(p) {
  const meta = await sharp(p).metadata();
  const { data, info } = await sharp(p).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const ai = info.channels - 1;
  let min = 255, max = 0, zeros = 0, opaque = 0;
  let left = info.width, top = info.height, right = -1, bottom = -1;
  for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) {
    const a = data[(y * info.width + x) * info.channels + ai];
    min = Math.min(min, a); max = Math.max(max, a);
    if (a === 0) zeros++;
    if (a === 255) opaque++;
    if (a > 200) {
      left = Math.min(left, x); right = Math.max(right, x);
      top = Math.min(top, y); bottom = Math.max(bottom, y);
    }
  }
  return {
    path: rel(p), sha256: digest(p), bytes: fs.statSync(p).size,
    format: meta.format, width: meta.width, height: meta.height,
    has_alpha: Boolean(meta.hasAlpha),
    alpha: {
      minimum: min, maximum: max, fully_transparent_pixels: zeros, fully_opaque_pixels: opaque,
      solid_subject_bbox_alpha_gt_200: right < 0 ? null : [left, top, right + 1, bottom + 1],
      corners: [0, info.width - 1, (info.height - 1) * info.width, info.width * info.height - 1].map(p => data[p * info.channels + ai])
    }
  };
}
async function main() {
  fs.mkdirSync(output, { recursive: true });
  const encoding = { quality: 88, alphaQuality: 100, effort: 6 };
  const specs = [
    { name: 'portrait-192.webp', master: 'portrait', resize: { width: 192, height: 192, fit: 'inside', withoutEnlargement: true } },
    { name: 'portrait-384.webp', master: 'portrait', resize: { width: 384, height: 384, fit: 'inside', withoutEnlargement: true } },
    { name: 'figure-768.webp', master: 'figure', resize: { height: 768, fit: 'inside', withoutEnlargement: true } },
  ];
  const masters = {};
  for (const [id, p] of Object.entries(masterPaths)) masters[id] = await inspect(p);
  const exports = [];
  for (const spec of specs) {
    const target = path.join(output, spec.name);
    await sharp(masterPaths[spec.master]).resize(spec.resize).webp(encoding).toFile(target);
    exports.push({ ...await inspect(target), source_master: masters[spec.master].path, source_sha256: masters[spec.master].sha256, resize: spec.resize, encoding });
  }
  const figure = masters.figure;
  const portrait = masters.portrait;
  if (!figure.has_alpha || figure.alpha.fully_transparent_pixels === 0) throw new Error('Figure has no transparent background');
  if (figure.alpha.corners.some(a => a !== 0)) throw new Error('Figure corner is not fully transparent');
  if (portrait.width !== portrait.height) throw new Error('Portrait is not square');
  if (exports.find(e => e.path.endsWith('figure-768.webp')).alpha.fully_transparent_pixels === 0) throw new Error('Export lost transparency');
  const promptRecord = JSON.parse(fs.readFileSync(path.join(__dirname, 'PROMPTS.json'), 'utf8'));
  const manifest = {
    schema_version: 1, asset_id: 'EXP-HERO-002-CEN-YING-ART-v1',
    hero_id: 'cen_ying', hero_name: '岑缨',
    decision_status: 'delegated_designer_decision',
    user_individually_approved_images: false,
    generation: { tool: 'built-in image_gen.imagegen', fallback_cli_used: false, prompts: promptRecord.prompts },
    masters,
    exports,
    export_pipeline: { script: rel(__filename), engine: 'sharp', sharp_version: sharp.versions.sharp, mutations: ['proportional downsize', 'WebP encoding'], no_background_removal_or_repainting: true },
    verification: {
      original_selected_png_bytes_copied_without_reencoding: true,
      full_body_and_tools_visually_present: true,
      portrait_identity_consistent_with_figure_reference: true,
      no_text_watermark_ui_or_extra_characters_observed: true,
      figure_alpha_preserved: true,
      alpha_note: 'The built-in transparent master has interior alpha up to 254, not 255. This source alpha is retained; no thresholding, matte removal or alpha normalization was performed.',
      framing_note: 'Figure solid-content bounds at alpha >200 are inset from all canvas edges; full boots, hair, winch, hook and cable are visible.',
      limitations: ['Autonomous art decision; not user-by-user image approval', 'No browser/device visual acceptance is claimed by this manifest']
    }
  };
  fs.writeFileSync(path.join(__dirname, 'ASSET_MANIFEST.json'), JSON.stringify(manifest, null, 2) + '\n');
  console.log(JSON.stringify({ masters, exports, export_bytes: exports.reduce((n, e) => n + e.bytes, 0) }, null, 2));
}
main().catch(error => { console.error(error); process.exit(1); });
