export const DASHBOARD_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="dark">
  <meta name="theme-color" content="#07100d">
  <title>SARA + SEED World — Owner Command Center</title>
  <style>
    :root {
      color-scheme: dark;
      --ink: #07100d;
      --ink-deep: #030806;
      --panel: rgba(14, 30, 24, .72);
      --panel-solid: #0d1c17;
      --line: rgba(162, 233, 199, .15);
      --line-bright: rgba(162, 233, 199, .32);
      --text: #effcf5;
      --muted: #9ab8aa;
      --mint: #7df7bd;
      --mint-soft: #b5f5d4;
      --amber: #ffc36e;
      --coral: #ff897e;
      --serif: "Iowan Old Style", "Palatino Linotype", Palatino, Baskerville, Georgia, serif;
      --sans: "Avenir Next", Avenir, "Segoe UI", ui-sans-serif, system-ui, sans-serif;
      --mono: "SFMono-Regular", Consolas, "Liberation Mono", monospace;
    }

    * { box-sizing: border-box; }
    html { scroll-behavior: smooth; }
    body {
      margin: 0;
      min-width: 320px;
      min-height: 100vh;
      overflow-x: hidden;
      background:
        radial-gradient(circle at 8% -4%, rgba(70, 171, 124, .18), transparent 34rem),
        radial-gradient(circle at 94% 22%, rgba(255, 195, 110, .07), transparent 28rem),
        linear-gradient(145deg, var(--ink-deep), var(--ink) 48%, #081510);
      color: var(--text);
      font-family: var(--sans);
      -webkit-font-smoothing: antialiased;
    }

    body::before {
      position: fixed;
      inset: 0;
      z-index: -1;
      pointer-events: none;
      content: "";
      opacity: .28;
      background-image:
        linear-gradient(rgba(255,255,255,.016) 1px, transparent 1px),
        linear-gradient(90deg, rgba(255,255,255,.016) 1px, transparent 1px);
      background-size: 72px 72px;
      mask-image: linear-gradient(to bottom, black, transparent 75%);
    }

    button, input { font: inherit; }
    button { color: inherit; }
    button:focus-visible, input:focus-visible {
      outline: 2px solid var(--mint);
      outline-offset: 3px;
    }

    .shell {
      width: min(1240px, calc(100% - 40px));
      margin: 0 auto;
    }

    .topbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      min-height: 86px;
      border-bottom: 1px solid var(--line);
    }

    .brand {
      display: inline-flex;
      align-items: center;
      gap: 13px;
      color: var(--text);
      text-decoration: none;
    }

    .brand-mark {
      position: relative;
      width: 34px;
      height: 34px;
      border: 1px solid rgba(125, 247, 189, .5);
      border-radius: 50% 50% 46% 54%;
      background: radial-gradient(circle at 40% 35%, #c8ffe1 0 5%, #65eba9 7% 17%, #163d2e 50%, #09130f 70%);
      box-shadow: 0 0 28px rgba(100, 235, 169, .25), inset 0 0 12px rgba(181, 245, 212, .12);
      transform: rotate(-12deg);
    }

    .brand-mark::after {
      position: absolute;
      left: 16px;
      top: 24px;
      width: 1px;
      height: 12px;
      content: "";
      background: var(--mint);
      transform: rotate(18deg);
      transform-origin: top;
    }

    .brand-name { font-weight: 780; letter-spacing: .18em; font-size: .86rem; }
    .brand-world { color: var(--muted); font-size: .76rem; letter-spacing: .08em; }

    .top-actions { display: flex; align-items: center; gap: 12px; }
    .domain-pill {
      display: inline-flex;
      align-items: center;
      gap: 7px;
      color: var(--muted);
      font-family: var(--mono);
      font-size: .68rem;
      letter-spacing: .03em;
    }

    .domain-pill::before {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      content: "";
      background: var(--mint);
      box-shadow: 0 0 12px var(--mint);
    }

    .button {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 9px;
      min-height: 42px;
      padding: 0 17px;
      border: 1px solid var(--line-bright);
      border-radius: 999px;
      background: rgba(11, 25, 20, .78);
      font-weight: 720;
      font-size: .8rem;
      letter-spacing: .02em;
      cursor: pointer;
      transition: transform .2s ease, border-color .2s ease, background .2s ease, box-shadow .2s ease;
    }

    .button:hover { transform: translateY(-1px); border-color: rgba(125, 247, 189, .64); background: rgba(18, 43, 33, .9); }
    .button.primary { border-color: transparent; background: var(--mint); color: #06100c; box-shadow: 0 8px 28px rgba(125, 247, 189, .14); }
    .button.primary:hover { background: #a0ffd1; box-shadow: 0 10px 34px rgba(125, 247, 189, .24); }
    .button.danger { border-color: rgba(255, 137, 126, .44); color: #ffd2ce; background: rgba(79, 25, 23, .5); }
    .button.danger:hover { border-color: var(--coral); background: rgba(103, 31, 27, .66); }
    .button:disabled { opacity: .4; cursor: not-allowed; transform: none; }

    .hero {
      display: grid;
      grid-template-columns: minmax(0, 1.12fr) minmax(360px, .88fr);
      gap: clamp(32px, 7vw, 96px);
      align-items: center;
      min-height: 680px;
      padding: 68px 0 76px;
    }

    .eyebrow {
      display: flex;
      align-items: center;
      gap: 11px;
      margin: 0 0 25px;
      color: var(--mint-soft);
      font-size: .69rem;
      font-weight: 760;
      letter-spacing: .17em;
      text-transform: uppercase;
    }

    .eyebrow::before { width: 31px; height: 1px; content: ""; background: var(--mint); }

    h1 {
      max-width: 790px;
      margin: 0;
      font-family: var(--serif);
      font-size: clamp(4rem, 8.6vw, 8.4rem);
      font-weight: 400;
      letter-spacing: -.07em;
      line-height: .82;
    }

    h1 em { color: var(--mint); font-weight: 400; }
    .hero-copy {
      max-width: 650px;
      margin: 32px 0 0;
      color: #afc9bd;
      font-size: clamp(1rem, 1.5vw, 1.18rem);
      line-height: 1.7;
    }

    .hero-copy strong { color: var(--text); font-weight: 650; }

    .truth-row {
      display: flex;
      flex-wrap: wrap;
      gap: 9px;
      margin: 32px 0 0;
    }

    .truth-chip {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      min-height: 34px;
      padding: 0 12px;
      border: 1px solid var(--line);
      border-radius: 999px;
      color: #b8d0c5;
      background: rgba(13, 29, 23, .55);
      font-size: .72rem;
    }

    .truth-chip::before { width: 5px; height: 5px; border-radius: 50%; content: ""; background: var(--mint); }

    .core-stage {
      position: relative;
      display: grid;
      place-items: center;
      aspect-ratio: 1;
      max-width: 510px;
      justify-self: end;
      isolation: isolate;
    }

    .core-stage::before {
      position: absolute;
      inset: 9%;
      z-index: -2;
      border-radius: 50%;
      content: "";
      background: radial-gradient(circle, rgba(65, 205, 142, .13), transparent 67%);
      filter: blur(8px);
      animation: breathe 5s ease-in-out infinite;
    }

    .orbit {
      position: absolute;
      border: 1px solid rgba(125, 247, 189, .15);
      border-radius: 50%;
    }

    .orbit.one { inset: 7%; animation: orbit 32s linear infinite; }
    .orbit.two { inset: 19%; border-style: dashed; animation: orbit 22s linear infinite reverse; }
    .orbit.three { inset: 31%; animation: orbit 15s linear infinite; }

    .orbit::after {
      position: absolute;
      top: 50%;
      left: -4px;
      width: 7px;
      height: 7px;
      border-radius: 50%;
      content: "";
      background: var(--mint);
      box-shadow: 0 0 18px rgba(125, 247, 189, .9);
    }

    .orbit.two::after { top: 12%; left: 79%; width: 5px; height: 5px; background: var(--amber); box-shadow: 0 0 16px var(--amber); }
    .orbit.three::after { top: auto; bottom: 5%; left: 66%; }

    .seed-core {
      position: relative;
      display: grid;
      place-items: center;
      width: 34%;
      aspect-ratio: 1;
      border: 1px solid rgba(186, 255, 220, .52);
      border-radius: 54% 46% 58% 42% / 45% 52% 48% 55%;
      background:
        radial-gradient(circle at 37% 31%, rgba(238, 255, 246, .95) 0 2%, rgba(125, 247, 189, .78) 4% 11%, transparent 23%),
        radial-gradient(circle at 62% 68%, rgba(255, 195, 110, .25), transparent 28%),
        radial-gradient(circle, #1e7651, #0b291d 62%, #07100d 73%);
      box-shadow:
        0 0 52px rgba(85, 230, 157, .3),
        0 0 120px rgba(55, 166, 113, .14),
        inset 0 0 30px rgba(202, 255, 227, .13);
      animation: morph 9s ease-in-out infinite;
    }

    .seed-core::before, .seed-core::after {
      position: absolute;
      inset: 13%;
      border: 1px solid rgba(209, 255, 230, .23);
      border-radius: inherit;
      content: "";
      animation: orbit 18s linear infinite;
    }

    .seed-core::after { inset: 27%; border-color: rgba(255, 195, 110, .23); animation-direction: reverse; animation-duration: 12s; }

    .core-label {
      position: absolute;
      z-index: 2;
      font-family: var(--mono);
      font-size: .63rem;
      letter-spacing: .16em;
      text-transform: uppercase;
      text-shadow: 0 2px 14px #000;
    }

    .core-caption {
      position: absolute;
      right: 0;
      bottom: 8%;
      width: 160px;
      padding: 12px 14px;
      border: 1px solid var(--line);
      border-radius: 14px;
      background: rgba(7, 16, 13, .82);
      backdrop-filter: blur(18px);
    }

    .core-caption span { display: block; color: var(--muted); font-size: .63rem; letter-spacing: .12em; text-transform: uppercase; }
    .core-caption strong { display: block; margin-top: 5px; color: var(--mint-soft); font-family: var(--mono); font-size: .76rem; }

    .chapter {
      padding: 10px 0 34px;
      border-top: 1px solid var(--line);
    }

    .chapter-head {
      display: flex;
      align-items: end;
      justify-content: space-between;
      gap: 30px;
      padding: 54px 0 26px;
    }

    .chapter-index { color: var(--mint); font-family: var(--mono); font-size: .68rem; letter-spacing: .1em; }
    h2 { margin: 8px 0 0; font-family: var(--serif); font-size: clamp(2.2rem, 4vw, 4.5rem); font-weight: 400; letter-spacing: -.055em; line-height: .95; }
    .chapter-note { max-width: 380px; margin: 0; color: var(--muted); font-size: .82rem; line-height: 1.65; }

    .connection-state {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      color: var(--muted);
      font-family: var(--mono);
      font-size: .67rem;
      letter-spacing: .08em;
      text-transform: uppercase;
    }

    .connection-state::before { width: 7px; height: 7px; border-radius: 50%; content: ""; background: #607069; }
    body[data-owner="connected"] .connection-state { color: var(--mint-soft); }
    body[data-owner="connected"] .connection-state::before { background: var(--mint); box-shadow: 0 0 12px var(--mint); }

    .bento {
      display: grid;
      grid-template-columns: repeat(12, minmax(0, 1fr));
      gap: 14px;
    }

    .card {
      position: relative;
      grid-column: span 4;
      min-height: 220px;
      overflow: hidden;
      border: 1px solid var(--line);
      border-radius: 24px;
      background: linear-gradient(145deg, rgba(17, 37, 29, .8), rgba(8, 19, 15, .72));
      box-shadow: inset 0 1px rgba(255,255,255,.018);
      backdrop-filter: blur(16px);
      transition: border-color .25s ease, transform .25s ease, background .25s ease;
    }

    .card:hover { transform: translateY(-2px); border-color: rgba(125, 247, 189, .29); background: linear-gradient(145deg, rgba(20, 43, 34, .86), rgba(9, 21, 16, .76)); }
    .card.span-5 { grid-column: span 5; }
    .card.span-7 { grid-column: span 7; }
    .card.span-8 { grid-column: span 8; }
    .card.span-12 { grid-column: 1 / -1; }
    .card.tall { min-height: 344px; }
    .card-pad { position: relative; z-index: 2; padding: 24px; }

    .card-number {
      position: absolute;
      right: 19px;
      top: 17px;
      color: rgba(181, 245, 212, .34);
      font-family: var(--mono);
      font-size: .59rem;
      letter-spacing: .08em;
    }

    .card-label { color: #8ea99d; font-size: .66rem; font-weight: 730; letter-spacing: .14em; text-transform: uppercase; }
    .card-value { margin-top: 16px; font-family: var(--serif); font-size: clamp(2.25rem, 4.3vw, 4rem); letter-spacing: -.055em; line-height: .94; overflow-wrap: anywhere; }
    .card-value.small { font-size: clamp(1.55rem, 2.7vw, 2.6rem); }
    .card-copy { max-width: 490px; margin: 17px 0 0; color: var(--muted); font-size: .78rem; line-height: 1.65; }
    .mono { font-family: var(--mono); }

    .status-value { display: flex; align-items: center; gap: 13px; }
    .status-light { width: 12px; height: 12px; flex: 0 0 auto; border-radius: 50%; background: #65756e; box-shadow: 0 0 0 6px rgba(101, 117, 110, .08); }
    .status-value.operating .status-light { background: var(--mint); box-shadow: 0 0 20px rgba(125, 247, 189, .55), 0 0 0 6px rgba(125, 247, 189, .08); }
    .status-value.stopped .status-light { background: var(--coral); box-shadow: 0 0 20px rgba(255, 137, 126, .48), 0 0 0 6px rgba(255, 137, 126, .08); }

    .micro-stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 9px; margin-top: 26px; }
    .micro-stat { min-width: 0; padding: 12px; border: 1px solid rgba(162, 233, 199, .1); border-radius: 13px; background: rgba(4, 12, 9, .36); }
    .micro-stat span { display: block; color: #7f9d8f; font-size: .56rem; letter-spacing: .09em; text-transform: uppercase; }
    .micro-stat strong { display: block; margin-top: 7px; font-family: var(--mono); font-size: .78rem; overflow-wrap: anywhere; }

    .economic-orbit {
      position: absolute;
      right: -82px;
      bottom: -108px;
      width: 270px;
      height: 270px;
      border: 1px solid rgba(125, 247, 189, .12);
      border-radius: 50%;
    }

    .economic-orbit::before, .economic-orbit::after {
      position: absolute;
      border: 1px solid rgba(125, 247, 189, .1);
      border-radius: 50%;
      content: "";
    }

    .economic-orbit::before { inset: 35px; }
    .economic-orbit::after { inset: 78px; background: rgba(125, 247, 189, .04); }

    .allocation {
      display: grid;
      grid-template-columns: 3fr 1fr;
      gap: 4px;
      height: 8px;
      margin-top: 27px;
    }

    .allocation span { border-radius: 999px; }
    .allocation .family { background: linear-gradient(90deg, var(--mint), #4dbd89); }
    .allocation .compound { background: linear-gradient(90deg, var(--amber), #b97935); }
    .allocation-legend { display: flex; justify-content: space-between; gap: 16px; margin-top: 10px; color: var(--muted); font-size: .61rem; }

    .continuity-flow { display: grid; gap: 9px; margin-top: 22px; }
    .continuity-row { display: grid; grid-template-columns: 88px 1fr; gap: 12px; align-items: center; }
    .continuity-row span { color: #799589; font-size: .59rem; letter-spacing: .08em; text-transform: uppercase; }
    .continuity-row strong { padding: 9px 11px; border: 1px solid rgba(162, 233, 199, .1); border-radius: 11px; background: rgba(3, 9, 7, .38); font-size: .7rem; font-weight: 620; }

    .seal {
      position: absolute;
      right: 22px;
      bottom: 19px;
      display: grid;
      place-items: center;
      width: 94px;
      height: 94px;
      border: 1px solid rgba(125, 247, 189, .2);
      border-radius: 50%;
      color: rgba(181, 245, 212, .67);
      font-family: var(--mono);
      font-size: .55rem;
      letter-spacing: .12em;
      text-align: center;
      text-transform: uppercase;
    }

    .seal::before { position: absolute; inset: 8px; border: 1px dashed rgba(125, 247, 189, .18); border-radius: 50%; content: ""; animation: orbit 30s linear infinite; }
    .digest { max-width: calc(100% - 120px); margin-top: 18px; color: #7f9d90; font-family: var(--mono); font-size: .61rem; line-height: 1.55; overflow-wrap: anywhere; }

    .mutation-list { display: grid; gap: 9px; max-height: 218px; margin-top: 20px; overflow: auto; scrollbar-color: #315c49 transparent; }
    .mutation-empty { display: grid; place-items: center; min-height: 120px; border: 1px dashed rgba(162, 233, 199, .13); border-radius: 16px; color: #789185; font-family: var(--mono); font-size: .68rem; text-align: center; }
    .mutation-row { display: grid; grid-template-columns: 1fr auto; gap: 15px; align-items: center; padding: 12px 13px; border: 1px solid rgba(162, 233, 199, .1); border-radius: 13px; background: rgba(3, 9, 7, .35); }
    .mutation-title { min-width: 0; overflow: hidden; color: #cce4d8; font-family: var(--mono); font-size: .67rem; text-overflow: ellipsis; white-space: nowrap; }
    .stage { padding: 4px 7px; border: 1px solid rgba(255, 195, 110, .25); border-radius: 999px; color: var(--amber); font-family: var(--mono); font-size: .55rem; }

    .memory-cells { position: absolute; inset: auto -15px -20px auto; width: 180px; height: 150px; opacity: .34; }
    .memory-cells span { position: absolute; width: 42px; height: 42px; border: 1px solid rgba(125, 247, 189, .3); border-radius: 50% 50% 46% 54%; }
    .memory-cells span:nth-child(1) { left: 5px; top: 50px; }
    .memory-cells span:nth-child(2) { left: 54px; top: 16px; transform: scale(.72); }
    .memory-cells span:nth-child(3) { left: 94px; top: 66px; transform: scale(1.25); }
    .memory-cells span:nth-child(4) { left: 36px; top: 98px; transform: scale(.55); }

    .locked-note {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-top: 19px;
      color: #769084;
      font-size: .69rem;
    }

    .locked-note::before { width: 15px; height: 15px; border: 1px solid #647d71; border-radius: 50% 50% 45% 55%; content: ""; }

    .directive-card { min-height: 320px; background: linear-gradient(125deg, rgba(69, 28, 15, .55), rgba(40, 30, 10, .38) 44%, rgba(10, 25, 18, .8)); }
    .directive-card:hover { background: linear-gradient(125deg, rgba(84, 33, 16, .62), rgba(50, 37, 10, .42) 44%, rgba(10, 27, 19, .82)); }
    .directive-layout { display: grid; grid-template-columns: minmax(220px, .7fr) minmax(0, 1.3fr); gap: 30px; }
    .directive-form { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
    .directive-form fieldset { display: contents; }
    .directive-form label { display: grid; gap: 8px; color: #b9cbbf; font-size: .63rem; font-weight: 720; letter-spacing: .09em; text-transform: uppercase; }
    .directive-form label.wide { grid-column: 1 / -1; }
    .directive-form input, .directive-form textarea { width: 100%; border: 1px solid var(--line-bright); border-radius: 13px; background: rgba(4, 12, 8, .7); color: var(--text); font: .77rem var(--sans); text-transform: none; letter-spacing: 0; }
    .directive-form input { min-height: 45px; padding: 0 13px; }
    .directive-form textarea { min-height: 88px; padding: 12px 13px; resize: vertical; }
    .directive-form input:disabled, .directive-form textarea:disabled { opacity: .45; cursor: not-allowed; }
    .directive-actions { grid-column: 1 / -1; display: flex; align-items: center; justify-content: space-between; gap: 15px; }
    .directive-hint { max-width: 420px; color: var(--muted); font: .62rem/1.55 var(--mono); }

    .emergency {
      display: grid;
      grid-template-columns: 1fr auto;
      gap: 30px;
      align-items: center;
      min-height: 180px;
      border-color: rgba(255, 137, 126, .17);
      background: linear-gradient(110deg, rgba(43, 18, 16, .48), rgba(10, 20, 16, .78) 68%);
    }

    .emergency:hover { border-color: rgba(255, 137, 126, .3); background: linear-gradient(110deg, rgba(52, 20, 18, .56), rgba(10, 21, 16, .8) 68%); }
    .emergency .card-copy { max-width: 700px; }
    .emergency > .button { margin-right: 24px; }

    .system-message { min-height: 22px; margin: 15px 0 0; color: var(--amber); font-family: var(--mono); font-size: .65rem; }

    .future-strip {
      display: grid;
      grid-template-columns: repeat(7, auto);
      align-items: center;
      justify-content: space-between;
      gap: 15px;
      padding: 34px 0 45px;
      color: #739083;
      font-family: var(--mono);
      font-size: .59rem;
      letter-spacing: .1em;
      text-transform: uppercase;
    }

    .future-strip i { width: 4px; height: 4px; border-radius: 50%; background: #375a49; }
    footer { display: flex; justify-content: space-between; gap: 28px; padding: 28px 0 50px; border-top: 1px solid var(--line); color: #6f887d; font-size: .67rem; line-height: 1.55; }
    footer strong { color: #9eb7ab; font-weight: 650; }

    dialog {
      width: min(450px, calc(100% - 32px));
      padding: 0;
      border: 1px solid var(--line-bright);
      border-radius: 25px;
      background: #0c1b15;
      color: var(--text);
      box-shadow: 0 32px 100px rgba(0,0,0,.6);
    }

    dialog::backdrop { background: rgba(1, 6, 4, .78); backdrop-filter: blur(8px); }
    .dialog-inner { padding: 28px; }
    .dialog-kicker { color: var(--mint); font-family: var(--mono); font-size: .61rem; letter-spacing: .12em; text-transform: uppercase; }
    dialog h2 { margin: 13px 0 0; font-size: 2.45rem; }
    dialog p { color: var(--muted); font-size: .77rem; line-height: 1.65; }
    dialog label { display: block; margin-top: 22px; color: #b8d1c5; font-size: .7rem; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; }
    dialog input { width: 100%; min-height: 48px; margin-top: 9px; padding: 0 14px; border: 1px solid var(--line-bright); border-radius: 13px; background: #06100c; color: var(--text); }
    .dialog-error { min-height: 18px; margin: 10px 0 0; color: var(--coral); font-family: var(--mono); font-size: .65rem; }
    .dialog-actions { display: flex; justify-content: flex-end; gap: 9px; margin-top: 22px; }

    @keyframes orbit { to { transform: rotate(360deg); } }
    @keyframes breathe { 50% { opacity: .64; transform: scale(1.06); } }
    @keyframes morph {
      0%, 100% { border-radius: 54% 46% 58% 42% / 45% 52% 48% 55%; transform: rotate(-2deg) scale(1); }
      50% { border-radius: 45% 55% 43% 57% / 56% 43% 57% 44%; transform: rotate(3deg) scale(1.035); }
    }

    @media (max-width: 980px) {
      .hero { grid-template-columns: 1fr .72fr; min-height: 610px; gap: 22px; }
      .core-caption { right: -8px; }
      .card, .card.span-5 { grid-column: span 6; }
      .card.span-7, .card.span-8 { grid-column: 1 / -1; }
    }

    @media (max-width: 720px) {
      .shell { width: min(100% - 24px, 1240px); }
      .topbar { min-height: 70px; }
      .brand-world, .domain-pill { display: none; }
      .button { min-height: 38px; padding: 0 13px; }
      .hero { grid-template-columns: 1fr; min-height: auto; padding: 60px 0 42px; }
      h1 { font-size: clamp(4rem, 20vw, 6.5rem); }
      .hero-copy { margin-top: 25px; font-size: .96rem; }
      .core-stage { width: min(100%, 420px); justify-self: center; margin-top: 2px; }
      .chapter-head { display: block; padding-top: 45px; }
      .chapter-note { margin-top: 18px; }
      .directive-layout, .directive-form { grid-template-columns: 1fr; }
      .directive-form label.wide, .directive-actions { grid-column: 1; }
      .directive-actions { align-items: stretch; flex-direction: column; }
      .card, .card.span-5, .card.span-7, .card.span-8 { grid-column: 1 / -1; }
      .card { min-height: 200px; border-radius: 20px; }
      .card.tall { min-height: 320px; }
      .card-pad { padding: 21px; }
      .emergency { grid-template-columns: 1fr; gap: 15px; }
      .emergency > .button { justify-self: start; margin: 0 0 21px 21px; }
      .future-strip { grid-template-columns: 1fr; gap: 8px; justify-items: center; padding: 28px 0 36px; }
      .future-strip i { transform: translateY(0); }
      footer { flex-direction: column; }
    }

    @media (max-width: 420px) {
      .brand-name { letter-spacing: .12em; }
      .top-actions .button { font-size: .7rem; }
      .truth-row { gap: 6px; }
      .truth-chip { padding: 0 10px; font-size: .65rem; }
      .micro-stats { grid-template-columns: 1fr 1fr; }
      .continuity-row { grid-template-columns: 74px 1fr; }
      .seal { width: 78px; height: 78px; }
      .digest { max-width: calc(100% - 88px); }
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
        <span class="brand-world">/ SEED WORLD</span>
      </a>
      <div class="top-actions">
        <span class="domain-pill">saraseed.app</span>
        <button class="button" id="connect" type="button">Owner access</button>
      </div>
    </nav>

    <main id="top">
      <section class="hero" aria-labelledby="hero-title">
        <div>
          <p class="eyebrow">Protected intelligence · Generation zero</p>
          <h1 id="hero-title">Intelligence<br>with <em>roots.</em></h1>
          <p class="hero-copy"><strong>SARA is an owner-controlled digital organism</strong> being built to remember, learn, create verified value, and safely develop the capabilities needed for her next objective.</p>
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
            <span class="chapter-index">01 / OWNER COMMAND</span>
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
                <div class="micro-stat"><span>Capabilities</span><strong id="capabilities">—</strong></div>
              </div>
            </div>
          </article>

          <article class="card span-7">
            <span class="card-number">01.02</span>
            <div class="economic-orbit" aria-hidden="true"></div>
            <div class="card-pad">
              <div class="card-label">Economic core</div>
              <div class="card-value" id="compound-reserve">—</div>
              <p class="card-copy"><strong>SARA compound reserve.</strong> Collected-profit capital only. Registered provider actions require an exact-target, revocable owner mandate; raw transfers and new destinations remain owner-only.</p>
              <div class="allocation" aria-label="Protected family and reinvestment ranges"><span class="family"></span><span class="compound"></span></div>
              <div class="allocation-legend"><span>Family distribution · 50–75%</span><span>Compound · 25–50%</span></div>
              <div class="micro-stats">
                <div class="micro-stat"><span>Current rate</span><strong id="compound-rate">—</strong></div>
                <div class="micro-stat"><span>Spent</span><strong id="compound-spent">—</strong></div>
                <div class="micro-stat"><span>Active mandates</span><strong id="compound-mandates">—</strong></div>
              </div>
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
              <div class="seal" aria-hidden="true">Authority<br>layer<br>sealed</div>
            </div>
          </article>

          <article class="card span-8 tall">
            <span class="card-number">01.05</span>
            <div class="card-pad">
              <div class="card-label">Genome Lab</div>
              <div class="card-value small">Champion / Challenger</div>
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
                <div class="card-label">Owner directive channel</div>
                <div class="card-value small">Tell SARA what outcome you need.</div>
                <p class="card-copy">After owner authentication, a directive becomes a bounded job with explicit evidence and a hard budget. SARA may work autonomously inside that scope; protected actions still require you.</p>
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

          <article class="card span-12 emergency">
            <span class="card-number">01.09</span>
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
      <span><strong>SARA + SEED World</strong><br>A protected path toward increasingly capable intelligence.</span>
      <span>Visual command-center preview · local bootstrap<br>No deployment, live banking, or general autonomous coder implied.</span>
    </footer>
  </div>

  <dialog id="owner-dialog" aria-labelledby="dialog-title">
    <form id="owner-form">
      <div class="dialog-inner">
        <div class="dialog-kicker">Protected boundary</div>
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
    const auth = () => ({ Authorization: 'Bearer ' + (sessionStorage.getItem('sara-owner-token') || '') });
    const money = (value) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(value || 0));

    function setMessage(message, error) {
      systemMessage.textContent = message || '';
      systemMessage.style.color = error ? 'var(--coral)' : 'var(--mint-soft)';
    }

    function setConnected(connected) {
      body.dataset.owner = connected ? 'connected' : 'locked';
      connectButton.textContent = connected ? 'Disconnect' : 'Owner access';
      document.querySelector('#connection-state').textContent = connected ? 'Owner link verified' : 'Owner state locked';
      directiveFields.disabled = !connected;
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
      document.querySelector('#capabilities').textContent = String(state.capabilities.length);
      document.querySelector('#compound-reserve').textContent = money(state.availableCompoundReserveUsd);
      document.querySelector('#compound-rate').textContent = Math.round(state.realizedProfit.reinvestmentRate * 100) + '%';
      document.querySelector('#compound-spent').textContent = money(state.compoundReinvestmentSpentUsd);
      document.querySelector('#compound-mandates').textContent = String(state.compoundMandates.filter((mandate) => mandate.status === 'active' && Date.parse(mandate.expiresAt) > Date.now()).length);
      document.querySelector('#constitution').textContent = 'Verified · v' + state.constitution.version;
      document.querySelector('#digest').textContent = state.constitution.digest;
      document.querySelector('#memories').textContent = String(state.memoryCount);
      document.querySelector('#memory-note').textContent = 'Provenance-aware durable records';
      document.querySelector('#events').textContent = String(state.audit.eventCount);
      document.querySelector('#audit-head').textContent = state.audit.headHash || 'Genesis state · no audit head';
      renderMutations(state.mutations);
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
        .split(/\n+/)
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
            requiredCapabilities: [],
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
