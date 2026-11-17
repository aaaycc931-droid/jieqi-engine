import type { HeroId } from "../src/types.ts";

/** EXP-HERO-001 only. Artwork registration does not add a product hero. */
export const SIHENG_ART = Object.freeze({
  portrait: "./assets/hero-pilot/siheng-portrait-v1.webp",
  avatar: "./assets/hero-pilot/siheng-avatar-128-v1.webp",
  avatarSrcset: "./assets/hero-pilot/siheng-avatar-64-v1.webp 64w, ./assets/hero-pilot/siheng-avatar-128-v1.webp 128w, ./assets/hero-pilot/siheng-avatar-256-v1.webp 256w",
});

export function mountHeroArt(host: HTMLElement, hero: HeroId | undefined, kind: "avatar" | "portrait" = "avatar"): void {
  const previous = host.querySelector<HTMLImageElement>("img.hero-character-art");
  host.dataset.hero = hero ?? "";
  host.classList.toggle("has-hero-art", hero === "siheng");
  if (hero !== "siheng") { previous?.remove(); delete host.dataset.artKind; return; }
  host.dataset.artKind = kind;
  const img = previous ?? document.createElement("img");
  img.className = "hero-character-art";
  img.alt = kind === "portrait" ? "司衡立绘：深青工作袍、米白领巾，左腕悬挂两枚铜色方形配重" : "司衡头像";
  img.decoding = "async"; img.draggable = false;
  img.src = kind === "portrait" ? SIHENG_ART.portrait : SIHENG_ART.avatar;
  if (kind === "avatar") { img.srcset = SIHENG_ART.avatarSrcset; img.sizes = "(max-width: 600px) 64px, 128px"; }
  else { img.removeAttribute("srcset"); img.removeAttribute("sizes"); }
  if (!previous) host.append(img);
}

export function sihengPortraitMarkup(): string {
  return `<figure class="siheng-portrait-panel"><img src="${SIHENG_ART.portrait}" alt="司衡全身立绘：悬衡界的航路匠" decoding="async"><figcaption>司衡 · 悬衡界航路匠</figcaption></figure>`;
}
