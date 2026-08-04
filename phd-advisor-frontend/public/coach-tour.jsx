/* coach-tour.jsx — Welcome tutorial. A guided, anchored walkthrough that lights
   up each rail destination and explains what the page is for. Auto-navigates the
   app as it goes so you see each page live. Exports window.CoachTour.
   Shares scope; uses window.Icon. */

const { useState: useST, useEffect: useET, useLayoutEffect: useLT, useRef: useRT } = React;
const IcoT = window.Icon;

const TOUR_KEY = "phd-coach-tour-done-v1";

// ---------------------------------------------------------------------------
// Card placement, shared with the per-page tours.
//
// The old rule was "always go to the right of the anchor, then clamp to the
// viewport". Clamping is the bug: many anchors are near-full-width (a KPI row,
// the plan toolbar, a document list), so there is no room on the right and the
// clamp parked the card directly on top of the element it was explaining.
//
// Instead: try each side in turn and take the first that genuinely fits —
// right, left, below, above — and only then fall back to a corner, chosen in
// whichever half of the screen the anchor is not.
// ---------------------------------------------------------------------------
function placeTourCard(rect, card) {
  const M = 14, GAP = 18, MINW = 264;
  const fullW = (card && card.offsetWidth) || 332;
  const h = (card && card.offsetHeight) || 280;
  const vw = window.innerWidth, vh = window.innerHeight;
  const clampT = (t) => Math.min(Math.max(t, M), Math.max(M, vh - h - M));
  const clampL = (l, w) => Math.min(Math.max(l, M), Math.max(M, vw - w - M));
  const midY = clampT(rect.top + rect.height / 2 - h / 2);

  // Space beside the anchor on each side. The card may narrow (to MINW) to fit a
  // gap it would otherwise miss — a slightly narrow card beats one sitting on
  // top of the thing it is describing.
  const room = {
    right: vw - M - (rect.right + GAP),
    left:  rect.left - GAP - M,
    below: vh - M - (rect.bottom + GAP),
    above: rect.top - GAP - M
  };
  const w = (side) => Math.min(fullW, Math.max(MINW, room[side]));

  if (room.right >= MINW) return { left: rect.right + GAP, top: midY, width: w("right"), side: "right" };
  if (room.left  >= MINW) return { left: rect.left - GAP - w("left"), top: midY, width: w("left"), side: "left" };
  if (room.below >= h)    return { left: clampL(rect.left, fullW), top: rect.bottom + GAP, width: fullW, side: "below" };
  if (room.above >= h)    return { left: clampL(rect.left, fullW), top: rect.top - GAP - h, width: fullW, side: "above" };

  // The anchor is too big to sit beside — that's a signal the step should point
  // at something smaller. Cover as little of it as possible: take the corner
  // with the most clear space, biased away from the anchor's centre.
  const overlap = (l, t) => Math.max(0, Math.min(l + fullW, rect.right) - Math.max(l, rect.left))
                          * Math.max(0, Math.min(t + h, rect.bottom) - Math.max(t, rect.top));
  const corners = [
    { left: M, top: M }, { left: vw - fullW - M, top: M },
    { left: M, top: vh - h - M }, { left: vw - fullW - M, top: vh - h - M }
  ].map(c => ({ ...c, cost: overlap(c.left, c.top) }));
  const best = corners.sort((a, b) => a.cost - b.cost)[0];
  return { left: best.left, top: best.top, width: fullW, side: "clear" };
}
window.placeTourCard = placeTourCard;

const TOUR_STEPS = [
  { view: null, center: true, icon: "Compass", title: "Welcome — here's the 60-second tour.",
    body: "PhD Navigator isn't a chatbot. It knows your program's milestones, where you are, and what changes when something goes wrong. Let me show you each part." },
  { view: "home", icon: "Home", title: "Home — your command center",
    body: "See how far along you are, what to do next, and a gentle nudge if something's slipping. Start here each day." },
  { view: "plan", icon: "Map", title: "My Plan — everything your plan needs",
    body: "Numbered milestones — 1, 2, 3 — are the big pieces, often months of work. Each breaks into lettered sub-tasks (1a, 1b, 1c): still real work, just smaller and more concrete. Clear the letters and the milestone closes itself." },
  { view: "chat", icon: "MessageCircle", title: "Chat — it already knows your plan",
    body: "Ask anything and the answer is tuned to the milestone you're on. Attach a draft, a handbook page or a screenshot and it reads them before replying." },
  { view: "meetings", icon: "MessageSquare", title: "Meeting Notes — never walk in unprepared",
    body: "Write the agenda first and put it on your calendar — it travels in the invite, so you both know what the meeting is for. Afterwards, record it or paste your notes and you get a summary plus action items that flow into your plan." },
  { view: "skills", icon: "Sparkles", title: "Actions — one job, done properly",
    body: "Each action handles a single visible task — find a literature gap, critique your methods, outline a chapter — and drops the finished result into your Documents." },
  { view: "insights", icon: "Lightbulb", title: "Insights — it composes itself",
    body: "Built fresh from your plan, documents, conversations and check-ins, and deliberately short: what matters this week, not everything it knows. Click any card to see where it came from." },
  { view: "defense", icon: "Presentation", title: "Defense Room — practice under pressure",
    body: "Rehearse your defense, poster session, or research talk. Add your real committee from their public academic profiles, take their questions, and get a debrief at the end." },
  { view: "documents", icon: "FileText", title: "Documents — one shelf for the real things",
    body: "Everything your programme makes you produce, in one place: the forms they emailed you and the drafts your Actions generate. Read them here, compare versions, download the original, or push a copy to Google Docs when you want to write." },
  { view: "wellness", icon: "HeartPulse", title: "Wellbeing — ten seconds a day",
    body: "A quick check-in, private to you and your coach — never your advisor or programme. It's here so a rough patch shows up as a pattern early, with solutions to help you, not a lecture." },
  { view: null, center: true, icon: "Sparkles", title: "That's the tour. You're set.",
    body: "One last thing: if something goes wrong — rejected data, a committee change — just say so in Chat and the plan re-routes around it. You can replay this tour anytime from Settings." }
];

