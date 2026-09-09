import { ServerResponse } from "node:http";

export const KNIGHT_RIDER_THEME_MARKER = 'data-knight-rider-theme="2026-09-09"';

export const KNIGHT_RIDER_THEME_CSS = String.raw`
/* SARA Owner Node // cyberpunk cockpit skin
   Presentation-only override. Owner authentication, controls, IDs and API routes remain unchanged. */
:root {
  --void: #010208 !important;
  --ink: #030711 !important;
  --ink-raised: #07101e !important;
  --panel: rgba(5, 13, 25, .965) !important;
  --panel-strong: #071525 !important;
  --panel-hot: #0a2134 !important;
  --line: rgba(74, 229, 255, .28) !important;
  --line-bright: rgba(74, 229, 255, .68) !important;
  --line-hard: rgba(74, 229, 255, .92) !important;
  --text: #eefbff !important;
  --muted: #8da9bc !important;
  --cyan: #45e9ff !important;
  --cyan-soft: #c8f8ff !important;
  --teal: #26ead0 !important;
  --blue: #2e92ff !important;
  --amber: #ffc966 !important;
  --coral: #ff315d !important;
  --scanner-red: #ff174f;
  --scanner-hot: #ffecf2;
  --scanner-magenta: #ff297d;
}

html { background: #010208 !important; }
body {
  background:
    radial-gradient(circle at 82% 4%, rgba(255,23,79,.16), transparent 23rem),
    radial-gradient(circle at 8% 8%, rgba(45,143,255,.21), transparent 29rem),
    radial-gradient(circle at 50% 44%, rgba(27,214,255,.07), transparent 37rem),
    linear-gradient(180deg, #01040a 0%, #040915 38%, #01040a 100%) !important;
}

body::before {
  opacity: .62 !important;
  background-image:
    linear-gradient(rgba(69,233,255,.035) 1px, transparent 1px),
    linear-gradient(90deg, rgba(69,233,255,.032) 1px, transparent 1px),
    repeating-linear-gradient(90deg, transparent 0 78px, rgba(255,23,79,.025) 79px 80px) !important;
  background-size: 38px 38px, 38px 38px, 160px 100% !important;
  mask-image: linear-gradient(to bottom, black 0%, rgba(0,0,0,.9) 76%, transparent 100%) !important;
}

body::after {
  opacity: .20 !important;
  background:
    repeating-linear-gradient(to bottom, transparent 0 3px, rgba(133,235,255,.07) 4px),
    linear-gradient(90deg, transparent 0%, rgba(255,23,79,.025) 50%, transparent 100%) !important;
}

.shell { width: min(1280px, calc(100% - 26px)) !important; }

.topbar {
  min-height: 82px !important;
  padding: 0 12px !important;
  border: 1px solid rgba(69,233,255,.27) !important;
  border-top: 0 !important;
  border-left: 3px solid var(--scanner-red) !important;
  background: linear-gradient(90deg, rgba(2,7,14,.98), rgba(6,16,31,.96) 56%, rgba(9,8,20,.97)) !important;
  box-shadow: 0 11px 38px rgba(0,0,0,.55), 0 0 24px rgba(69,233,255,.05), inset 0 -1px rgba(69,233,255,.12) !important;
  clip-path: polygon(0 0, 100% 0, 100% calc(100% - 12px), calc(100% - 12px) 100%, 12px 100%, 0 calc(100% - 12px));
}

.topbar::before {
  position: absolute;
  left: 0;
  bottom: 0;
  width: 116px;
  height: 2px;
  content: "";
  background: linear-gradient(90deg, var(--scanner-red), var(--scanner-magenta), transparent);
  box-shadow: 0 0 15px rgba(255,23,79,.95);
}

.topbar::after {
  width: 32% !important;
  height: 2px !important;
  background: linear-gradient(90deg, transparent, var(--cyan), #dffcff) !important;
  box-shadow: 0 0 16px rgba(69,233,255,.82) !important;
}

.brand { gap: 14px !important; }
.brand-mark {
  width: 48px !important;
  height: 48px !important;
  border: 1px solid rgba(69,233,255,.9) !important;
  border-radius: 7px !important;
  background: linear-gradient(145deg, #071326, #020711 72%) !important;
  box-shadow: 0 0 22px rgba(69,233,255,.22), -8px 0 20px rgba(255,23,79,.10), inset 0 0 18px rgba(69,233,255,.08) !important;
  clip-path: polygon(14% 0, 86% 0, 100% 14%, 100% 86%, 86% 100%, 14% 100%, 0 86%, 0 14%);
}
.brand-mark::before {
  inset: 6px !important;
  display: grid !important;
  place-items: center !important;
  border: 2px solid rgba(208,250,255,.92) !important;
  border-left-color: var(--cyan) !important;
  border-right-color: var(--scanner-red) !important;
  color: #effcff !important;
  content: "S" !important;
  font: 900 1.45rem/1 var(--sans) !important;
  letter-spacing: -.08em !important;
  text-shadow: 0 0 11px rgba(69,233,255,.65) !important;
  clip-path: polygon(16% 0, 84% 0, 100% 16%, 100% 84%, 84% 100%, 16% 100%, 0 84%, 0 16%);
}
.brand-mark::after {
  top: auto !important;
  right: 2px !important;
  bottom: 2px !important;
  left: 2px !important;
  width: auto !important;
  height: 3px !important;
  background: linear-gradient(90deg, transparent, var(--scanner-red), #fff, var(--scanner-red), transparent) !important;
  box-shadow: 0 0 11px rgba(255,23,79,.9) !important;
  animation: kittSweep 1.45s ease-in-out infinite alternate !important;
}
.brand-name { color: #f2fbff !important; font-size: 1rem !important; letter-spacing: .30em !important; }
.brand-world { color: #7ea0b6 !important; }
.domain-pill { color: #8ca9bb !important; }

.button {
  border-radius: 2px !important;
  border-color: rgba(69,233,255,.42) !important;
  background: linear-gradient(180deg, rgba(9,28,47,.97), rgba(3,10,19,.97)) !important;
  box-shadow: inset 0 0 0 1px rgba(69,233,255,.035), 0 0 14px rgba(69,233,255,.04) !important;
  clip-path: polygon(8px 0, 100% 0, 100% calc(100% - 8px), calc(100% - 8px) 100%, 0 100%, 0 8px);
}
.button:hover { border-color: var(--cyan) !important; box-shadow: 0 0 20px rgba(69,233,255,.16) !important; }
.button.primary {
  border-color: rgba(195,250,255,.78) !important;
  background: linear-gradient(105deg, #ff294e 0%, #db345f 21%, #4bc9d5 66%, #45f3ee 100%) !important;
  color: #031017 !important;
  text-shadow: none !important;
  box-shadow: 0 0 17px rgba(255,23,79,.18), 0 0 20px rgba(69,233,255,.18), inset 0 1px rgba(255,255,255,.32) !important;
}
.button.danger { border-color: rgba(255,49,93,.7) !important; background: linear-gradient(180deg, rgba(112,13,42,.78), rgba(49,7,20,.9)) !important; }

.scan-rail {
  height: 15px !important;
  margin-top: 8px !important;
  border-color: rgba(69,233,255,.34) !important;
  background:
    repeating-linear-gradient(90deg, #081221 0 28px, #020711 29px 32px),
    #02050b !important;
  box-shadow: inset 0 0 20px rgba(38,141,255,.11), 0 0 18px rgba(69,233,255,.06) !important;
}
.scan-rail::before {
  inset: 2px !important;
  opacity: .75 !important;
  background: repeating-linear-gradient(90deg, rgba(69,233,255,.15) 0 27px, transparent 28px 32px) !important;
}
.scan-rail span {
  top: 2px !important;
  bottom: 2px !important;
  width: 17% !important;
  background: linear-gradient(90deg, transparent, #7b0829 8%, var(--scanner-red) 34%, var(--scanner-hot) 50%, var(--scanner-red) 66%, #7b0829 92%, transparent) !important;
  box-shadow: 0 0 12px rgba(255,23,79,.95), 0 0 28px rgba(255,23,79,.72), 0 0 44px rgba(255,23,79,.32) !important;
  animation: kittSweep 1.35s cubic-bezier(.4,0,.2,1) infinite alternate !important;
}

.hero {
  position: relative;
  min-height: 625px !important;
  margin-top: 18px !important;
  padding: 58px 34px 62px !important;
  border: 1px solid rgba(69,233,255,.20);
  border-top: 2px solid rgba(255,23,79,.78);
  border-right-color: rgba(255,49,93,.22);
  background:
    linear-gradient(115deg, rgba(3,10,20,.98) 0 48%, rgba(6,18,34,.91) 64%, rgba(12,6,23,.86) 100%),
    repeating-linear-gradient(90deg, transparent 0 56px, rgba(69,233,255,.018) 57px 58px) !important;
  box-shadow: 0 24px 55px rgba(0,0,0,.45), 0 -8px 30px rgba(255,23,79,.045), inset 0 0 55px rgba(46,146,255,.035);
  clip-path: polygon(18px 0, calc(100% - 18px) 0, 100% 18px, 100% calc(100% - 18px), calc(100% - 18px) 100%, 18px 100%, 0 calc(100% - 18px), 0 18px);
}
.hero::before {
  position: absolute;
  top: 0;
  left: 8%;
  width: 23%;
  height: 2px;
  content: "";
  background: linear-gradient(90deg, transparent, var(--scanner-red), #fff, var(--scanner-red), transparent);
  box-shadow: 0 0 17px rgba(255,23,79,.8);
}
.hero::after {
  position: absolute;
  right: 18px;
  bottom: 18px;
  width: 84px;
  height: 7px;
  content: "";
  background: repeating-linear-gradient(90deg, var(--scanner-red) 0 11px, transparent 12px 15px);
  filter: drop-shadow(0 0 6px rgba(255,23,79,.9));
}
.hero > div:first-child::before { background: linear-gradient(to bottom, var(--cyan), rgba(46,146,255,.38), var(--scanner-red), transparent) !important; }
.eyebrow { color: var(--cyan) !important; text-shadow: 0 0 10px rgba(69,233,255,.30); }
h1 { color: #f2fbff !important; text-shadow: 0 0 30px rgba(46,146,255,.12), 3px 0 0 rgba(255,23,79,.035) !important; }
h1 em { color: var(--cyan) !important; text-shadow: 0 0 24px rgba(69,233,255,.36) !important; }
.hero-copy { color: #a9bfd0 !important; }
.hero-copy strong { color: #f4fdff !important; }
.truth-chip {
  border-radius: 1px !important;
  border-color: rgba(69,233,255,.32) !important;
  background: linear-gradient(180deg, rgba(7,24,39,.94), rgba(2,9,17,.94)) !important;
  box-shadow: inset 3px 0 var(--cyan), 0 0 11px rgba(69,233,255,.04) !important;
  clip-path: polygon(6px 0, 100% 0, 100% calc(100% - 6px), calc(100% - 6px) 100%, 0 100%, 0 6px);
}
.truth-chip:nth-child(2)::before { background: var(--scanner-red) !important; box-shadow: 0 0 9px var(--scanner-red) !important; }

.core-stage {
  border-color: rgba(69,233,255,.26) !important;
  background:
    radial-gradient(circle at 50% 50%, rgba(255,23,79,.08), transparent 28%),
    linear-gradient(rgba(69,233,255,.04) 1px, transparent 1px),
    linear-gradient(90deg, rgba(69,233,255,.04) 1px, transparent 1px),
    rgba(2,8,15,.58) !important;
  background-size: auto, 22px 22px, 22px 22px, auto !important;
  box-shadow: inset 0 0 45px rgba(46,146,255,.08), 0 0 25px rgba(69,233,255,.04) !important;
}
.core-stage::after {
  left: 2% !important;
  right: 2% !important;
  height: 2px !important;
  background: linear-gradient(90deg, transparent, rgba(255,23,79,.35), var(--scanner-red), #fff, var(--scanner-red), rgba(255,23,79,.35), transparent) !important;
  box-shadow: 0 0 14px rgba(255,23,79,.75), 0 0 29px rgba(255,23,79,.31) !important;
  animation: scannerPulse 1.15s ease-in-out infinite !important;
}
.orbit.one { border-color: rgba(69,233,255,.32) !important; }
.orbit.two { border-color: rgba(255,49,93,.28) !important; }
.orbit.three { border-color: rgba(46,146,255,.55) !important; }
.orbit::after { background: var(--scanner-red) !important; box-shadow: 0 0 16px var(--scanner-red) !important; }
.seed-core {
  border-color: rgba(69,233,255,.88) !important;
  background:
    radial-gradient(circle at 50% 50%, #fff 0 3%, var(--scanner-red) 4% 9%, rgba(255,23,79,.45) 10% 17%, transparent 28%),
    linear-gradient(135deg, rgba(46,146,255,.22), rgba(3,10,19,.98) 62%) !important;
  box-shadow: 0 0 30px rgba(255,23,79,.22), 0 0 42px rgba(69,233,255,.16), inset 0 0 25px rgba(69,233,255,.10) !important;
}
.core-caption { border-radius: 1px !important; border-left-color: var(--scanner-red) !important; background: rgba(2,8,16,.96) !important; }
.core-caption strong { color: var(--cyan) !important; }

.chapter { border-top-color: rgba(69,233,255,.26) !important; }
.chapter-head { position: relative; }
.chapter-head::after {
  position: absolute;
  right: 0;
  bottom: 12px;
  width: 130px;
  height: 4px;
  content: "";
  background: repeating-linear-gradient(90deg, rgba(255,23,79,.9) 0 12px, transparent 13px 18px);
  box-shadow: 0 0 10px rgba(255,23,79,.35);
}
.chapter-index, .card-label { color: var(--cyan) !important; text-shadow: 0 0 10px rgba(69,233,255,.14); }
h2 { color: #f3fbff !important; }

.card {
  border-radius: 1px !important;
  border-color: rgba(69,233,255,.25) !important;
  border-left: 2px solid var(--cyan) !important;
  background:
    linear-gradient(135deg, rgba(46,146,255,.055), transparent 34%),
    linear-gradient(180deg, rgba(7,20,36,.98), rgba(2,8,16,.98)) !important;
  box-shadow: 0 13px 34px rgba(0,0,0,.30), inset 0 0 28px rgba(46,146,255,.022) !important;
  clip-path: polygon(10px 0, calc(100% - 10px) 0, 100% 10px, 100% calc(100% - 10px), calc(100% - 10px) 100%, 10px 100%, 0 calc(100% - 10px), 0 10px);
}
.card::before {
  position: absolute;
  left: 12px;
  top: 0;
  width: 52px;
  height: 2px;
  content: "";
  background: linear-gradient(90deg, var(--scanner-red), var(--scanner-magenta), transparent);
  box-shadow: 0 0 9px rgba(255,23,79,.7);
}
.card::after { height: 2px !important; background: var(--cyan) !important; box-shadow: 0 0 11px rgba(69,233,255,.65) !important; }
.card:hover { border-color: rgba(69,233,255,.52) !important; box-shadow: 0 16px 38px rgba(0,0,0,.36), 0 0 22px rgba(69,233,255,.06) !important; }
.card-number { color: rgba(255,49,93,.72) !important; }
.card-value { color: #effbff !important; }
.card-copy { color: #8faabc !important; }
.micro-stat, .continuity-row strong, .commerce-row, .mutation-row, .mutation-empty, #learning-fields {
  border-radius: 1px !important;
  background: rgba(2,8,16,.72) !important;
  border-color: rgba(69,233,255,.19) !important;
}
.micro-stat::before { content: "▮"; color: var(--scanner-red); margin-right: 5px; font-size: .54rem; }
.status-value.operating .status-light { background: var(--cyan) !important; box-shadow: 0 0 19px rgba(69,233,255,.72), 0 0 0 5px rgba(69,233,255,.07) !important; }
.allocation { height: 10px !important; background: #020711; border: 1px solid rgba(69,233,255,.13); padding: 1px; }
.allocation .family { background: repeating-linear-gradient(90deg, var(--cyan) 0 20px, #167b97 21px 24px) !important; }
.allocation .compound { background: repeating-linear-gradient(90deg, var(--scanner-red) 0 16px, #7c1234 17px 20px) !important; }
.seal { border-radius: 1px !important; border-color: rgba(255,49,93,.42) !important; color: #ffc6d5 !important; box-shadow: 0 0 17px rgba(255,23,79,.08); }
.stage { border-radius: 1px !important; border-color: rgba(255,49,93,.35) !important; color: #ff9db8 !important; }

.directive-card {
  border-top: 1px solid rgba(255,49,93,.35) !important;
  background: linear-gradient(120deg, rgba(7,25,43,.98), rgba(3,12,23,.99) 48%, rgba(14,6,21,.97)) !important;
}
.directive-form input, .directive-form textarea, #learning-contract {
  border-radius: 1px !important;
  border-color: rgba(69,233,255,.34) !important;
  background: linear-gradient(180deg, #020711, #030b14) !important;
  box-shadow: inset 0 0 19px rgba(46,146,255,.035) !important;
}
#learning-status, #learning-review { border-left-color: var(--scanner-red) !important; background: rgba(7,12,24,.82) !important; }
.emergency { border-top-color: rgba(255,49,93,.58) !important; border-left-color: var(--scanner-red) !important; background: linear-gradient(110deg, rgba(64,7,26,.72), rgba(3,11,21,.98) 62%) !important; }

.future-strip {
  border-top: 1px solid rgba(69,233,255,.13);
  border-bottom: 1px solid rgba(69,233,255,.13);
  background: linear-gradient(90deg, transparent, rgba(255,23,79,.025), transparent);
}
.future-strip i { background: linear-gradient(90deg, transparent, var(--scanner-red), var(--cyan), transparent) !important; }
footer { border-top-color: rgba(255,49,93,.26) !important; }
footer strong { color: var(--cyan) !important; }

dialog {
  border-radius: 1px !important;
  border-color: rgba(69,233,255,.58) !important;
  border-left-color: var(--scanner-red) !important;
  background: linear-gradient(145deg, #06101e, #020710 72%) !important;
  box-shadow: 0 35px 115px rgba(0,0,0,.82), 0 0 34px rgba(255,23,79,.10), 0 0 26px rgba(69,233,255,.08) !important;
  clip-path: polygon(12px 0, 100% 0, 100% calc(100% - 12px), calc(100% - 12px) 100%, 0 100%, 0 12px);
}
dialog h2 { color: #f3fcff !important; }
dialog input { border-radius: 1px !important; border-color: rgba(69,233,255,.45) !important; background: #01060d !important; }

@keyframes kittSweep {
  0% { transform: translateX(-8%); filter: brightness(.85); }
  50% { filter: brightness(1.55); }
  100% { transform: translateX(490%); filter: brightness(.95); }
}
@keyframes scannerPulse {
  0%, 100% { opacity: .72; transform: scaleX(.88); }
  50% { opacity: 1; transform: scaleX(1); }
}

@media (max-width: 720px) {
  .shell { width: min(100% - 14px, 1280px) !important; }
  .topbar { min-height: 68px !important; padding: 0 8px !important; }
  .brand-mark { width: 42px !important; height: 42px !important; }
  .brand-name { font-size: .92rem !important; }
  .scan-rail { height: 13px !important; }
  .hero { margin-top: 10px !important; padding: 42px 17px 35px !important; }
  .hero::after { right: 12px; bottom: 10px; width: 64px; }
  h1 { font-size: clamp(3.05rem, 16.5vw, 5.5rem) !important; }
  .truth-row { gap: 7px !important; }
  .truth-chip { min-height: 34px !important; }
  .card { border-left-width: 2px !important; }
  .chapter-head::after { width: 82px; }
}

@media (prefers-reduced-motion: reduce) {
  .scan-rail span, .brand-mark::after, .core-stage::after { animation: none !important; }
}
`;

