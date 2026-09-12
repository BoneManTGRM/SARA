export const DASHBOARD_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="dark">
  <meta name="theme-color" content="#050a12">
  <title>SARA // Owner Command Center</title>
  <style>
    :root {
      color-scheme: dark;
      --void: #02050a;
      --ink: #050a12;
      --ink-raised: #08111d;
      --panel: rgba(9, 21, 36, .90);
      --panel-strong: #0b1726;
      --panel-hot: #102239;
      --line: rgba(86, 221, 255, .20);
      --line-bright: rgba(86, 221, 255, .52);
      --line-hard: rgba(86, 221, 255, .78);
      --text: #eefaff;
      --muted: #8ba7ba;
      --cyan: #62e6ff;
      --cyan-soft: #b9f5ff;
      --teal: #32e6d0;
      --blue: #268dff;
      --amber: #ffc66e;
      --coral: #ff6f72;
      --shadow: rgba(0, 0, 0, .72);
      --sans: "Avenir Next", Avenir, "Segoe UI", ui-sans-serif, system-ui, sans-serif;
      --mono: "SFMono-Regular", "SF Mono", Consolas, "Liberation Mono", monospace;
    }

    * { box-sizing: border-box; }
    html { scroll-behavior: smooth; background: var(--void); }
    body {
      margin: 0;
      min-width: 320px;
      min-height: 100vh;
      overflow-x: hidden;
      background:
        radial-gradient(circle at 16% -5%, rgba(38, 141, 255, .18), transparent 33rem),
        radial-gradient(circle at 92% 24%, rgba(50, 230, 208, .09), transparent 28rem),
        linear-gradient(180deg, #03070d 0%, #050a12 38%, #02060b 100%);
      color: var(--text);
      font-family: var(--sans);
      -webkit-font-smoothing: antialiased;
    }

    body::before {
      position: fixed;
      inset: 0;
      z-index: -2;
      pointer-events: none;
      content: "";
      opacity: .34;
      background-image:
        linear-gradient(rgba(98,230,255,.026) 1px, transparent 1px),
        linear-gradient(90deg, rgba(98,230,255,.022) 1px, transparent 1px);
      background-size: 42px 42px;
      mask-image: linear-gradient(to bottom, black 0%, rgba(0,0,0,.7) 58%, transparent 100%);
    }

    body::after {
      position: fixed;
      inset: 0;
      z-index: 20;
      pointer-events: none;
      content: "";
      opacity: .13;
      background: repeating-linear-gradient(to bottom, transparent 0 3px, rgba(130,235,255,.10) 4px);
      mix-blend-mode: screen;
    }

    button, input, textarea { font: inherit; }
    button { color: inherit; }
    button:focus-visible, input:focus-visible, textarea:focus-visible {
      outline: 2px solid var(--cyan);
      outline-offset: 3px;
    }

    ::selection { color: #031017; background: var(--cyan); }

    .shell {
      width: min(1240px, calc(100% - 36px));
      margin: 0 auto;
    }

    .topbar {
      position: sticky;
      top: 0;
      z-index: 10;
      display: flex;
      align-items: center;
      justify-content: space-between;
      min-height: 74px;
      border-bottom: 1px solid var(--line-bright);
      background: rgba(3, 8, 14, .88);
      backdrop-filter: blur(18px);
    }

    .topbar::after {
      position: absolute;
      right: 0;
      bottom: -1px;
      width: 24%;
      height: 1px;
      content: "";
      background: linear-gradient(90deg, transparent, var(--cyan), var(--teal));
      box-shadow: 0 0 12px rgba(98,230,255,.7);
    }

    .brand {
      display: inline-flex;
      align-items: center;
      gap: 12px;
      color: var(--text);
      text-decoration: none;
    }

    .brand-mark {
      position: relative;
      width: 33px;
      height: 33px;
      border: 1px solid var(--line-hard);
      border-radius: 5px;
      background:
        linear-gradient(135deg, transparent 44%, rgba(98,230,255,.24) 45% 55%, transparent 56%),
        #071522;
      box-shadow: 0 0 18px rgba(98,230,255,.18), inset 0 0 12px rgba(98,230,255,.08);
      overflow: hidden;
    }

    .brand-mark::before {
      position: absolute;
      inset: 6px;
      border: 1px solid rgba(98,230,255,.38);
      content: "";
    }

    .brand-mark::after {
      position: absolute;
      top: 0;
      bottom: 0;
      width: 7px;
      content: "";
      background: linear-gradient(90deg, transparent, var(--cyan), transparent);
      filter: blur(.2px);
      animation: chipScan 2.4s ease-in-out infinite alternate;
    }

    .brand-name {
      color: var(--cyan-soft);
      font: 800 .86rem var(--mono);
      letter-spacing: .22em;
      text-shadow: 0 0 13px rgba(98,230,255,.25);
    }

    .brand-world { color: #718fa5; font: .68rem var(--mono); letter-spacing: .08em; }
    .top-actions { display: flex; align-items: center; gap: 10px; }

    .domain-pill {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      color: #7898ad;
      font: .63rem var(--mono);
      letter-spacing: .05em;
      text-transform: uppercase;
    }

    .domain-pill::before {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      content: "";
      background: var(--teal);
      box-shadow: 0 0 13px var(--teal);
    }

    .scan-rail {
      position: relative;
      z-index: 4;
      height: 8px;
      margin-top: 12px;
      overflow: hidden;
      border: 1px solid rgba(98,230,255,.22);
      border-radius: 2px;
      background: #020812;
      box-shadow: inset 0 0 16px rgba(38,141,255,.08);
    }

    .scan-rail::before {
      position: absolute;
      inset: 2px;
      content: "";
      opacity: .32;
      background: repeating-linear-gradient(90deg, transparent 0 18px, rgba(98,230,255,.3) 19px, transparent 20px 28px);
    }

    .scan-rail span {
      position: absolute;
      top: 1px;
      bottom: 1px;
      width: 22%;
      border-radius: 2px;
      background: linear-gradient(90deg, transparent, rgba(38,141,255,.55), var(--cyan), #f1feff, var(--cyan), rgba(50,230,208,.58), transparent);
      box-shadow: 0 0 18px rgba(98,230,255,.75), 0 0 30px rgba(38,141,255,.35);
      animation: railSweep 2.65s ease-in-out infinite alternate;
    }

    .button {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      min-height: 40px;
      padding: 0 15px;
      border: 1px solid var(--line-bright);
      border-radius: 5px;
      background: linear-gradient(180deg, rgba(12,31,51,.92), rgba(6,17,29,.92));
      color: #ccefff;
      font: 720 .74rem var(--mono);
      letter-spacing: .025em;
      cursor: pointer;
      box-shadow: inset 0 1px rgba(255,255,255,.025);
      transition: border-color .18s ease, background .18s ease, box-shadow .18s ease, transform .18s ease;
    }

    .button:hover {
      transform: translateY(-1px);
      border-color: var(--cyan);
      background: linear-gradient(180deg, rgba(18,48,75,.96), rgba(7,25,41,.96));
      box-shadow: 0 0 16px rgba(98,230,255,.15), inset 0 0 15px rgba(98,230,255,.06);
    }

    .button.primary {
      border-color: rgba(98,230,255,.76);
      background: linear-gradient(135deg, #113e5b, #0b5960 52%, #0e344e);
      color: #eaffff;
      box-shadow: 0 0 17px rgba(50,230,208,.12), inset 0 0 18px rgba(98,230,255,.08);
    }

    .button.primary:hover { border-color: #c9f9ff; box-shadow: 0 0 22px rgba(98,230,255,.25); }
    .button.danger { border-color: rgba(255,111,114,.55); color: #ffd4d5; background: rgba(73,18,28,.58); }
    .button.danger:hover { border-color: var(--coral); background: rgba(100,22,33,.72); box-shadow: 0 0 18px rgba(255,111,114,.17); }
    .button:disabled { opacity: .34; cursor: not-allowed; transform: none; box-shadow: none; }

    .hero {
      display: grid;
      grid-template-columns: minmax(0, 1.1fr) minmax(340px, .9fr);
      gap: clamp(30px, 7vw, 90px);
      align-items: center;
      min-height: 590px;
      padding: 62px 0 64px;
    }

    .hero > div:first-child {
      position: relative;
      padding-left: 20px;
    }

    .hero > div:first-child::before {
      position: absolute;
      top: 2px;
      bottom: 2px;
      left: 0;
      width: 2px;
      content: "";
      background: linear-gradient(to bottom, var(--cyan), rgba(38,141,255,.2), transparent);
      box-shadow: 0 0 14px rgba(98,230,255,.45);
    }

    .eyebrow {
      display: flex;
      align-items: center;
      gap: 10px;
      margin: 0 0 20px;
      color: var(--cyan);
      font: 760 .66rem var(--mono);
      letter-spacing: .15em;
      text-transform: uppercase;
    }

    .eyebrow::before { width: 28px; height: 1px; content: ""; background: var(--cyan); box-shadow: 0 0 8px var(--cyan); }

    h1 {
      max-width: 790px;
      margin: 0;
      font-family: var(--mono);
      font-size: clamp(3.4rem, 7.7vw, 7rem);
      font-weight: 600;
      letter-spacing: -.065em;
      line-height: .88;
      text-transform: uppercase;
      text-shadow: 0 0 34px rgba(38,141,255,.10);
    }

    h1 em { color: var(--cyan); font-style: normal; font-weight: 500; text-shadow: 0 0 24px rgba(98,230,255,.24); }

    .hero-copy {
      max-width: 650px;
      margin: 27px 0 0;
      color: #9bb5c6;
      font-size: clamp(.94rem, 1.4vw, 1.08rem);
      line-height: 1.72;
    }

    .hero-copy strong { color: #dff8ff; font-weight: 650; }

    .truth-row { display: flex; flex-wrap: wrap; gap: 8px; margin: 27px 0 0; }
    .truth-chip {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      min-height: 31px;
      padding: 0 10px;
      border: 1px solid rgba(98,230,255,.19);
      border-radius: 4px;
      color: #99bed0;
      background: rgba(7,18,31,.72);
      font: .62rem var(--mono);
      letter-spacing: .03em;
      text-transform: uppercase;
    }
    .truth-chip::before { width: 5px; height: 5px; content: ""; background: var(--teal); box-shadow: 0 0 8px var(--teal); }

    .core-stage {
      position: relative;
      display: grid;
      place-items: center;
      width: min(100%, 480px);
      aspect-ratio: 1;
      justify-self: end;
      isolation: isolate;
      border: 1px solid rgba(98,230,255,.09);
      background:
        linear-gradient(rgba(98,230,255,.025) 1px, transparent 1px),
        linear-gradient(90deg, rgba(98,230,255,.025) 1px, transparent 1px);
      background-size: 24px 24px;
      clip-path: polygon(0 24px, 24px 0, 100% 0, 100% calc(100% - 24px), calc(100% - 24px) 100%, 0 100%);
    }

    .core-stage::before {
      position: absolute;
      inset: 8%;
      z-index: -2;
      border: 1px solid rgba(98,230,255,.09);
      border-radius: 50%;
      content: "";
      background: radial-gradient(circle, rgba(38,141,255,.12), transparent 66%);
      filter: blur(3px);
      animation: breathe 4.2s ease-in-out infinite;
    }

    .core-stage::after {
      position: absolute;
      left: 8%;
      right: 8%;
      top: 50%;
      height: 1px;
      content: "";
      background: linear-gradient(90deg, transparent, rgba(98,230,255,.5), transparent);
      box-shadow: 0 0 12px rgba(98,230,255,.25);
    }

    .orbit { position: absolute; border: 1px solid rgba(98,230,255,.20); border-radius: 50%; }
    .orbit.one { inset: 10%; animation: orbit 31s linear infinite; }
    .orbit.two { inset: 23%; border-style: dashed; border-color: rgba(50,230,208,.24); animation: orbit 21s linear infinite reverse; }
    .orbit.three { inset: 34%; border-color: rgba(38,141,255,.36); animation: orbit 14s linear infinite; }
    .orbit::after { position: absolute; top: 50%; left: -4px; width: 7px; height: 7px; border-radius: 50%; content: ""; background: var(--cyan); box-shadow: 0 0 15px var(--cyan); }
    .orbit.two::after { top: 10%; left: 77%; width: 5px; height: 5px; background: var(--teal); box-shadow: 0 0 14px var(--teal); }
    .orbit.three::after { top: auto; bottom: 6%; left: 64%; background: var(--blue); box-shadow: 0 0 14px var(--blue); }

    .seed-core {
      position: relative;
      display: grid;
      place-items: center;
      width: 31%;
      aspect-ratio: 1;
      border: 1px solid rgba(98,230,255,.72);
      border-radius: 10px;
      transform: rotate(45deg);
      background:
        radial-gradient(circle at 40% 35%, rgba(221,252,255,.9) 0 2%, rgba(98,230,255,.72) 3% 7%, transparent 18%),
        linear-gradient(135deg, rgba(38,141,255,.22), rgba(4,19,31,.96) 60%);
      box-shadow: 0 0 35px rgba(98,230,255,.28), inset 0 0 25px rgba(98,230,255,.10);
      animation: corePulse 4.5s ease-in-out infinite;
    }

    .seed-core::before, .seed-core::after { position: absolute; content: ""; border: 1px solid rgba(98,230,255,.22); inset: 13%; }
    .seed-core::after { inset: 29%; border-color: rgba(50,230,208,.30); }
    .core-label { position: absolute; z-index: 2; transform: rotate(-45deg); color: #eaffff; font: 750 .64rem var(--mono); letter-spacing: .15em; text-shadow: 0 0 10px var(--cyan); }

    .core-caption {
      position: absolute;
      right: 4%;
      bottom: 5%;
      width: 176px;
      padding: 11px 12px;
      border: 1px solid rgba(98,230,255,.25);
      border-left: 3px solid var(--cyan);
      border-radius: 4px;
      background: rgba(4,13,23,.90);
      box-shadow: 0 8px 22px rgba(0,0,0,.35);
    }
    .core-caption span { display: block; color: #6e91a8; font: .57rem var(--mono); letter-spacing: .12em; text-transform: uppercase; }
    .core-caption strong { display: block; margin-top: 6px; color: var(--cyan-soft); font: .68rem var(--mono); }

    .chapter { padding: 10px 0 34px; border-top: 1px solid rgba(98,230,255,.20); }
    .chapter-head { display: flex; align-items: end; justify-content: space-between; gap: 30px; padding: 45px 0 25px; }
    .chapter-index { color: var(--cyan); font: .62rem var(--mono); letter-spacing: .11em; }
    h2 { margin: 8px 0 0; font-family: var(--mono); font-size: clamp(2rem, 3.6vw, 3.8rem); font-weight: 520; letter-spacing: -.055em; line-height: .98; text-transform: uppercase; }
    .chapter-note { max-width: 390px; margin: 0; color: #7f9bad; font-size: .78rem; line-height: 1.65; }

    .connection-state { display: inline-flex; align-items: center; gap: 8px; margin-top: 13px; color: #738da0; font: .62rem var(--mono); letter-spacing: .09em; text-transform: uppercase; }
    .connection-state::before { width: 7px; height: 7px; border-radius: 50%; content: ""; background: #536674; }
    body[data-owner="connected"] .connection-state { color: var(--teal); }
    body[data-owner="connected"] .connection-state::before { background: var(--teal); box-shadow: 0 0 12px var(--teal); }

    .bento { display: grid; grid-template-columns: repeat(12, minmax(0, 1fr)); gap: 13px; }
    .card {
      position: relative;
      grid-column: span 4;
      min-height: 220px;
      overflow: hidden;
      border: 1px solid var(--line);
      border-left: 3px solid rgba(98,230,255,.62);
      border-radius: 8px;
      background:
        linear-gradient(135deg, rgba(38,141,255,.035), transparent 35%),
        linear-gradient(180deg, rgba(12,29,48,.92), rgba(5,14,25,.94));
      box-shadow: 0 12px 30px rgba(0,0,0,.18), inset 0 1px rgba(255,255,255,.016);
      transition: border-color .2s ease, transform .2s ease, box-shadow .2s ease, background .2s ease;
    }
    .card::after { position: absolute; top: 0; right: 0; width: 62px; height: 1px; content: ""; background: var(--cyan); box-shadow: 0 0 10px rgba(98,230,255,.5); opacity: .55; }
    .card:hover { transform: translateY(-1px); border-color: rgba(98,230,255,.38); border-left-color: var(--cyan); background: linear-gradient(180deg, rgba(15,36,58,.96), rgba(6,18,30,.96)); box-shadow: 0 14px 32px rgba(0,0,0,.28), 0 0 20px rgba(98,230,255,.04); }
    .card.span-5 { grid-column: span 5; }
    .card.span-7 { grid-column: span 7; }
    .card.span-8 { grid-column: span 8; }
    .card.span-12 { grid-column: 1 / -1; }
    .card.tall { min-height: 338px; }
    .card-pad { position: relative; z-index: 2; padding: 23px; }
    .card-number { position: absolute; right: 16px; top: 14px; color: rgba(98,230,255,.34); font: .57rem var(--mono); letter-spacing: .08em; }
    .card-label { color: #6edbf2; font: 730 .63rem var(--mono); letter-spacing: .13em; text-transform: uppercase; }
    .card-value { margin-top: 15px; font: 520 clamp(2.05rem, 4vw, 3.7rem) var(--mono); letter-spacing: -.065em; line-height: .95; overflow-wrap: anywhere; }
    .card-value.small { font-size: clamp(1.42rem, 2.4vw, 2.35rem); }
    .card-copy { max-width: 510px; margin: 16px 0 0; color: #819daf; font-size: .76rem; line-height: 1.65; }
    .card-copy strong { color: #d9f6ff; }
    .mono { font-family: var(--mono); }

    .status-value { display: flex; align-items: center; gap: 13px; }
    .status-light { width: 10px; height: 10px; flex: 0 0 auto; border-radius: 50%; background: #516673; box-shadow: 0 0 0 5px rgba(81,102,115,.08); }
    .status-value.operating .status-light { background: var(--teal); box-shadow: 0 0 18px rgba(50,230,208,.62), 0 0 0 5px rgba(50,230,208,.08); }
    .status-value.stopped .status-light { background: var(--coral); box-shadow: 0 0 18px rgba(255,111,114,.5), 0 0 0 5px rgba(255,111,114,.08); }

    .micro-stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-top: 25px; }
    .micro-stat { min-width: 0; padding: 11px; border: 1px solid rgba(98,230,255,.13); border-radius: 5px; background: rgba(2,9,17,.46); }
    .micro-stat span { display: block; color: #67869a; font: .54rem var(--mono); letter-spacing: .08em; text-transform: uppercase; }
    .micro-stat strong { display: block; margin-top: 7px; color: #d8f7ff; font: .75rem var(--mono); overflow-wrap: anywhere; }

    .economic-orbit { position: absolute; right: -80px; bottom: -112px; width: 270px; height: 270px; border: 1px solid rgba(98,230,255,.10); border-radius: 50%; }
    .economic-orbit::before, .economic-orbit::after { position: absolute; border: 1px solid rgba(98,230,255,.08); border-radius: 50%; content: ""; }
    .economic-orbit::before { inset: 35px; }
    .economic-orbit::after { inset: 78px; background: rgba(38,141,255,.03); }

    .allocation { display: grid; grid-template-columns: 3fr 1fr; gap: 4px; height: 7px; margin-top: 27px; }
    .allocation span { border-radius: 2px; }
    .allocation .family { background: linear-gradient(90deg, var(--cyan), var(--teal)); box-shadow: 0 0 8px rgba(98,230,255,.2); }
    .allocation .compound { background: linear-gradient(90deg, var(--amber), #bc7633); }
    .allocation-legend { display: flex; justify-content: space-between; gap: 16px; margin-top: 9px; color: #728fa1; font: .59rem var(--mono); }

    .continuity-flow { display: grid; gap: 8px; margin-top: 21px; }
    .continuity-row { display: grid; grid-template-columns: 88px 1fr; gap: 11px; align-items: center; }
    .continuity-row span { color: #658499; font: .56rem var(--mono); letter-spacing: .08em; text-transform: uppercase; }
    .continuity-row strong { padding: 9px 10px; border: 1px solid rgba(98,230,255,.12); border-radius: 4px; background: rgba(2,9,17,.46); color: #c9e8f4; font-size: .68rem; font-weight: 620; }

    .seal { position: absolute; right: 21px; bottom: 18px; display: grid; place-items: center; width: 91px; height: 91px; border: 1px solid rgba(98,230,255,.25); border-radius: 6px; color: rgba(185,245,255,.67); font: .53rem var(--mono); letter-spacing: .11em; text-align: center; text-transform: uppercase; transform: rotate(45deg); }
    .seal::before { position: absolute; inset: 8px; border: 1px dashed rgba(50,230,208,.24); content: ""; }
    .seal br { display: none; }
    .digest { max-width: calc(100% - 118px); margin-top: 17px; color: #66879c; font: .59rem/1.55 var(--mono); overflow-wrap: anywhere; }

    .mutation-list { display: grid; gap: 8px; max-height: 218px; margin-top: 19px; overflow: auto; scrollbar-color: #17627b transparent; }
    .mutation-empty { display: grid; place-items: center; min-height: 112px; padding: 12px; border: 1px dashed rgba(98,230,255,.18); border-radius: 5px; color: #648498; background: rgba(2,8,15,.25); font: .65rem/1.5 var(--mono); text-align: center; }
    .mutation-row { display: grid; grid-template-columns: 1fr auto; gap: 14px; align-items: center; padding: 11px 12px; border: 1px solid rgba(98,230,255,.12); border-radius: 4px; background: rgba(2,9,17,.42); }
    .mutation-title { min-width: 0; overflow: hidden; color: #cdebf6; font: .64rem var(--mono); text-overflow: ellipsis; white-space: nowrap; }
    .stage { padding: 4px 7px; border: 1px solid rgba(50,230,208,.28); border-radius: 3px; color: var(--teal); font: .53rem var(--mono); }

    .memory-cells { position: absolute; inset: auto -13px -16px auto; width: 180px; height: 150px; opacity: .28; }
    .memory-cells span { position: absolute; width: 38px; height: 38px; border: 1px solid rgba(98,230,255,.34); transform: rotate(45deg); }
    .memory-cells span:nth-child(1) { left: 7px; top: 52px; }
    .memory-cells span:nth-child(2) { left: 55px; top: 17px; transform: rotate(45deg) scale(.72); }
    .memory-cells span:nth-child(3) { left: 101px; top: 66px; transform: rotate(45deg) scale(1.15); }
    .memory-cells span:nth-child(4) { left: 39px; top: 99px; transform: rotate(45deg) scale(.55); }
    .locked-note { display: flex; align-items: center; gap: 9px; margin-top: 18px; color: #68879a; font-size: .67rem; }
    .locked-note::before { width: 12px; height: 12px; border: 1px solid #5b7e92; content: ""; transform: rotate(45deg); }

    .commerce-list { display: grid; gap: 10px; margin-top: 20px; }
    .commerce-row { display: grid; gap: 8px; padding: 13px; border: 1px solid rgba(98,230,255,.14); border-left: 2px solid rgba(50,230,208,.42); border-radius: 5px; background: rgba(2,10,18,.46); }
    .commerce-row strong { color: #d9f4ff; overflow-wrap: anywhere; }
    .commerce-row small { color: #7491a3; font: .61rem/1.5 var(--mono); overflow-wrap: anywhere; }
    .commerce-actions { display: flex; flex-wrap: wrap; gap: 8px; }
    .commerce-link { color: var(--cyan-soft); overflow-wrap: anywhere; }

    .directive-card { min-height: 310px; border-left-color: var(--cyan); background: linear-gradient(120deg, rgba(9,38,61,.88), rgba(6,22,38,.92) 45%, rgba(5,15,27,.96)); }
    .directive-card:hover { background: linear-gradient(120deg, rgba(11,45,70,.94), rgba(7,25,42,.96) 45%, rgba(5,16,28,.98)); }
    .directive-layout { display: grid; grid-template-columns: minmax(220px, .72fr) minmax(0, 1.28fr); gap: 28px; }
    .directive-form { display: grid; grid-template-columns: 1fr 1fr; gap: 13px; }
    .directive-form fieldset { display: contents; }
    .directive-form label, #learning-fields label { display: grid; gap: 7px; color: #94bed1; font: 710 .61rem var(--mono); letter-spacing: .08em; text-transform: uppercase; }
    .directive-form label.wide { grid-column: 1 / -1; }
    .directive-form input, .directive-form textarea, #learning-contract {
      width: 100%;
      border: 1px solid rgba(98,230,255,.28);
      border-radius: 4px;
      background: #030a12;
      color: #e5f9ff;
      font: .75rem/1.45 var(--mono);
      text-transform: none;
      letter-spacing: 0;
      box-shadow: inset 0 0 17px rgba(38,141,255,.04);
    }
    .directive-form input { min-height: 44px; padding: 0 12px; }
    .directive-form textarea, #learning-contract { min-height: 86px; padding: 11px 12px; resize: vertical; }
    .directive-form input:disabled, .directive-form textarea:disabled, #learning-fields:disabled textarea { opacity: .42; cursor: not-allowed; }
    .directive-actions { grid-column: 1 / -1; display: flex; align-items: center; justify-content: space-between; gap: 14px; }
    .directive-hint { max-width: 440px; color: #66859a; font: .60rem/1.55 var(--mono); }

    #learning-fields { display: grid; grid-template-columns: 1fr; gap: 11px; margin: 19px 0 0; padding: 17px; border: 1px solid rgba(98,230,255,.16); border-radius: 5px; background: rgba(2,10,18,.42); }
    #learning-status, #learning-review { margin: 0; padding: 10px 11px; border-left: 2px solid rgba(50,230,208,.48); background: rgba(3,15,25,.56); color: #9ac1d3; font: .64rem/1.55 var(--mono); }
    #learning-review:empty { display: none; }
    #learning-fields .button { justify-self: start; min-width: 220px; }

    .emergency { display: grid; grid-template-columns: 1fr auto; gap: 28px; align-items: center; min-height: 176px; border-color: rgba(255,111,114,.22); border-left-color: var(--coral); background: linear-gradient(110deg, rgba(54,15,27,.60), rgba(7,18,31,.95) 64%); }
    .emergency:hover { border-color: rgba(255,111,114,.38); border-left-color: var(--coral); background: linear-gradient(110deg, rgba(66,17,31,.68), rgba(7,20,34,.97) 64%); }
    .emergency .card-copy { max-width: 720px; }
    .emergency > .button { margin-right: 23px; }
    .system-message { min-height: 20px; margin: 14px 0 0; color: var(--amber); font: .62rem var(--mono); }

    .future-strip { display: grid; grid-template-columns: repeat(7, auto); align-items: center; justify-content: space-between; gap: 14px; padding: 32px 0 42px; color: #557388; font: .57rem var(--mono); letter-spacing: .10em; text-transform: uppercase; }
    .future-strip i { width: 28px; height: 1px; background: linear-gradient(90deg, transparent, rgba(98,230,255,.55), transparent); }
    footer { display: flex; justify-content: space-between; gap: 28px; padding: 27px 0 48px; border-top: 1px solid rgba(98,230,255,.17); color: #58768a; font: .63rem/1.55 var(--mono); }
    footer strong { color: #91b6c9; font-weight: 650; }

    dialog {
      width: min(470px, calc(100% - 28px));
      padding: 0;
      border: 1px solid rgba(98,230,255,.44);
      border-left: 3px solid var(--cyan);
      border-radius: 7px;
      background: #071321;
      color: var(--text);
      box-shadow: 0 35px 110px rgba(0,0,0,.72), 0 0 28px rgba(98,230,255,.08);
    }
    dialog::backdrop { background: rgba(0,4,9,.84); backdrop-filter: blur(10px); }
    .dialog-inner { padding: 27px; }
    .dialog-kicker { color: var(--cyan); font: .61rem var(--mono); letter-spacing: .13em; text-transform: uppercase; }
    dialog h2 { margin: 12px 0 0; color: #effcff; font: 520 2.15rem var(--mono); letter-spacing: -.05em; text-transform: uppercase; }
    dialog p { color: #7898aa; font-size: .75rem; line-height: 1.65; }
    dialog label { display: block; margin-top: 21px; color: #9dc7d9; font: 700 .65rem var(--mono); letter-spacing: .07em; text-transform: uppercase; }
    dialog input { width: 100%; min-height: 48px; margin-top: 8px; padding: 0 13px; border: 1px solid rgba(98,230,255,.34); border-radius: 4px; background: #020911; color: var(--text); font-family: var(--mono); }
    .dialog-error { min-height: 18px; margin: 10px 0 0; color: var(--coral); font: .63rem var(--mono); }
    .dialog-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 21px; }

    @keyframes orbit { to { transform: rotate(360deg); } }
    @keyframes breathe { 50% { opacity: .62; transform: scale(1.035); } }
    @keyframes corePulse { 0%, 100% { box-shadow: 0 0 30px rgba(98,230,255,.22), inset 0 0 20px rgba(98,230,255,.08); } 50% { box-shadow: 0 0 48px rgba(98,230,255,.38), 0 0 80px rgba(38,141,255,.12), inset 0 0 26px rgba(98,230,255,.14); } }
    @keyframes railSweep { from { left: -21%; } to { left: 99%; } }
    @keyframes chipScan { from { left: -10px; } to { left: 34px; } }

    @media (max-width: 980px) {
      .hero { grid-template-columns: 1fr .76fr; min-height: 560px; gap: 22px; }
      .core-caption { right: 2%; }
      .card, .card.span-5 { grid-column: span 6; }
      .card.span-7, .card.span-8 { grid-column: 1 / -1; }
    }

    @media (max-width: 720px) {
      .shell { width: min(100% - 20px, 1240px); }
      .topbar { min-height: 66px; }
      .brand-world, .domain-pill { display: none; }
      .scan-rail { margin-top: 8px; }
      .button { min-height: 38px; padding: 0 12px; }
      .hero { grid-template-columns: 1fr; min-height: auto; padding: 48px 0 38px; }
      .hero > div:first-child { padding-left: 14px; }
      h1 { font-size: clamp(3.05rem, 17vw, 5.7rem); }
      .hero-copy { margin-top: 22px; font-size: .91rem; }
      .core-stage { width: min(100%, 410px); justify-self: center; margin-top: 3px; }
      .chapter-head { display: block; padding-top: 39px; }
      .chapter-note { margin-top: 16px; }
      .directive-layout, .directive-form { grid-template-columns: 1fr; }
      .directive-form label.wide, .directive-actions { grid-column: 1; }
      .directive-actions { align-items: stretch; flex-direction: column; }
      .card, .card.span-5, .card.span-7, .card.span-8 { grid-column: 1 / -1; }
      .card { min-height: 198px; border-radius: 6px; }
      .card.tall { min-height: 310px; }
      .card-pad { padding: 19px; }
      #learning-fields { padding: 13px; }
      #learning-fields .button { width: 100%; min-width: 0; }
      .emergency { grid-template-columns: 1fr; gap: 13px; }
      .emergency > .button { justify-self: start; margin: 0 0 19px 19px; }
      .future-strip { grid-template-columns: 1fr; gap: 8px; justify-items: center; padding: 27px 0 34px; }
      .future-strip i { width: 1px; height: 12px; }
      footer { flex-direction: column; }
    }

    @media (max-width: 420px) {
      .brand-name { letter-spacing: .15em; }
      .top-actions .button { font-size: .66rem; }
      .truth-row { gap: 6px; }
      .truth-chip { padding: 0 8px; font-size: .58rem; }
      .micro-stats { grid-template-columns: 1fr 1fr; }
      .continuity-row { grid-template-columns: 74px 1fr; }
      .seal { width: 75px; height: 75px; }
      .digest { max-width: calc(100% - 84px); }
    }

    @media (prefers-reduced-motion: reduce) {
      *, *::before, *::after { scroll-behavior: auto !important; animation-duration: .001ms !important; animation-iteration-count: 1 !important; transition-duration: .001ms !important; }
    }
  </style>
</head>
<body data-owner="locked">
  <div class="shell">
    <nav class="topbar" aria-label="Primary navigation">
      <a class="brand" href="#top" aria-label="SARA and SEED World home">
        <span class="brand-mark" aria-hidden="true"></span>
        <span class="brand-name">SARA</span>
        <span class="brand-world">// OWNER NODE</span>
      </a>
      <div class="top-actions">
        <span class="domain-pill">saraseed.app parity</span>
        <button class="button" id="connect" type="button">Owner access</button>
      </div>
    </nav>

    <div class="scan-rail" aria-hidden="true"><span></span></div>

    <main id="top">
      <section class="hero" aria-labelledby="hero-title">
        <div>
          <p class="eyebrow">Protected intelligence // generation zero</p>
          <h1 id="hero-title">Intelligence<br><em>with roots.</em></h1>
          <p class="hero-copy"><strong>SARA is an owner-controlled digital organism</strong> built to remember, learn, create verified value, and safely develop the capabilities needed for her next objective.</p>
          <div class="truth-row" aria-label="Bootstrap guarantees">
            <span class="truth-chip">$0 bootstrap target</span>
            <span class="truth-chip">Constitution locked</span>
            <span class="truth-chip">Genome Lab isolated</span>
          </div>
        </div>

        <div class="core-stage" aria-label="Animated representation of the protected SEED core">
          <div class="orbit one" aria-hidden="true"></div>
          <div class="orbit two" aria-hidden="true"></div>
          <div class="orbit three" aria-hidden="true"></div>
          <div class="seed-core" aria-hidden="true"><span class="core-label">SEED</span></div>
          <div class="core-caption"><span>Current horizon</span><strong>Self-building kernel</strong></div>
        </div>
      </section>

      <section class="chapter" aria-labelledby="command-title">
        <div class="chapter-head">
          <div>
            <span class="chapter-index">01 // OWNER COMMAND</span>
            <h2 id="command-title">The organism,<br>made observable.</h2>
          </div>
          <div>
            <p class="chapter-note">Private operational truth appears only after owner authentication. Until then, the interface reveals no durable state, financial data, or mutation history.</p>
            <p class="connection-state" id="connection-state">Owner state locked</p>
          </div>
        </div>

        <div class="bento" aria-live="polite">
          <article class="card span-5">
            <span class="card-number">01.01</span>
            <div class="card-pad">
              <div class="card-label">Operating state</div>
              <div class="card-value status-value" id="operating"><span class="status-light"></span><span>Locked</span></div>
              <p class="card-copy" id="operating-copy">Authenticate to inspect the protected runtime.</p>
              <div class="micro-stats">
                <div class="micro-stat"><span>Owner funded</span><strong id="owner-cost">—</strong></div>
                <div class="micro-stat"><span>Jobs</span><strong id="jobs">—</strong></div>
                <div class="micro-stat"><span>Digital capabilities</span><strong id="capabilities" aria-describedby="capabilities-note">—</strong></div>
              </div>
              <p class="card-copy" id="capabilities-note">Owner authentication required.</p>
            </div>
          </article>

          <article class="card span-7">
            <span class="card-number">01.02</span>
            <div class="economic-orbit" aria-hidden="true"></div>
            <div class="card-pad">
              <div class="card-label">Economic core</div>
              <div class="card-value" id="compound-reserve">—</div>
              <p class="card-copy"><strong>SARA compound reserve.</strong> Realized-profit allocation only; no live financial account or autonomous transfer authority is connected.</p>
              <div class="allocation" aria-label="Protected family and reinvestment ranges"><span class="family"></span><span class="compound"></span></div>
              <div class="allocation-legend"><span>Family distribution · 50–75%</span><span>Compound · 25–50%</span></div>
            </div>
          </article>

          <article class="card span-7 tall">
            <span class="card-number">01.03</span>
            <div class="card-pad">
              <div class="card-label">Family continuity</div>
              <div class="card-value small">Stewardship<br>without guesswork.</div>
              <p class="card-copy">Provisional scenarios require target-bound authenticated owner attestation. Live succession remains blocked pending authoritative legal evidence—never arguments, silence, location, or inferred relationships.</p>
              <div class="continuity-flow">
                <div class="continuity-row"><span>Baseline</span><strong>Wife receives 100%</strong></div>
                <div class="continuity-row"><span>If unavailable</span><strong>Owner 50% · Son 50%</strong></div>
                <div class="continuity-row"><span>If separated</span><strong>Owner receives 100%</strong></div>
                <div class="continuity-row"><span>Sole survivor</span><strong>Receives 100%</strong></div>
              </div>
            </div>
          </article>

          <article class="card span-5 tall">
            <span class="card-number">01.04</span>
            <div class="card-pad">
              <div class="card-label">Protected Constitution</div>
              <div class="card-value small" id="constitution">Not loaded</div>
              <p class="card-copy">Owner authority, payment destinations, authentication, protected security controls, and the Constitution itself cannot be changed by SARA.</p>
              <p class="digest" id="digest">Owner authentication required for checksum.</p>
              <div class="seal" aria-hidden="true">AUTHORITY LAYER SEALED</div>
            </div>
          </article>

          <article class="card span-8 tall">
            <span class="card-number">01.05</span>
            <div class="card-pad">
              <div class="card-label">Genome Lab</div>
              <div class="card-value small">Champion // Challenger</div>
              <p class="card-copy">Candidate code begins in isolation. Evidence, semantic compilation, artifact integrity, stage gates, and owner approval stand between a mutation and production.</p>
              <div class="mutation-list" id="mutations"><div class="mutation-empty">Owner state locked<br>Mutation history remains private</div></div>
            </div>
          </article>

          <article class="card">
            <span class="card-number">01.06</span>
            <div class="memory-cells" aria-hidden="true"><span></span><span></span><span></span><span></span></div>
            <div class="card-pad">
              <div class="card-label">Durable memory</div>
              <div class="card-value" id="memories">—</div>
              <p class="card-copy">Verified memories survive restart and model changes with provenance.</p>
              <p class="locked-note" id="memory-note">Private until authenticated</p>
            </div>
          </article>

          <article class="card">
            <span class="card-number">01.07</span>
            <div class="card-pad">
              <div class="card-label">Immutable audit</div>
              <div class="card-value" id="events">—</div>
              <p class="card-copy">Hash-chained events reveal corruption and preserve accountable ancestry.</p>
              <p class="digest" id="audit-head">Audit head protected.</p>
            </div>
          </article>

          <article class="card span-12 directive-card">
            <span class="card-number">01.08</span>
            <div class="card-pad directive-layout">
              <div>
                <div class="card-label">Paid service lane</div>
                <div class="card-value small">USDC on Base // exact owner gates</div>
                <p class="card-copy">Payment verification never starts work by itself. Fulfillment and external delivery require separate owner actions.</p>
              </div>
              <div class="commerce-list" id="commerce-list"><div class="mutation-empty">Owner state locked</div></div>
            </div>
          </article>

          <article class="card span-12 directive-card">
            <span class="card-number">01.09</span>
            <div class="card-pad directive-layout">
              <div>
                <div class="card-label">Exception-only autonomy</div>
                <div class="card-value small">Routine work // bounded authority.</div>
                <p class="card-copy">A 30-day standing mandate can cover public research, business candidates, inbound replies, scheduling, and bounded outreach for the fixed service. Connectors must still be configured, and protected actions remain owner-only.</p>
              </div>
              <div class="commerce-list" id="autonomy-list"><div class="mutation-empty">Owner state locked</div></div>
            </div>
          </article>

          <article class="card span-12 directive-card">
            <span class="card-number">01.10</span>
            <div class="card-pad directive-layout">
              <div>
                <div class="card-label">Owner directive channel</div>
                <div class="card-value small">Tell SARA what outcome you need.</div>
                <p class="card-copy">After owner authentication, a directive becomes a bounded job with explicit evidence and a hard budget. SARA may work autonomously inside that scope; protected actions still require you.</p>
                <form id="owner-work-form">
                  <fieldset id="owner-work-fields" disabled>
                    <label for="owner-work-text">Message SARA</label>
                    <textarea id="owner-work-text" maxlength="4096" required placeholder="Review unfinished work, identify blockers, prioritize obligations, complete the authorized steps, and give me a brief."></textarea>
                    <label for="owner-work-material">Supplied material (optional)</label>
                    <textarea id="owner-work-material" maxlength="12000" placeholder="Paste communications, a defect report, or quote facts. Do not include passwords or secrets."></textarea>
                    <button class="button primary" id="owner-work-submit" type="submit">Run supported work</button>
                    <button class="button" id="owner-work-refresh" type="button">Refresh work</button>
                  </fieldset>
                </form>
                <p class="card-copy" id="owner-work-status" role="status">Owner authentication required.</p>
                <div id="owner-work-results" aria-live="polite"></div>
              </div>
              <form class="directive-form" id="directive-form">
                <fieldset id="directive-fields" disabled>
                  <label class="wide">Objective
                    <textarea id="directive-objective" maxlength="1200" required placeholder="Example: Build a zero-cost tool that identifies release failures and produces reproducible evidence."></textarea>
                  </label>
                  <label>Expected owner value
                    <input id="directive-value" type="number" min="0" step="1" value="1" required>
                  </label>
                  <label>Maximum spend (USD)
                    <input id="directive-budget" type="number" min="0" step="0.01" value="0" required>
                  </label>
                  <label class="wide">Required capabilities — comma separated
                    <input id="directive-capabilities" type="text" maxlength="500" placeholder="Example: catalog-sku-duplicates">
                  </label>
                  <label class="wide">Acceptance criteria — one per line
                    <textarea id="directive-criteria" maxlength="2000" required placeholder="Produces a reviewable artifact.&#10;Passes deterministic verification.&#10;Does not alter production without approval."></textarea>
                  </label>
                  <div class="directive-actions">
                    <span class="directive-hint">$0 is the safe default. Any positive budget must already exist in realized, uncommitted Compound Reserve funds.</span>
                    <button class="button primary" type="submit">Authorize bounded job</button>
                  </div>
                </fieldset>
              </form>
            </div>
          </article>

          <article class="card span-12 directive-card">
            <span class="card-number">01.10L</span>
            <div class="card-pad">
              <div class="card-label">Bounded skill learning</div>
              <div class="card-value small">Learn // verify // retain.</div>
              <p class="card-copy">Review a private learning contract and its request allowance before approving it. SARA chooses from authorized capability gaps. Qualified candidates remain SHADOW until exact operational approval.</p>
              <fieldset id="learning-fields" disabled>
                <label for="learning-contract">Private campaign JSON</label>
                <textarea id="learning-contract" maxlength="64000" rows="5" placeholder="Paste the prepared private campaign JSON."></textarea>
                <p id="learning-status" role="status">Owner authentication required.</p>
                <p id="learning-review" role="status"></p>
                <button class="button" id="learning-preview" type="button">Review campaign</button>
                <button class="button primary" id="learning-approve" type="button" disabled>Approve exact campaign</button>
                <button class="button" id="learning-capacity-preview" type="button" disabled>Review 100-request capacity</button>
                <button class="button primary" id="learning-capacity-approve" type="button" disabled>Approve 100-request capacity</button>
                <button class="button" id="learning-mandate" type="button" disabled>Activate 30-day internal learning mandate</button>
              </fieldset>
            </div>
          </article>

          <article class="card span-12 emergency">
            <span class="card-number">01.11</span>
            <div class="card-pad">
              <div class="card-label">Constitutional emergency stop</div>
              <div class="card-value small">Owner remains above the machine.</div>
              <p class="card-copy">One authenticated action freezes new external actions, spending, children, and production promotions while preserving memory, audit, reads, and owner recovery.</p>
              <p class="system-message" id="system-message" role="status"></p>
            </div>
            <button class="button danger" id="stop" type="button" disabled>Engage stop</button>
          </article>
        </div>
      </section>

      <div class="future-strip" aria-label="SARA development path">
        <span>Worker</span><i></i><span>Company</span><i></i><span>Platform</span><i></i><span>Unknown</span>
      </div>
    </main>

    <footer>
      <span><strong>SARA // OWNER NODE</strong><br>Protected control surface for owner-authorized intelligence.</span>
      <span>Visual parity with saraseed.app<br>Security boundaries and owner gates unchanged.</span>
    </footer>
  </div>

  <dialog id="owner-dialog" aria-labelledby="dialog-title">
    <form id="owner-form">
      <div class="dialog-inner">
        <div class="dialog-kicker">Protected boundary // owner node</div>
        <h2 id="dialog-title">Enter owner space.</h2>
        <p>The token remains in this browser tab. It is sent only to this SARA backend and is never written to the event store.</p>
        <label for="token">Owner token</label>
        <input id="token" type="password" autocomplete="current-password" required>
        <p class="dialog-error" id="dialog-error" role="alert"></p>
        <div class="dialog-actions">
          <button class="button" id="cancel-dialog" type="button">Cancel</button>
          <button class="button primary" type="submit">Connect</button>
        </div>
      </div>
    </form>
  </dialog>

  <script>
    const body = document.body;
    const dialog = document.querySelector('#owner-dialog');
    const form = document.querySelector('#owner-form');
    const tokenInput = document.querySelector('#token');
    const connectButton = document.querySelector('#connect');
    const systemMessage = document.querySelector('#system-message');
    const dialogError = document.querySelector('#dialog-error');
    const directiveForm = document.querySelector('#directive-form');
    const directiveFields = document.querySelector('#directive-fields');
    let reviewedLearning = null;
    let reviewedLearningCapacity = null;
    let ownerMandate = null;
    const auth = () => ({ Authorization: 'Bearer ' + (sessionStorage.getItem('sara-owner-token') || '') });
    const money = (value) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(value || 0));

    function setMessage(message, error) {
      systemMessage.textContent = message || '';
      systemMessage.style.color = error ? 'var(--coral)' : 'var(--cyan-soft)';
    }

    function setConnected(connected) {
      ownerWorkEpoch++;
      body.dataset.owner = connected ? 'connected' : 'locked';
      connectButton.textContent = connected ? 'Disconnect' : 'Owner access';
      document.querySelector('#connection-state').textContent = connected ? 'Owner link verified' : 'Owner state locked';
      directiveFields.disabled = !connected;
      document.querySelector('#owner-work-fields').disabled = !connected;
      document.querySelector('#learning-fields').disabled = !connected;
      if (!connected) {
        document.querySelector('#owner-work-results').replaceChildren();
        document.querySelector('#owner-work-status').textContent = 'Owner authentication required.';
        document.querySelector('#capabilities').textContent = '—';
        document.querySelector('#capabilities-note').textContent = 'Owner authentication required.';
        reviewedLearning = null; reviewedLearningCapacity = null; ownerMandate = null;
        document.querySelector('#learning-contract').value = '';
        document.querySelector('#learning-review').textContent = '';
        document.querySelector('#learning-status').textContent = 'Owner authentication required.';
        document.querySelector('#learning-approve').disabled = true;
        document.querySelector('#learning-capacity-preview').disabled = true;
        document.querySelector('#learning-capacity-approve').disabled = true;
      }
    }

    function renderMutations(mutations) {
      const container = document.querySelector('#mutations');
      container.replaceChildren();
      if (!mutations.length) {
        const empty = document.createElement('div');
        empty.className = 'mutation-empty';
        empty.textContent = 'No candidate mutations. Production remains champion.';
        container.append(empty);
        return;
      }
      mutations.forEach((mutation) => {
        const row = document.createElement('div');
        row.className = 'mutation-row';
        const title = document.createElement('span');
        title.className = 'mutation-title';
        title.textContent = mutation.id || 'Candidate mutation';
        const stage = document.createElement('span');
        stage.className = 'stage';
        stage.textContent = mutation.stage || 'UNKNOWN';
        row.append(title, stage);
        container.append(row);
      });
    }

    function commerceButton(label, action) {
      const button = document.createElement('button');
      button.className = 'button primary';
      button.type = 'button';
      button.textContent = label;
      button.addEventListener('click', action);
      return button;
    }

    async function ownerPost(path, body) {
      const response = await fetch(path, {
        method: 'POST',
        headers: Object.assign({}, auth(), { 'content-type': 'application/json' }),
        body: JSON.stringify(body || {})
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Owner action was rejected.');
      return result;
    }

    function renderCommerce(state) {
      const container = document.querySelector('#commerce-list');
      container.replaceChildren();
      const exactCapabilities = ['public-repository-inventory', 'readiness-analysis', 'independent-report-verification', 'delivery-package-generation'];
      const ready = exactCapabilities.every((id) => state.capabilities.some((capability) => capability.id === id && capability.status === 'available'));
      const readiness = document.createElement('div');
      readiness.className = 'commerce-row';
      const readinessTitle = document.createElement('strong');
      readinessTitle.textContent = ready ? 'Four exact service capabilities available' : 'Service capabilities incomplete';
      const readinessDetail = document.createElement('small');
      readinessDetail.textContent = exactCapabilities.map((id) => id + ': ' + (state.capabilities.find((capability) => capability.id === id)?.status || 'missing')).join(' · ');
      readiness.append(readinessTitle, readinessDetail);
      container.append(readiness);
      if (!state.commerce?.configured) {
        const row = document.createElement('div');
        row.className = 'commerce-row';
        row.textContent = 'Owner wallet and approved versioned terms are not configured. Checkout remains closed.';
        container.append(row);
        return;
      }
      const intents = state.revenuePaymentIntents || [];
      const jobs = state.revenuePilotJobs || [];
      intents.forEach((intent) => {
        const job = jobs.find((candidate) => candidate.id === intent.jobId);
        const row = document.createElement('div');
        row.className = 'commerce-row';
        const title = document.createElement('strong');
        title.textContent = 'Job ' + intent.jobId + ' · payment ' + intent.status;
        const detail = document.createElement('small');
        detail.textContent = '149 USDC · Base · terms ' + intent.termsVersion + ' · job ' + (job?.status || 'missing');
        const actions = document.createElement('div');
        actions.className = 'commerce-actions';
        if (intent.status === 'confirmed' && job?.status === 'offer_ready') {
          actions.append(commerceButton('Approve fulfillment — $149 collected — maximum execution cost $3 — public repository only', async () => {
            if (!window.confirm('Authorize fulfillment for this exact paid public-repository job?')) return;
            try {
              await ownerPost('/api/revenue-pilot/jobs/' + encodeURIComponent(job.id) + '/approve-fulfillment', { paymentIntentId: intent.id });
              await loadPrivateState();
            } catch (error) { setMessage(error.message, true); }
          }));
        }
        if (job?.status === 'owner_review') {
          const report = document.createElement('a');
          report.className = 'button commerce-link';
          report.href = '/api/revenue-pilot/jobs/' + encodeURIComponent(job.id) + '/report';
          report.target = '_blank';
          report.rel = 'noopener';
          report.textContent = 'Inspect report JSON';
          report.addEventListener('click', (event) => {
            event.preventDefault();
            fetch(report.href, { headers: auth() }).then(async (response) => {
              if (!response.ok) throw new Error('Report could not be loaded.');
              const blob = await response.blob();
              window.open(URL.createObjectURL(blob), '_blank', 'noopener');
            }).catch((error) => setMessage(error.message, true));
          });
          actions.append(report);
          actions.append(commerceButton('Approve and deliver', async () => {
            if (!window.confirm('You inspected the actual report. Create customer delivery access now?')) return;
            try {
              const result = await ownerPost('/api/revenue-pilot/jobs/' + encodeURIComponent(job.id) + '/approve-delivery', { confirmDelivery: true });
              const link = document.createElement('a');
              link.className = 'commerce-link';
              link.href = result.delivery.downloadUrl;
              link.textContent = 'Secure delivery link (copy for the customer)';
              link.rel = 'noreferrer';
              row.append(link);
              await loadPrivateState();
            } catch (error) { setMessage(error.message, true); }
          }));
        }
        row.append(title, detail, actions);
        container.append(row);
      });
      if (!intents.length) {
        const empty = document.createElement('div');
        empty.className = 'mutation-empty';
        empty.textContent = 'No customer payment intents.';
        container.append(empty);
      }
    }

    function renderAutonomy(state) {
      const container = document.querySelector('#autonomy-list');
      container.replaceChildren();
      const mandate = state.standingMandate;
      const active = mandate && !mandate.revokedAt && Date.parse(mandate.expiresAt) > Date.now();
      const row = document.createElement('div');
      row.className = 'commerce-row';
      const title = document.createElement('strong');
      title.textContent = active ? 'Standing mandate active' : 'Standing mandate inactive';
      const detail = document.createElement('small');
      detail.textContent = active
        ? 'Expires ' + mandate.expiresAt + ' · max ' + mandate.maximumDailyActions + ' actions/day · concurrency ' + mandate.maximumConcurrentActions + ' · ' + money(mandate.maximumCostPerActionUsd) + '/action · exceptions ' + (state.autonomyExceptions || []).length
        : 'No routine external action may proceed automatically. Protected actions always remain owner-only.';
      const actions = document.createElement('div');
      actions.className = 'commerce-actions';
      if (active) {
        actions.append(commerceButton('Revoke standing mandate', async () => {
          if (!window.confirm('Revoke routine autonomy immediately?')) return;
          try {
            await ownerPost('/api/autonomy/standing-mandate/revoke', { mandateId: mandate.id, reason: 'Owner revoked the standing mandate.' });
            await loadPrivateState();
          } catch (error) { setMessage(error.message, true); }
        }));
      } else {
        actions.append(commerceButton('Activate 30-day routine mandate', async () => {
          if (!window.confirm('Allow only the listed routine actions for 30 days, at $0 per action, maximum 10 daily and one at a time?')) return;
          try {
            await ownerPost('/api/autonomy/standing-mandate', {});
            await loadPrivateState();
          } catch (error) { setMessage(error.message, true); }
        }));
      }
      row.append(title, detail, actions);
      container.append(row);
      const boundary = document.createElement('div');
      boundary.className = 'commerce-row';
      const connectors = state.automation?.connectors || {};
      boundary.textContent = 'Connectors — email: ' + (connectors.email || 'unknown') + ' · calendar: ' + (connectors.calendar || 'unknown') + ' · WhatsApp: ' + (connectors.whatsapp || 'unknown') + '. Always blocked: money movement, account creation, credentials, impersonation, prohibited platform automation. Custom contracts require exact owner approval.';
      container.append(boundary);
    }

    async function refreshLearning() {
      const response = await fetch('/api/learning/campaign', {headers: auth()});
      if (!response.ok) throw new Error('Learning status could not be loaded.');
      const status = await response.json();
      document.querySelector('#learning-status').textContent = (status.configured
        ? status.campaign.id + ': ' + status.campaign.reserved + '/' + status.campaign.maximumRequests + ' requests reserved; ' + status.campaign.remaining + ' remain.'
        : 'No campaign configured.') + ' Worker: ' + (status.runtime.enabled ? 'enabled' : 'disabled')
        + '. Free provider: ' + (status.runtime.providerConfigured ? 'configured' : 'missing configuration') + '.';
      const capacityPreview = document.querySelector('#learning-capacity-preview');
      capacityPreview.disabled = !status.configured || status.campaign.maximumRequests >= 100;
      if (status.campaign && status.campaign.maximumRequests >= 100) reviewedLearningCapacity = null;
      document.querySelector('#learning-capacity-approve').disabled = !reviewedLearningCapacity || !status.configured || status.campaign.maximumRequests >= 100;
      const active = ownerMandate && !ownerMandate.revokedAt && Date.parse(ownerMandate.expiresAt) > Date.now();
      const compatible = active && ownerMandate.allowedActions.includes('business_candidate_development')
        && ownerMandate.allowedChannels.includes('internal') && ownerMandate.allowedServiceIds.includes('skill-learning');
      const button = document.querySelector('#learning-mandate');
      const needsRateUpgrade = compatible && Number(ownerMandate.maximumDailyActions || 0) < 20;
      button.disabled = !status.configured || (compatible && !needsRateUpgrade);
      button.textContent = needsRateUpgrade ? 'Upgrade learning mandate to 20/day'
        : compatible ? 'Current mandate covers internal learning'
        : active ? 'Replace active mandate with 20/day internal learning' : 'Activate 30-day internal learning mandate';
    }

    document.querySelector('#learning-contract').addEventListener('input', () => {
      reviewedLearning = null;
      document.querySelector('#learning-approve').disabled = true;
      document.querySelector('#learning-review').textContent = '';
    });

    document.querySelector('#learning-preview').addEventListener('click', async () => {
      reviewedLearning = null;
      document.querySelector('#learning-approve').disabled = true;
      try {
        const parsed = JSON.parse(document.querySelector('#learning-contract').value);
        const campaign = parsed.campaign || parsed;
        const response = await fetch('/api/learning/campaign', {method:'POST', headers:Object.assign({},auth(),{'content-type':'application/json'}), body:JSON.stringify({campaign})});
        const result = await response.json();
        if (response.status !== 409 || !result.campaignDigest) throw new Error(result.error || 'Campaign review failed.');
        reviewedLearning = {campaign, approvedDigest:result.campaignDigest};
        document.querySelector('#learning-review').textContent = 'Approve ' + campaign.id + ', maximum ' + campaign.maximumRequests
          + ' free requests, up to 20 per UTC day and four attempts per learning root. Frozen capabilities: ' + campaign.contracts.map((c)=>c.capabilityId).join(', ')
          + '. Exact digest: ' + result.campaignDigest + '. No operational promotion is granted.';
        document.querySelector('#learning-approve').disabled = false;
      } catch(error) { setMessage(error.message,true); }
    });

    document.querySelector('#learning-approve').addEventListener('click', async () => {
      if (!reviewedLearning) return;
      const approved = reviewedLearning;
      reviewedLearning = null;
      document.querySelector('#learning-approve').disabled = true;
      try {
        await ownerPost('/api/learning/campaign',approved);
        document.querySelector('#learning-contract').value = '';
        document.querySelector('#learning-review').textContent = 'Exact campaign retained. Request accounting cannot be reset by submitting it again.';
        await refreshLearning();
      } catch(error) { setMessage(error.message,true); }
    });

    document.querySelector('#learning-capacity-preview').addEventListener('click', async () => {
      reviewedLearningCapacity = null;
      document.querySelector('#learning-capacity-approve').disabled = true;
      try {
        const response = await fetch('/api/learning/campaign/capacity', {method:'POST', headers:Object.assign({},auth(),{'content-type':'application/json'}), body:JSON.stringify({maximumRequests:100})});
        const result = await response.json();
        if (response.status !== 409 || !result.extensionDigest) throw new Error(result.error || 'Capacity review failed.');
        reviewedLearningCapacity = {maximumRequests:100, approvedDigest:result.extensionDigest};
        document.querySelector('#learning-review').textContent = 'Approve request capacity ' + result.previousMaximumRequests + ' → ' + result.maximumRequests
          + '. Frozen learning contracts and hidden acceptance tests do not change. Exact extension digest: ' + result.extensionDigest + '.';
        document.querySelector('#learning-capacity-approve').disabled = false;
      } catch(error) { setMessage(error.message,true); }
    });

    document.querySelector('#learning-capacity-approve').addEventListener('click', async () => {
      if (!reviewedLearningCapacity) return;
      const approved = reviewedLearningCapacity;
      reviewedLearningCapacity = null;
      document.querySelector('#learning-capacity-approve').disabled = true;
      try {
        await ownerPost('/api/learning/campaign/capacity',approved);
        document.querySelector('#learning-review').textContent = 'Learning request capacity extended to 100. Frozen curriculum and qualification controls remain unchanged.';
        await refreshLearning();
      } catch(error) { setMessage(error.message,true); }
    });

    document.querySelector('#learning-mandate').addEventListener('click', async () => {
      const active = ownerMandate && !ownerMandate.revokedAt && Date.parse(ownerMandate.expiresAt) > Date.now();
      const compatible = active && ownerMandate.allowedActions.includes('business_candidate_development')
        && ownerMandate.allowedChannels.includes('internal') && ownerMandate.allowedServiceIds.includes('skill-learning');
      if (active && !compatible && !window.confirm('Replace the current standing mandate with the zero-cost internal learning mandate? The current routine mandate will be replaced under exact owner reconciliation.')) return;
      try {
        await ownerPost('/api/autonomy/learning-mandate',ownerMandate ? {expectedCurrentMandateDigest:ownerMandate.digest} : {});
        await loadPrivateState();
      } catch(error) { setMessage(error.message,true); }
    });

    let ownerWorkPending = null;
    let ownerWorkEpoch = 0;
    function renderOwnerWork(results) {
      const list = document.querySelector('#owner-work-results');
      list.replaceChildren();
      for (const result of results) {
        const article = document.createElement('article'); article.style.overflowWrap = 'anywhere';
        const title = document.createElement('p');
        title.textContent = result.goal + ' — ' + result.status;
        article.appendChild(title);
        const summary = document.createElement('p');
        summary.textContent = result.outputText + ' · ' + result.verification + ' · Recorded cost $' + (result.actualCashMicroUsd / 1000000).toFixed(6);
        article.appendChild(summary);
        const observed = document.createElement('p'); observed.textContent = 'Source observed: ' + result.observedAt; article.appendChild(observed);
        const progress = document.createElement('p'); progress.textContent = 'Workflow: ' + (result.workflow || 'No supported match') + ' · ' + (result.currentStep ? 'Next step: ' + result.currentStep + ' · ' : '') + result.nextAction; article.appendChild(progress);
        for (const receipt of result.receipts) {
          const output = receipt.output || {};
          const lines = [...(output.commitments || []).map(item => item.statement), ...(output.followUps || []).map(item => item.reason), ...(output.ambiguities || []), ...(output.responseDraft ? [output.responseDraft] : []), ...(output.sections || []).flatMap(section => section.items.map(item => item.summary)), ...(output.basis === 'AUTHORITATIVE_JOB_STATE' ? output.jobs.map(job => job.jobId + ': linked realized revenue $' + (job.realizedRevenueMicroUsd / 1000000).toFixed(6) + '; recorded model and direct costs $' + ((job.modelApiMicroUsd + job.directExternalMicroUsd) / 1000000).toFixed(6)) : []), ...(output.accountingUnknowns || [])];
          if (receipt.capability.id === 'bug-reproduction-planner') lines.push('Reproduction plan: ' + output.status + '. Reproduction has not been executed.', ...output.steps.map(step => step.action));
          if (receipt.capability.id === 'root-cause-analyzer') lines.push('Root cause remains unconfirmed. ' + output.nextDiagnostic);
          if (receipt.capability.id === 'quote-margin-guard') lines.push('Quote calculation: ' + output.status + '. Expected cash contribution: ' + (output.contributionMicroUsd === null ? 'unknown' : '$' + (output.contributionMicroUsd / 1000000).toFixed(6)) + '; cash margin: ' + (output.marginPpm === null ? 'unknown' : (output.marginPpm / 10000).toFixed(2) + '%') + '. These are supplied estimates, not realized revenue.');
          if (receipt.capability.id === 'proposal-compiler') lines.push('Unapproved proposal draft: ' + output.problemStatement, ...output.deliverables.map(item => 'Deliverable: ' + item), ...output.acceptanceCriteria.map(item => 'Acceptance: ' + item), ...output.missingFacts);
          for (const line of lines) { const p = document.createElement('p'); p.textContent = line; article.appendChild(p); }
        }
        for (const blocker of result.blockers || []) {
          const p = document.createElement('p'); p.textContent = blocker.subjectId + ': ' + blocker.reason; article.appendChild(p);
        }
        const details = document.createElement('details');
        const label = document.createElement('summary'); label.textContent = 'Executed steps and evidence (' + result.receipts.length + ')'; details.appendChild(label);
        for (const receipt of result.receipts) {
          const p = document.createElement('p'); p.textContent = receipt.capability.id + ' · EXECUTED · ' + receipt.status; details.appendChild(p);
          const pre = document.createElement('pre'); pre.style.whiteSpace = 'pre-wrap'; pre.style.overflowWrap = 'anywhere'; pre.textContent = JSON.stringify({result: receipt.output, evidence: receipt.resultDigest, cost: receipt.cost}, null, 2); details.appendChild(pre);
        }
        article.appendChild(details);
        list.appendChild(article);
      }
    }
    async function refreshOwnerWork() {
      if (body.dataset.owner !== 'connected') return;
      const epoch = ownerWorkEpoch;
      const response = await fetch('/api/owner/work', {headers: auth(), signal: AbortSignal.timeout(30000)});
      if (response.status === 401) { setConnected(false); return; }
      if (!response.ok) { document.querySelector('#owner-work-status').textContent = 'Work history unavailable. Refresh to retry.'; return; }
      const results = await response.json();
      if (body.dataset.owner === 'connected' && epoch === ownerWorkEpoch) renderOwnerWork(results);
    }
    document.querySelector('#owner-work-refresh').addEventListener('click', () => { refreshOwnerWork().catch(() => { document.querySelector('#owner-work-status').textContent = 'Work history unavailable.'; }); });
    document.querySelector('#owner-work-form').addEventListener('submit', async (event) => {
      event.preventDefault();
      if (body.dataset.owner !== 'connected') return;
      const text = document.querySelector('#owner-work-text').value.trim();
      const suppliedText = document.querySelector('#owner-work-material').value.trim();
      const identity = JSON.stringify({text, suppliedText});
      if (!ownerWorkPending || ownerWorkPending.identity !== identity) ownerWorkPending = {identity, requestId: 'owner-' + crypto.randomUUID()};
      const epoch = ownerWorkEpoch;
      const button = document.querySelector('#owner-work-submit'); button.disabled = true;
      document.querySelector('#owner-work-status').textContent = 'Submitting supported work…';
      try {
        const response = await fetch('/api/owner/messages', {method: 'POST', signal: AbortSignal.timeout(30000), headers: {...auth(), 'Content-Type': 'application/json'}, body: JSON.stringify({requestId: ownerWorkPending.requestId, text, ...(suppliedText ? {suppliedText} : {})})});
        if (response.status === 401) { setConnected(false); return; }
        const result = await response.json();
        if (body.dataset.owner !== 'connected' || epoch !== ownerWorkEpoch) return;
        if (!response.ok) throw new Error(result.error || 'Work request failed.');
        renderOwnerWork([result]); document.querySelector('#owner-work-status').textContent = result.status + ' · ' + result.verification;
      } catch (error) { if (body.dataset.owner === 'connected' && epoch === ownerWorkEpoch) document.querySelector('#owner-work-status').textContent = 'Request interrupted. Submit again to reconcile the same request. ' + error.message; }
      finally { button.disabled = false; }
    });

    async function refreshCapabilityInventory(revenueServiceCount) {
      const count = document.querySelector('#capabilities');
      const note = document.querySelector('#capabilities-note');
      count.textContent = '—';
      note.textContent = 'Loading capability inventory…';
      try {
        const response = await fetch('/api/capability-contracts', { headers: auth() });
        if (response.status === 401) {
          setConnected(false);
          throw new Error('Owner token was not accepted.');
        }
        if (!response.ok) throw new Error('Inventory unavailable.');
        const contracts = await response.json();
        if (!Array.isArray(contracts) || contracts.some((c) => !c || typeof c.id !== 'string'
          || typeof c.status !== 'string' || typeof c.maturity !== 'string'
          || typeof c.qualification?.status !== 'string')
          || new Set(contracts.map((c) => c.id)).size !== contracts.length) throw new Error('Invalid inventory.');
        count.textContent = String(contracts.filter((c) => c.status === 'ENABLED'
          && c.maturity === 'QUALIFIED' && c.qualification.status === 'PASSED').length);
        note.textContent = 'Enabled · ' + contracts.length + ' registered · ' + revenueServiceCount + ' revenue services';
      } catch (error) {
        if (body.dataset.owner !== 'connected') throw error;
        note.textContent = 'Digital capability inventory unavailable. Refresh to retry.';
      }
    }

    async function loadPrivateState() {
      const response = await fetch('/api/status', { headers: auth() });
      if (!response.ok) {
        setConnected(false);
        throw new Error(response.status === 401 ? 'Owner token was not accepted.' : 'Protected state could not be loaded.');
      }
      const state = await response.json();
      setConnected(true);
      const operating = document.querySelector('#operating');
      operating.classList.remove('operating', 'stopped');
      operating.classList.add(state.emergencyStopped ? 'stopped' : 'operating');
      operating.querySelector('span:last-child').textContent = state.emergencyStopped ? 'Stopped' : 'Operating';
      document.querySelector('#operating-copy').textContent = state.emergencyStopped ? 'Constitutional stop is active. Protected reads and recovery remain available.' : 'The verified kernel is available inside its current authority boundary.';
      document.querySelector('#owner-cost').textContent = money(state.ownerFundedRecurringMonthlyUsd);
      document.querySelector('#jobs').textContent = String(state.jobs.length);
      await refreshCapabilityInventory(state.capabilities.length);
      await refreshOwnerWork();
      document.querySelector('#compound-reserve').textContent = money(state.availableCompoundReserveUsd);
      document.querySelector('#constitution').textContent = 'Verified · v' + state.constitution.version;
      document.querySelector('#digest').textContent = state.constitution.digest;
      document.querySelector('#memories').textContent = String(state.memoryCount);
      const learning = state.learning || {};
      document.querySelector('#memory-note').textContent = 'Reparodynamics v' + (learning.reparodynamicsVersion || '—') + ' · ' + (learning.verifiedOutcomeCount || 0) + ' verified outcomes · provenance-aware';
      document.querySelector('#events').textContent = String(state.audit.eventCount);
      document.querySelector('#audit-head').textContent = state.audit.headHash || 'Genesis state · no audit head';
      renderMutations(state.mutations);
      renderCommerce(state);
      renderAutonomy(state);
      ownerMandate = state.standingMandate;
      await refreshLearning();
      const stop = document.querySelector('#stop');
      stop.disabled = false;
      stop.textContent = state.emergencyStopped ? 'Release stop' : 'Engage stop';
      stop.dataset.active = String(!state.emergencyStopped);
      setMessage('Protected owner state synchronized.', false);
    }

    async function loadPublicHealth() {
      try {
        const response = await fetch('/health');
        if (!response.ok) return;
        const health = await response.json();
        const caption = document.querySelector('.core-caption strong');
        caption.textContent = health.constitutionVerified ? 'Constitution verified' : 'Verification required';
      } catch (_) {
        document.querySelector('.core-caption strong').textContent = 'Preview mode';
      }
    }

    connectButton.addEventListener('click', () => {
      if (body.dataset.owner === 'connected') {
        sessionStorage.removeItem('sara-owner-token');
        window.location.reload();
        return;
      }
      dialog.showModal();
      dialogError.textContent = '';
      queueMicrotask(() => tokenInput.focus());
    });

    document.querySelector('#cancel-dialog').addEventListener('click', () => dialog.close());
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      sessionStorage.setItem('sara-owner-token', tokenInput.value);
      tokenInput.value = '';
      try {
        await loadPrivateState();
        dialog.close();
      } catch (error) {
        sessionStorage.removeItem('sara-owner-token');
        dialogError.textContent = error.message;
        setMessage(error.message, true);
      }
    });

    document.querySelector('#stop').addEventListener('click', async (event) => {
      const active = event.currentTarget.dataset.active === 'true';
      const verb = active ? 'engage' : 'release';
      if (!window.confirm('Owner confirmation required: ' + verb + ' the constitutional emergency stop?')) return;
      event.currentTarget.disabled = true;
      setMessage('Applying owner-authorized state change…', false);
      try {
        const response = await fetch('/api/emergency-stop', {
          method: 'POST',
          headers: Object.assign({}, auth(), { 'content-type': 'application/json' }),
          body: JSON.stringify({ active: active })
        });
        if (!response.ok) throw new Error('Emergency-stop change was rejected.');
        await loadPrivateState();
      } catch (error) {
        setMessage(error.message, true);
        event.currentTarget.disabled = false;
      }
    });

    directiveForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      const objective = document.querySelector('#directive-objective').value.trim();
      const acceptanceCriteria = document.querySelector('#directive-criteria').value
        .split(/\\n+/)
        .map((line) => line.trim())
        .filter(Boolean);
      if (!objective || !acceptanceCriteria.length) {
        setMessage('An objective and at least one acceptance criterion are required.', true);
        return;
      }
      const submit = directiveForm.querySelector('button[type="submit"]');
      submit.disabled = true;
      setMessage('Compiling the owner directive into a bounded job…', false);
      try {
        const response = await fetch('/api/objectives', {
          method: 'POST',
          headers: Object.assign({}, auth(), { 'content-type': 'application/json' }),
          body: JSON.stringify({
            objective,
            expectedOwnerValue: Number(document.querySelector('#directive-value').value),
            requiredCapabilities: document.querySelector('#directive-capabilities').value.split(',').map((id) => id.trim()).filter(Boolean),
            acceptanceCriteria,
            maximumBudgetUsd: Number(document.querySelector('#directive-budget').value)
          })
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Directive was rejected.');
        directiveForm.reset();
        document.querySelector('#directive-value').value = '1';
        document.querySelector('#directive-budget').value = '0';
        await loadPrivateState();
        setMessage('Bounded job authorized: ' + result.id, false);
      } catch (error) {
        setMessage(error.message, true);
      } finally {
        submit.disabled = false;
      }
    });

    loadPublicHealth();
    if (sessionStorage.getItem('sara-owner-token')) {
      loadPrivateState().catch((error) => {
        sessionStorage.removeItem('sara-owner-token');
        setMessage(error.message, true);
      });
    }
  </script>
</body>
</html>`;
