import { getCenYingPullOptions } from "../src/hero-cen-ying.ts";
import type { GameModeId, GameState, HeroId, Position, PublicPiece } from "../src/types.ts";

/** Opt-in only; the product pool and remote selection remain unchanged. */
export function heroPilot2Enabled(search: string): boolean {
  return new URLSearchParams(search).get("heroPilot2") === "1";
}

export function pilot2HeroPool(product: readonly HeroId[], enabled: boolean, remote: boolean, mode: GameModeId): readonly HeroId[] {
  return enabled && !remote && mode === "jieqi" ? [...product, "cen_ying"] : product;
}

export const CEN_YING_ART = {
  portrait: new URL("./assets/heroes/cen-ying/portrait-192.webp", import.meta.url).href,
  portraitLarge: new URL("./assets/heroes/cen-ying/portrait-384.webp", import.meta.url).href,
  figure: new URL("./assets/heroes/cen-ying/figure-768.webp", import.meta.url).href,
};

export function renderPilot2Art(container: HTMLElement, hero: HeroId | undefined, figure = false): void {
  const previous = container.querySelector<HTMLImageElement>("[data-hero-pilot2-art]");
  if (hero !== "cen_ying") { previous?.remove(); delete container.dataset.artFallback; return; }
  const src = figure ? CEN_YING_ART.figure : CEN_YING_ART.portrait;
  if (previous?.getAttribute("src") === src) return;
  previous?.remove();
  const img = document.createElement("img");
  img.dataset.heroPilot2Art = figure ? "figure" : "portrait";
  img.src = src;
  if (!figure) img.srcset = `${CEN_YING_ART.portrait} 1x, ${CEN_YING_ART.portraitLarge} 2x`;
  img.alt = figure ? "岑缨：悬衡界引缆人，救援绞盘与抓钩" : "岑缨头像";
  img.decoding = "async";
  img.addEventListener("error", () => { img.remove(); container.dataset.artFallback = "岑缨"; }, { once: true });
  delete container.dataset.artFallback;
  container.append(img);
}

const glyphs: Record<string, string> = { general: "将", advisor: "士", elephant: "象", horse: "马", rook: "车", cannon: "炮", pawn: "兵", storm_elemental: "元素" };
export function pilot2Position(p: Position): string { return `${p.x + 1}路${p.y + 1}行`; }
function pieceName(p: PublicPiece | undefined): string { return !p || p.faceDown ? "暗棋" : `${p.color === "red" ? "红" : "黑"}${glyphs[p.type]}`; }

/** Only receives the public board. No traps, hidden identities or royal hosts. */
export function createCenYingPullPicker(state: GameState) {
  const options = getCenYingPullOptions(state, state.turn);
  const root = document.createElement("div"); root.className = "cen-ying-picker";
  const anchor = document.createElement("select"), target = document.createElement("select");
  anchor.setAttribute("aria-label", "引缆的己方锚点");
  target.setAttribute("aria-label", "引缆的敌方目标");
  const field = (text: string, input: HTMLSelectElement) => { const label = document.createElement("label"); label.textContent = text; label.append(input); return label; };
  const preview = document.createElement("p"); preview.className = "cen-ying-pull-preview"; preview.setAttribute("aria-live", "polite");
  const board = document.createElement("div"); board.className = "cen-ying-preview-board"; board.setAttribute("aria-label", "引缆公开棋盘预览：金色为锚，红框为目标，虚线为落点");
  const legend = document.createElement("small"); legend.textContent = "金色：己方锚点　红框：敌棋　虚线：落点";
  for (const id of new Set(options.map(o => o.anchorPieceId))) {
    const p = state.pieces.find(p => p.id === id)!;
    anchor.add(new Option(`${pieceName(p)} · ${pilot2Position(p)}`, id));
  }
  const selected = () => options.find(o => o.anchorPieceId === anchor.value && o.pieceId === target.value);
  const renderPreview = () => {
    const chosen = selected(); board.replaceChildren();
    if (!chosen) { preview.textContent = "当前没有符合条件的引缆目标。"; return; }
    const anchorPiece = state.pieces.find(p => p.id === chosen.anchorPieceId)!;
    preview.textContent = `${pieceName(state.pieces.find(p => p.id === chosen.pieceId))}：${pilot2Position(chosen.from)} → ${pilot2Position(chosen.to)}。锚点留在原位，发动后轮到对手。`;
    for (let y = 0; y < 10; y++) for (let x = 0; x < 9; x++) {
      const cell = document.createElement("span");
      const piece = state.pieces.find(p => p.x === x && p.y === y && p.layer !== "river" && p.layer !== "air");
      cell.textContent = piece ? piece.faceDown ? "暗" : glyphs[piece.type] : "·";
      if (piece && !piece.faceDown) cell.dataset.side = piece.color;
      if (x === anchorPiece.x && y === anchorPiece.y) cell.classList.add("anchor");
      if (x === chosen.from.x && y === chosen.from.y) cell.classList.add("target");
      if (x === chosen.to.x && y === chosen.to.y) cell.classList.add("landing");
      cell.setAttribute("aria-label", `${pilot2Position({x, y})} ${piece ? pieceName(piece) : "空格"}`);
      board.append(cell);
    }
  };
  const changeAnchor = () => {
    target.replaceChildren();
    for (const o of options.filter(o => o.anchorPieceId === anchor.value)) target.add(new Option(`${pieceName(state.pieces.find(p => p.id === o.pieceId))} · ${pilot2Position(o.from)} → ${pilot2Position(o.to)}`, o.pieceId));
    renderPreview();
  };
  anchor.addEventListener("change", changeAnchor); target.addEventListener("change", renderPreview);
  root.append(field("1 · 选己方锚点", anchor), field("2 · 选敌方目标", target), preview, board, legend);
  changeAnchor();
  return { root, options, selected };
}