export function applyOwnerDashboardTheme(html: string): string {
  if (!html.includes("<title>SARA // Owner Command Center</title>")) return html;
  if (html.includes(KNIGHT_RIDER_THEME_MARKER)) return html;
  const style = `<style ${KNIGHT_RIDER_THEME_MARKER}>${KNIGHT_RIDER_THEME_CSS}</style>`;
  return html.includes("</head>") ? html.replace("</head>", `${style}</head>`) : html;
}

let installed = false;

/**
 * Production-only response skinning. The dashboard's original markup, JS, IDs and
 * protected-action semantics stay intact; only the HTML presentation receives an
 * additional inline style block.
 */
export function installOwnerDashboardTheme(): void {
  if (installed) return;
  installed = true;

  type RawEnd = (...args: unknown[]) => unknown;
  const responsePrototype = ServerResponse.prototype as unknown as { end: RawEnd };
  const originalEnd = responsePrototype.end;

  responsePrototype.end = function (this: ServerResponse, ...args: unknown[]): unknown {
    if (args.length > 0 && typeof args[0] === "string") {
      const contentType = String(this.getHeader("content-type") ?? "");
      if (contentType.includes("text/html")) {
        const themed = applyOwnerDashboardTheme(args[0]);
        if (themed !== args[0]) {
          args[0] = themed;
          this.removeHeader("content-length");
        }
      }
    }
    return originalEnd.apply(this, args);
  };
}
