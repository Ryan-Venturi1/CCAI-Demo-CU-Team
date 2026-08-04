/* coach-page-tours.jsx — Per-page first-view walkthroughs.

   Separate from the app-wide welcome tour (coach-tour.jsx): that one runs once
   across the whole app; THIS one fires the first time you open a specific page
   (Documents, Insights, Skills, Defense Room) and highlights the controls on
   that page in place. Seen-state is per page in localStorage, so each page
   teaches itself exactly once. A question-mark button in the corner replays it.

   Exports window.PageTour (drop <window.PageTour page={currentView} /> in the
   shell) and window.PAGE_TOURS (the step definitions, reused by any help UI).

   Reuses the .tour-* CSS from coach-styles.css so it looks identical to the
   welcome tour. Steps anchor to elements marked data-ptour="<key>" on each
   page; a step whose anchor isn't on screen falls back to a centered card. */

(function () {
  const { useState: usePT, useEffect: useEPT, useLayoutEffect: useLPT, useRef: useRPT } = React;
  const IcoPT = window.Icon;

  const key = (page) => `phd-page-tour-${page}-v2`;   // v2: deeper, how-to walkthroughs
  const seen = (page) => { try { return localStorage.getItem(key(page)) === "1"; } catch (e) { return false; } };
  const markSeen = (page) => { try { localStorage.setItem(key(page), "1"); } catch (e) {} };

  // The app-wide welcome tour outranks these. It walks every page in turn, so a
  // page tour firing underneath it would be two walkthroughs at once — and the
  // shell renders this component before the welcome tour has decided whether to
  // launch, so "is the welcome tour on screen?" is not a safe test on its own.
  // The durable fact is whether the welcome tour has been completed.
  const welcomeDone = () => {
    try { return localStorage.getItem(window.COACH_TOUR_KEY || "phd-coach-tour-done-v1") === "1"; }
    catch (e) { return false; }
  };

  // Each step: { anchor?: "<data-ptour key>", center?: bool, icon, title, body }.
  // anchor missing OR element not found → the card centers itself.
  const PAGE_TOURS = {
    home: [
      { center: true, icon: "Home", title: "Home is where you start each day.",
        body: "Everything here answers one question: what should I do today? Progress up top, the week's work in the middle, and a nudge if something is slipping." },
      { anchor: "home-journey", icon: "Map", title: "Your journey, at a glance",
        body: "The whole PhD as one line, with where you are marked on it. Click any milestone to open it; hide the timeline if you'd rather keep Home short." },
      { anchor: "home-week", icon: "ListChecks", title: "This week is the part that matters",
        body: "Pulled from your current milestone and anything you've committed to elsewhere. Tick things off here and the plan updates itself." }
    ],
    plan: [
      { center: true, icon: "Map", title: "My Plan — everything your plan needs.",
        body: "Numbered milestones (1, 2, 3) are the big pieces, often months of work. Each breaks into lettered sub-tasks (1a, 1b, 1c) — smaller and more concrete, but still real work." },
      { anchor: "plan-spine", icon: "GitBranch", title: "Work down the list",
        body: "Click a milestone to open it, or the caret on its right to show the sub-tasks underneath. Clear the letters and the milestone closes itself." },
      { anchor: "plan-glance", icon: "Flag", title: "Where you stand",
        body: "Milestones done, what you're on now, and the next formal checkpoint. If something goes wrong, “Something came up?” re-routes the plan around it rather than leaving you behind schedule." },
      { anchor: "plan-edit", icon: "Pencil", title: "This plan is yours to change",
        body: "We build the first draft from your programme's requirements — it will not be perfect. “Edit plan” makes everything editable at once: rename the plan or any milestone, drag milestones into the order that actually fits your year, and delete what doesn't apply to you." },
      { anchor: "plan-edit", icon: "Plus", title: "Add what we missed, in bulk if you like",
        body: "“Add section” inserts a milestone wherever you need one. For bigger changes, Export CSV opens your whole plan in a spreadsheet — edit it there and Import CSV replaces the plan with your version. That's the fastest way to bring in a plan your department already gave you." }
    ],
    chat: [
      { center: true, icon: "MessageCircle", title: "Chat already knows your plan.",
        body: "Ask anything and the answer is tuned to the milestone you're on — no need to explain your programme or where you've got to." },
      { anchor: "chat-tools", icon: "Paperclip", title: "Attach whatever it should read",
        body: "A draft, a handbook page, a screenshot of an email. It reads them before replying, and anything useful is remembered for later conversations." }
    ],
    meetings: [
      { center: true, icon: "MessageSquare", title: "Meeting Notes, end to end.",
        body: "One page for the whole loop: set an agenda before you go in, get it onto your calendar, then capture what was said and turn it into work on your plan. Six quick steps." },
      { anchor: "meet-cadence", icon: "Repeat", title: "1. Tell it how often you mean to meet",
        body: "Pick a cadence — every two weeks, 30 days, 60 days. When you drift past it you'll get one nudge with a booking that already has an agenda in it, rather than a guilty reminder." },
      { anchor: "meet-new", icon: "Plus", title: "2. Start a meeting before it happens",
        body: "“New meeting” opens the editor. Fill in who and when at the top — the date and time are what the calendar invite uses, and “Repeats” handles a standing weekly or fortnightly slot." },
      { anchor: "meet-cal", icon: "CalendarPlus", title: "3. Put it on your calendar",
        body: "“Add to my calendar” creates the event if you've connected Google or Outlook; otherwise the Google and Outlook buttons open a pre-filled event you just save. Either way your agenda travels in the event description, so whoever opens the invite can see what the meeting is for." },
      { anchor: "meet-agenda", icon: "ListChecks", title: "4. Build the agenda — or have it drafted",
        body: "Type an item and press Enter to add it. “AI draft from where I am” reads your current milestone and open questions and proposes the agenda for you; keep what's useful, delete the rest. Tick items off during the meeting." },
      { anchor: "meet-notes", icon: "PenLine", title: "5. The notes box is the important one",
        body: "During or after the meeting, write what was discussed, decided and promised — rough is fine, it doesn't need to be prose. This box is also your advisors' memory: everything you put here gets read back in Chat, so the AI knows what your advisor actually said. Prefer not to type? Use “Record meeting” above and let it write the notes and the transcript for you." },
      { anchor: "meet-actions", icon: "CheckSquare", title: "6. Turn talk into tasks",
        body: "“Action-item the meeting” reads your notes and pulls out what you committed to. Send them to your to-do list and they show up in This Week on Home. Every saved meeting also lands in Documents, so there's a written record you can hand to a committee." }
    ],
    wellness: [
      { center: true, icon: "HeartPulse", title: "Ten seconds a day, and it stays private.",
        body: "Only your AI coach sees these check-ins — never your advisor or your programme. They exist so patterns show up before they become problems." },
      { anchor: "well-checkin", icon: "Heart", title: "The check-in is the whole job",
        body: "Mood, energy, stress. Add sleep or hours if you want sharper signal. That's it — no journalling, no essay back at you unless you ask for one." },
      { center: true, icon: "Moon", title: "When a pattern shows up, we offer something concrete",
        body: "Short sleep for a few days running, or stress climbing? You'll get one short prompt with one button — like pushing this week's tasks back a few days. Never a lecture." }
    ],
    documents: [
      { center: true, icon: "FileText", title: "Documents — one shelf for the real things.",
        body: "Everything your programme makes you produce lives here: the forms and handbooks they emailed you, and the drafts your Actions generate. It's also what the AI reads to understand your work." },
      { anchor: "doc-upload", icon: "Upload", title: "1. Put your programme's paperwork in",
        body: "PDF, Word or text. Upload the handbook first if you've got it — that's what Navigator reads to find your real milestones instead of guessing at a generic PhD." },
      { anchor: "doc-dropzone", icon: "UploadCloud", title: "2. Or just drag it here",
        body: "Same thing, fewer clicks. Your original file is always kept exactly as you uploaded it, so you can download the untouched version back at any point." },
      { center: true, icon: "Sparkles", title: "3. It reads what you upload",
        body: "Each document gets analysed for topics and a summary — that's the “AI summary” marker on a card. Upload a newer version of something and it's flagged, so you can compare drafts and see what changed between them." },
      { center: true, icon: "ExternalLink", title: "4. Reading here, writing elsewhere",
        body: "Documents is a shelf, not an editor: preview anything, compare versions, download the original. When you want to actually write, push a copy to Google Docs and work there — the copy on your shelf stays as the record." },
      { center: true, icon: "Wand2", title: "5. Actions land here too",
        body: "Run an Action — chapter outline, methods critique, meeting prep — and the finished draft arrives on this shelf. Saved meetings do the same, so your written trail builds itself as you work." }
    ],
    insights: [
      { center: true, icon: "Lightbulb", title: "Insights composes itself — here's how to read it.",
        body: "Every visit, Navigator scores every metric and every block it could show you — from your plan, documents, conversations and check-ins — and keeps only the eight that earned a place. Nothing here is a number it invented; every figure is computed from your own records." },
      { anchor: "ins-kpis", icon: "Gauge", title: "The four numbers that won",
        body: "A dated deadline outranks a trend. A signal that moved outranks one that sat still. A wellbeing risk outranks a vanity count. If a tile looks alarming, that's the ranking doing its job — it put the thing you'd want to know first." },
      { anchor: "ins-kpis", icon: "MousePointerClick", title: "Click a tile to see its reasoning",
        body: "Every card opens a panel with three things: why it beat the other candidates, a score out of 100, and “What this was built from” — the actual documents, check-ins and meetings behind the number. If you don't trust a figure, that's where you check it." },
      { anchor: "ins-blocks", icon: "LayoutGrid", title: "The blocks are ranked the same way",
        body: "Charts, tables and written reads, chosen against each other rather than shown by default. Tasks inside a block are tickable, and a chart's dashed line is always your own average — not a target somebody set for you." },
      { anchor: "ins-blocks", icon: "Shuffle", title: "Disagree with it and it changes",
        body: "Open any card and hit “Not useful — show something else”. It's dropped and the next-best candidate takes the slot, so the page bends toward what you actually read. The line at the bottom tells you how many candidates were set aside this visit." },
      { center: true, icon: "RefreshCw", title: "There's no refresh button, on purpose",
        body: "The page is composed in the background and rebuilt whenever the system learns something — you log a check-in, save a document, record a meeting. Opening this tab shows you a finished page rather than a loading screen." }
    ],
    skills: [
      { center: true, icon: "Sparkles", title: "Actions create useful outputs.",
        body: "Each one handles a visible task — find a literature gap, critique your methods, outline a chapter — and puts the result into your Workspace or Documents." },
      { anchor: "sk-search", icon: "Search", title: "Find the right action",
        body: "Search by what you're trying to create, then run the action when you need it." },
      { anchor: "sk-create", icon: "Wand2", title: "Build your own — no code",
        body: "Describe a task in plain words (“review my draft like an NSF panelist”) and we tune a specialized assistant for it. It shows up alongside the rest." }
    ],
    defense: [
      { center: true, icon: "Presentation", title: "Defense Room — rehearse before it counts.",
        body: "A private room to practise the conversations that decide things: your defense, a poster session, a job talk. Nothing here is recorded anywhere your programme can see it." },
      { anchor: "def-mode", icon: "LayoutTemplate", title: "1. Pick what you're practising",
        body: "“Answer questions” drops you into a committee grilling — they ask, you answer, you get scored. “Present your slides” walks your deck slide by slide while recording you, then critiques the delivery. Choose the format too: dissertation defense, poster, or research talk." },
      { anchor: "def-committee", icon: "Users", title: "2. Build the room",
        body: "Add your real committee from their public academic profiles — save as many as you like, then tick up to six for this session. Their published work shapes what they ask, so a methodologist and a theorist won't grill you the same way. Click a saved name to review what we found." },
      { anchor: "def-materials", icon: "Upload", title: "3. Give them something to read",
        body: "Upload your slides or your draft. Questions are generated from your actual material, not from a generic list — the more you give it, the more the questions sound like the ones you'll really get." },
      { anchor: "def-start", icon: "Play", title: "4. Turn on Voice and start",
        body: "Voice reads the questions aloud, which is most of the difficulty in a real defense. Answer by typing or by microphone. Take your time — this is the room for stumbling." },
      { center: true, icon: "ClipboardCheck", title: "5. Read the debrief",
        body: "At the end you get coverage and gaps: which questions you handled, which you dodged, and where an answer was thin. Practise the same set again and you can watch the gaps close." }
    ]
  };

  // Which pages carry the floating "?" replay button. Home, My Plan and Chat run
  // their tour on first visit but keep no button afterwards — they're the screens
  // people live in, and a permanent FAB there competes with real content (My Plan
  // already has "Something came up?" anchored bottom-right).
  const FAB_PAGES = new Set(["meetings", "insights", "defense", "documents"]);   // wellness parked for beta

  function PageTour({ page }) {
    const steps = PAGE_TOURS[page] || null;
    // showing: null = decide on mount; true = running; false = done/dismissed.
    const [showing, setShowing] = usePT(null);
    const [i, setI] = usePT(0);
    const [rect, setRect] = usePT(null);
    const [pageBroken, setPageBroken] = usePT(false);
    const cardRef = useRPT(null);

    // Decide whether to auto-run whenever the page changes. Auto-run only after
    // the welcome tour is done; the "?" button still works before then, so the
    // walkthrough is reachable, just never uninvited.
    useEPT(() => {
      setI(0); setRect(null);
      if (!steps || seen(page) || !welcomeDone()) { setShowing(false); return; }
      // A beat, so it never appears in the same frame the welcome tour tears down.
      const t = setTimeout(() => setShowing(true), 400);
      return () => clearTimeout(t);
    }, [page]);

    const step = (showing && steps) ? steps[i] : null;
    const isLast = steps ? i === steps.length - 1 : false;

    // Measure the anchored element after the page settles. setTimeout (not rAF)
    // so it still fires when the tab is throttled — same approach as the welcome tour.
    useLPT(() => {
      if (!step) return;
      const find = () => (step.center || !step.anchor)
        ? null : document.querySelector(`[data-ptour="${step.anchor}"]`);
      const measure = () => { const el = find(); setRect(el ? el.getBoundingClientRect() : null); };

      // Bring the anchor into view once per step. A card pointing at something
      // below the fold is worse than no card at all — you get a highlight ring
      // you cannot see. This must happen HERE, on step change, and never inside
      // measure(): measure also runs on scroll, so scrolling from it would loop.
      const el = find();
      if (el) {
        const r = el.getBoundingClientRect();
        const hidden = r.top < 72 || r.bottom > window.innerHeight - 72;
        if (hidden) {
          try { el.scrollIntoView({ behavior: "smooth", block: "center" }); }
          catch (e) { el.scrollIntoView(); }
        }
      }

      measure();
      // 60/260 catch layout settling; 620 catches the end of a smooth scroll,
      // which is when the rect we actually want to position against is final.
      const timers = [60, 260, 620].map(ms => setTimeout(measure, ms));
      window.addEventListener("resize", measure);
      window.addEventListener("scroll", measure, true);
      return () => {
        timers.forEach(clearTimeout);
        window.removeEventListener("resize", measure);
        window.removeEventListener("scroll", measure, true);
      };
    }, [showing, i, step]);

    // While the page is reporting a failure, the walkthrough button stands down.
    // Offering "here's how this works" next to "this didn't work" reads badly,
    // and the error is the thing that needs the attention.
    useEPT(() => {
      const look = () => setPageBroken(!!document.querySelector("[data-page-error]"));
      look();
      const t = setInterval(look, 800);
      return () => clearInterval(t);
    }, [page]);

    if (!steps) return null;

    const finish = () => { markSeen(page); setShowing(false); };
    const replay = () => { setI(0); setRect(null); setShowing(true); };
    const next = () => { if (isLast) finish(); else setI(i + 1); };
    const back = () => setI(Math.max(0, i - 1));

    // When not running, the walkthrough sits behind a single question mark —
    // the universal "what is this?" affordance, so it needs no label to read.
    if (!showing) {
      if (!FAB_PAGES.has(page) || pageBroken) return null;
      return (
        <button className="ptour-replay" onClick={replay}
          title={`Replay the ${page} walkthrough`} aria-label={`Replay the ${page} walkthrough`}>
          ?
        </button>
      );
    }

    // Placement is shared with the welcome tour: pick the first side that has
    // real room instead of forcing "right" and clamping into the anchor.
    let cardStyle, side = "";
    if (rect && window.placeTourCard) {
      const pos = window.placeTourCard(rect, cardRef.current);
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
            <span className="tour-ico"><IcoPT name={step.icon} size={17} /></span>
            <span className="tour-step-count">{isLast ? "Last tip" : `${i + 1} of ${steps.length}`}</span>
            <button className="tour-skip" onClick={finish} title="Dismiss"><IcoPT name="X" size={15} /></button>
          </div>
          <h3 className="tour-title display">{step.title}</h3>
          <p className="tour-body">{step.body}</p>
          <div className="tour-dots">
            {steps.map((_, k) => <span key={k} className={k === i ? "on" : ""} onClick={() => setI(k)} />)}
          </div>
          <div className="tour-actions">
            <button className="btn ghost sm" onClick={finish}>Skip</button>
            <div style={{ display: "flex", gap: 8 }}>
              {i > 0 && <button className="btn sm" onClick={back}><IcoPT name="ArrowLeft" size={13} /> Back</button>}
              <button className="btn primary sm" onClick={next}>
                {isLast ? <><IcoPT name="Check" size={14} color="#fff" /> Got it</> : <>Next <IcoPT name="ArrowRight" size={14} color="#fff" /></>}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  window.PageTour = PageTour;
  window.markPageTourSeen = markSeen;
  window.PAGE_TOURS = PAGE_TOURS;
})();