function CoachTour({ onNav, onClose, skillsUnlocked = true }) {
  const [i, setI] = useST(0);
  const [rect, setRect] = useST(null);
  const cardRef = useRT(null);
  // Drop steps for pages that are parked for beta — a tour that navigates to a
  // page the rail doesn't offer strands you somewhere you can't get back to.
  const HIDDEN = new Set(["wellness"].concat(skillsUnlocked ? [] : ["skills"]));
  const steps = TOUR_STEPS.filter(s => !HIDDEN.has(s.view));
  const step = steps[i];
  const isFirst = i === 0;
  const isLast = i === steps.length - 1;

  // navigate to the step's page so it's shown live behind the tour
  useET(() => { if (step.view) onNav(step.view); }, [i]);

  // measure the highlighted rail item after navigation settles.
  // Uses setTimeout (not rAF) so it still fires when the tab is unfocused/throttled.
  useLT(() => {
    const measure = () => {
      if (step.center || !step.view) { setRect(null); return; }
      const el = document.querySelector(`[data-tour="${step.view}"]`);
      setRect(el ? el.getBoundingClientRect() : null);
    };
    measure();
    const t1 = setTimeout(measure, 60);
    const t2 = setTimeout(measure, 240);
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => { clearTimeout(t1); clearTimeout(t2); window.removeEventListener("resize", measure); window.removeEventListener("scroll", measure, true); };
  }, [i]);

  const next = () => { if (isLast) finish(); else setI(i + 1); };
  const back = () => setI(Math.max(0, i - 1));
  const finish = () => { try { localStorage.setItem(TOUR_KEY, "1"); } catch (e) {} onClose(); };

  // card position: beside the rail item on whichever side has room, else centered
  let cardStyle, side = "";
  if (rect) {
    const pos = placeTourCard(rect, cardRef.current);
    side = pos.side;
    cardStyle = { position: "fixed", left: pos.left, top: pos.top, width: pos.width };
  } else {
    cardStyle = { position: "fixed", left: "50%", top: "50%", transform: "translate(-50%,-50%)" };
  }

  return (
    <div className="tour-root">
      {!rect && <div className="tour-dim" onClick={finish} />}
      {rect && (
        <div className="tour-ring" style={{ left: rect.left - 5, top: rect.top - 5, width: rect.width + 10, height: rect.height + 10 }} />
      )}
      <div ref={cardRef} className={`tour-card ${rect ? "anchored" : "centered"}`} style={cardStyle}>
        {side === "right" && <span className="tour-arrow" />}
        <div className="tour-card-top">
          <span className="tour-ico"><IcoT name={step.icon} size={17} /></span>
          <span className="tour-step-count">{i === 0 ? "Welcome" : isLast ? "Done" : `${i} of ${steps.length - 2}`}</span>
          <button className="tour-skip" onClick={finish} title="Skip tour"><IcoT name="X" size={15} /></button>
        </div>
        <h3 className="tour-title display">{step.title}</h3>
        <p className="tour-body">{step.body}</p>
        <div className="tour-dots">
          {steps.map((_, k) => <span key={k} className={k === i ? "on" : ""} onClick={() => setI(k)} />)}
        </div>
        <div className="tour-actions">
          <button className="btn ghost sm" onClick={finish}>Skip</button>
          <div style={{ display: "flex", gap: 8 }}>
            {!isFirst && <button className="btn sm" onClick={back}><IcoT name="ArrowLeft" size={13} /> Back</button>}
            <button className="btn primary sm" onClick={next}>
              {isLast ? <><IcoT name="Check" size={14} color="#fff" /> Get started</> : isFirst ? <>Start tour <IcoT name="ArrowRight" size={14} color="#fff" /></> : <>Next <IcoT name="ArrowRight" size={14} color="#fff" /></>}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

window.CoachTour = CoachTour;
window.COACH_TOUR_KEY = TOUR_KEY;
window.COACH_TOUR_STEPS = TOUR_STEPS; // reused by the Settings Help center
