// Review-only public projection; never serialize hidden identity, color or id.
import { createInitialGame } from '../../../src/setup.ts';
import { GAME_MODES } from '../../../src/modes.ts';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const labels = {
  red: { general: '帅', advisor: '仕', elephant: '相', horse: '马', rook: '车', cannon: '炮', pawn: '兵', storm_elemental: '风暴元素' },
  black: { general: '将', advisor: '士', elephant: '象', horse: '馬', rook: '車', cannon: '砲', pawn: '卒', storm_elemental: '风暴元素' },
}; // Glyph mapping matches web/app.ts:84-86 at the recorded base commit.
const boards = {};
for (const mode of Object.keys(GAME_MODES)) {
  const { state } = createInitialGame(undefined, mode);
  boards[mode] = Array.from({ length: 10 }, (_, y) => Array.from({ length: 9 }, (_, x) => {
    const p = state.pieces.find(p => p.x === x && p.y === y && p.layer === undefined);
    if (!p) return { label: '' };
    if (p.faceDown) return { label: '暗' };
    const label = labels[p.color]?.[p.type];
    if (!label) throw new Error(`Missing public glyph mapping for ${p.type}`);
    return { label, publicColor: p.color };
  }));
}
writeFileSync(fileURLToPath(new URL('settings-public-fixtures.json', import.meta.url)), JSON.stringify({
  schema: 'lezi.ui_settings_public_fixture.v1',
  source_commit: 'ac8c25c4adddf429bcd73c99129793efb6f96f7d',
  derived_by: 'createInitialGame(undefined, mode) -> faceDown: label only; revealed: public glyph and color',
  modes: GAME_MODES, boards,
}, null, 2) + '\n');
