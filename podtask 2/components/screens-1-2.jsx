// Screens 1-2: Dashboard + Assignment Details (Hebrew RTL)
function Dashboard({ go }) {
  const assignments = [
    { id:'a1', title:'מדיניות אקלים וכלכלה התנהגותית', course:'מדיניות ציבורית 301', due:'מחר · 23:59', status:'next', estTime:'12 דק׳', progress:0 },
    { id:'a2', title:'סמליות בספרות המאה ה־20', course:'ספרות אנגלית 240', due:'בעוד 4 ימים', status:'todo', estTime:'15 דק׳', progress:0 },
    { id:'a3', title:'דינמיקת זורמים — דוח מעבדה 3', course:'פיזיקה 220', due:'בעוד 6 ימים', status:'todo', estTime:'10 דק׳', progress:0 },
    { id:'a4', title:'אסטרטגיית שיווק — חקר מקרה', course:'מנהל עסקים 180', due:'הוגש ב־28.4', status:'done', estTime:'14 דק׳', progress:100 },
  ];
  const next = assignments[0];

  return (
    <div className="screen">
      <Blobs/>
      <TopBar onHome={() => go('dashboard')}/>
      <div className="page" style={{position:'relative', zIndex:1}}>
        <div className="eyebrow"><span className="dot"/>שלום שחזרת</div>
        <h1 className="display">היי מאיה — הראיון הבא שלך<br/>מוכן כשתהיי מוכנה.</h1>
        <p className="subtitle" style={{maxWidth:580}}>שלוש מטלות מחכות. הראשונה לוקחת רק כשתים־עשרה דקות — שיחה רגועה בסגנון פודקאסט עם המנחה החכם שלך.</p>

        {/* Next Assignment Card */}
        <div className="card-hero mt-10" style={{padding:'40px', position:'relative'}}>
          <div style={{position:'absolute', top:32, left:32}} className="badge badge-pink"><span className="dot"/>הגשה מחר</div>

          <div style={{display:'grid', gridTemplateColumns:'1fr 360px', gap:40, alignItems:'center'}}>
            <div>
              <div className="eyebrow"><Icon.spark size={14}/> הבא בתור</div>
              <h2 className="title mt-2" style={{fontSize:34}}>{next.title}</h2>
              <div className="row gap-4 mt-2 text-muted" style={{fontSize:14, fontWeight:500}}>
                <span>{next.course}</span>
                <span>·</span>
                <span className="row gap-2"><Icon.clock/> ראיון של {next.estTime}</span>
              </div>
              <p className="subtitle mt-4" style={{maxWidth:480}}>תעלי טיוטה, ה־AI יקרא אותה, ואז תקיימו שיחה קולית רגועה על הרעיונות שלך.</p>
              <div className="row gap-3 mt-6">
                <button className="btn btn-primary btn-lg" onClick={() => go('details', next)}>
                  המשך מטלה <span className="icon-flip"><Icon.arrow/></span>
                </button>
                <button className="btn btn-secondary btn-lg">צפייה בהוראות</button>
              </div>
            </div>

            {/* Decorative orb preview */}
            <div style={{position:'relative', height:280, display:'flex', alignItems:'center', justifyContent:'center'}}>
              <div style={{position:'absolute', inset:0, background:'radial-gradient(circle at 50% 50%, rgba(125,211,252,0.18), transparent 70%)', borderRadius:'50%'}}/>
              <div className="glow-orb" style={{width:200, height:200, animation:'spin 14s linear infinite, float 4s ease-in-out infinite'}}/>
              <div style={{position:'absolute', bottom:6, left:0, right:0, textAlign:'center'}}>
                <div className="chip chip-cyan" style={{fontSize:11}}>
                  <Icon.wave/> המנחה מתחמם
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* All assignments */}
        <div className="row between mt-12">
          <h2 className="title">כל המטלות</h2>
          <div className="row gap-2">
            <button className="chip chip-cyan">הכל · 4</button>
            <button className="chip">בתהליך</button>
            <button className="chip">הושלמו</button>
          </div>
        </div>

        <div className="mt-6" style={{display:'grid', gridTemplateColumns:'repeat(2, 1fr)', gap:20}}>
          {assignments.map(a => <AssignmentCard key={a.id} a={a} onOpen={() => go('details', a)} />)}
        </div>
      </div>
    </div>
  );
}

function AssignmentCard({ a, onOpen }) {
  const statusBadge = a.status === 'next' ?
    <div className="badge badge-cyan"><span className="dot"/>הבא בתור</div> :
    a.status === 'done' ?
    <div className="badge badge-mint"><Icon.check size={12}/>הושלם</div> :
    <div className="badge badge-neutral"><Icon.cal size={11}/>מתוזמן</div>;

  return (
    <div className="card" style={{padding:28, transition:'transform .25s, box-shadow .25s', cursor:'pointer'}} onClick={onOpen}
         onMouseEnter={e=>{e.currentTarget.style.transform='translateY(-3px)'; e.currentTarget.style.boxShadow='0 30px 80px rgba(15,23,42,0.10), 0 0 30px rgba(125,211,252,0.18)';}}
         onMouseLeave={e=>{e.currentTarget.style.transform=''; e.currentTarget.style.boxShadow='';}}>
      <div className="row between">
        {statusBadge}
        <span className="icon-flip"><Icon.arrow/></span>
      </div>
      <h3 style={{margin:'18px 0 6px', fontSize:19, fontWeight:800, letterSpacing:'-0.01em', lineHeight:1.3}}>{a.title}</h3>
      <div className="text-muted" style={{fontSize:13, fontWeight:500}}>{a.course}</div>
      <div className="row gap-4 mt-6" style={{fontSize:13, color:'var(--ink-2)', fontWeight:600}}>
        <span className="row gap-2"><Icon.cal/>{a.due}</span>
        <span style={{color:'var(--line)'}}>·</span>
        <span className="row gap-2"><Icon.clock/>{a.estTime}</span>
      </div>
    </div>
  );
}

// ----- Assignment Details -----
function AssignmentDetails({ go, ctx }) {
  const a = ctx || { title:'מדיניות אקלים וכלכלה התנהגותית', course:'מדיניות ציבורית 301', due:'מחר · 23:59', estTime:'12 דק׳'};
  const steps = [
    { num:'01', label:'העלאה', desc:'הגישי את הטיוטה (PDF, DOCX או טקסט).', icon: <Icon.upload/> },
    { num:'02', label:'ניתוח', desc:'ה־AI קורא את העבודה ומאתר את הרעיונות המרכזיים.', icon: <Icon.spark/> },
    { num:'03', label:'ראיון פודקאסט', desc:'שיחה קולית רגועה — בערך 12 דקות.', icon: <Icon.mic/> },
    { num:'04', label:'סיום', desc:'זהו. אישור ההגשה יישלח אלייך במייל.', icon: <Icon.check/> },
  ];

  return (
    <div className="screen">
      <Blobs/>
      <TopBar onHome={() => go('dashboard')}/>
      <div className="page" style={{position:'relative', zIndex:1}}>
        <button className="btn btn-ghost row gap-2" onClick={() => go('dashboard')} style={{padding:'8px 0', marginBottom:8}}>
          <span className="icon-flip"><Icon.back/></span> חזרה ללוח הבקרה
        </button>

        <div style={{display:'grid', gridTemplateColumns:'1.2fr 1fr', gap:32, alignItems:'start'}}>
          {/* RIGHT (in RTL: appears first) — details */}
          <div className="card" style={{padding:40}}>
            <div className="badge badge-cyan"><span className="dot"/>הבא בתור · הגשה {a.due}</div>
            <h1 className="title mt-4" style={{fontSize:34}}>{a.title}</h1>
            <div className="text-muted mt-2" style={{fontSize:15, fontWeight:500}}>{a.course} · פרופ׳ אלינור הרטוול</div>

            <div className="row gap-3 mt-6" style={{flexWrap:'wrap'}}>
              <div className="chip"><Icon.clock/> ~ראיון של {a.estTime}</div>
              <div className="chip"><Icon.doc/> נדרשת טיוטה</div>
              <div className="chip">3 נושאים</div>
            </div>

            <div style={{height:1, background:'var(--line)', margin:'28px 0'}}/>

            <h3 style={{fontSize:16, fontWeight:800, letterSpacing:'-0.01em', margin:0}}>הוראות</h3>
            <p className="subtitle mt-2" style={{fontSize:15}}>
              כתבי נייר עמדה באורך של כ־1,500 מילים שינתח כיצד כלכלה התנהגותית יכולה לשפר את ההשתתפות בתוכניות תמחור פחמן. הסתמכי על לפחות שלושה מקרים אמיתיים מהעשור האחרון.
            </p>
            <p className="subtitle mt-4" style={{fontSize:15}}>
              בראיון, המנחה החכם יבקש ממך להוביל את הטיעון, להגן על המקורות, ולחקור יחד עמדה נגדית. תהיי מוכנה לחשוב בקול רם — זה כל הסיפור.
            </p>

            <div className="card mt-6" style={{padding:20, background:'rgba(246,251,255,0.7)', boxShadow:'none', borderRadius:20}}>
              <div className="row gap-3">
                <div style={{width:36, height:36, borderRadius:12, background:'linear-gradient(135deg, #7DD3FC, #38BDF8)', display:'flex', alignItems:'center', justifyContent:'center', color:'white', flexShrink:0}}><Icon.spark size={18}/></div>
                <div>
                  <div style={{fontWeight:800, fontSize:14}}>טיפ מהמרצה</div>
                  <div className="text-muted" style={{fontSize:13, marginTop:4, lineHeight:1.55}}>אל תשנני תשובות. הראיון מתגמל חשיבה אמיתית — הפסקות, תיקוני כיוון, ו"רגע, אני חושבת מחדש" — כולם סימנים טובים.</div>
                </div>
              </div>
            </div>
          </div>

          {/* LEFT — what happens next */}
          <div className="card-hero" style={{padding:32, position:'sticky', top:100}}>
            <div className="eyebrow"><Icon.spark size={14}/> מה קורה עכשיו</div>
            <h3 style={{fontSize:22, fontWeight:800, letterSpacing:'-0.02em', margin:'10px 0 24px'}}>ארבעה שלבים. רובם פשוט שיחה.</h3>

            <div className="flex-col gap-4">
              {steps.map((s,i) => (
                <div key={i} className="row gap-4" style={{padding:'14px 16px', borderRadius:18, background: i===0 ? 'rgba(255,255,255,0.95)' : 'rgba(255,255,255,0.55)', border:'1px solid rgba(230,238,247,0.7)'}}>
                  <div style={{width:44, height:44, borderRadius:14, display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0,
                    background: i===0 ? 'linear-gradient(135deg, #38BDF8, #0EA5E9)' : 'rgba(246,251,255,0.9)',
                    color: i===0 ? 'white' : 'var(--cyan)',
                    boxShadow: i===0 ? '0 10px 24px rgba(14,165,233,0.3)' : 'none'
                  }}>{s.icon}</div>
                  <div>
                    <div style={{fontSize:11, fontWeight:700, letterSpacing:'0.16em', color: i===0 ? 'var(--cyan)' : 'var(--muted)'}}>שלב {s.num}</div>
                    <div style={{fontWeight:800, fontSize:15, margin:'2px 0 2px'}}>{s.label}</div>
                    <div className="text-muted" style={{fontSize:13, lineHeight:1.4}}>{s.desc}</div>
                  </div>
                </div>
              ))}
            </div>

            <button className="btn btn-primary btn-lg mt-8" style={{width:'100%'}} onClick={() => go('upload', a)}>
              להתחיל בהעלאה <span className="icon-flip"><Icon.arrow/></span>
            </button>
            <div className="text-muted mt-4" style={{fontSize:12, textAlign:'center'}}>אפשר לעצור ולחזור בכל רגע.</div>
          </div>
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { Dashboard, AssignmentDetails });
