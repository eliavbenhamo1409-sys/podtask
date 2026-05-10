// Screens 7-8: Live Interview + Complete (Hebrew RTL)
function InterviewRoom({ go, ctx }) {
  const questions = [
    { q: "בואי נתחיל ברוחב — מה משך אותך לכלכלה התנהגותית בתור עדשה למדיניות אקלים?", topic: 'פתיחה' },
    { q: "את מצטטת את מס הפחמן של בריטיש קולומביה כהצלחה. מה בעיצוב שלו עזר לו לשרוד פוליטית?", topic: 'מקרה מבחן 1' },
    { q: "איפה את רואה את טיעון הנגד החזק ביותר לגישה מבוססת הדחיפות שלך?", topic: 'עמדה נגדית' },
    { q: "אם היית צריכה לעצב מחדש אחת מהתוכניות האלה ממחר, מה היית משנה קודם?", topic: 'סינתזה' },
  ];
  const [qi, setQi] = React.useState(0);
  const [recording, setRecording] = React.useState(false);
  const [aiSpeaking, setAiSpeaking] = React.useState(true);
  const [elapsed, setElapsed] = React.useState(0);
  const [paused, setPaused] = React.useState(false);

  React.useEffect(() => {
    if (paused) return;
    const t = setInterval(() => setElapsed(e => e + 1), 1000);
    return () => clearInterval(t);
  }, [paused]);

  React.useEffect(() => {
    setAiSpeaking(true);
    const t = setTimeout(() => setAiSpeaking(false), 2400);
    return () => clearTimeout(t);
  }, [qi]);

  const fmt = s => `${String(Math.floor(s/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`;
  const next = () => {
    setRecording(false);
    if (qi < questions.length - 1) setQi(qi + 1);
    else go('complete', ctx);
  };

  return (
    <div className="screen" style={{minHeight:'100vh', position:'relative'}}>
      <Blobs variant="studio"/>

      <header className="topbar" style={{padding:'14px 32px'}}>
        <div className="row gap-3">
          <div className="brand-mark" style={{width:32, height:32}}/>
          <div>
            <div style={{fontWeight:800, fontSize:14}}>ראיון חי</div>
            <div className="text-muted" style={{fontSize:11, fontWeight:600}}>מדיניות אקלים וכלכלה התנהגותית</div>
          </div>
        </div>
        <div className="row gap-3">
          <div className="badge badge-pink"><span className="dot" style={{background:'#FB7185', boxShadow:'0 0 8px #FB7185'}}/>מקליט · {fmt(elapsed)}</div>
          <div className="badge badge-neutral">שאלה {qi+1} / {questions.length}</div>
          <button className="btn btn-secondary" style={{padding:'8px 14px', fontSize:13}} onClick={() => go('lobby', ctx)}>סיום מוקדם</button>
        </div>
      </header>

      <div style={{maxWidth:1100, margin:'0 auto', padding:'32px 32px 200px', position:'relative', zIndex:1}}>
        <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:24}}>
          <div className="card-hero" style={{padding:32, position:'relative', overflow:'hidden', minHeight:240}}>
            <div className="row between">
              <div className="eyebrow"><Icon.spark size={14}/> מנחה AI</div>
              {aiSpeaking ? <div className="chip chip-cyan" style={{fontSize:11}}><Icon.wave/> מדבר</div> : <div className="chip" style={{fontSize:11}}>מקשיב</div>}
            </div>
            <div className="row gap-4 mt-6" style={{alignItems:'center'}}>
              <div style={{position:'relative'}}>
                <div className="glow-orb" style={{width:96, height:96, animation: aiSpeaking ? 'spin 4s linear infinite, float 2s ease-in-out infinite' : 'spin 12s linear infinite'}}/>
              </div>
              <div>
                <div style={{fontSize:22, fontWeight:800, letterSpacing:'-0.02em'}}>אריה</div>
                <div className="text-muted" style={{fontSize:13, marginTop:2}}>מנחה הפודקאסט שלך</div>
                {aiSpeaking && <div className="mt-4"><Icon.wave/></div>}
              </div>
            </div>
          </div>

          <div className="card" style={{padding:32, position:'relative', minHeight:240,
            border: recording ? '1.5px solid rgba(125,211,252,0.7)' : '1px solid rgba(230,238,247,0.9)',
            boxShadow: recording ? '0 24px 70px rgba(15,23,42,0.08), 0 0 30px rgba(125,211,252,0.3), inset 0 1px 0 rgba(255,255,255,0.9)' : 'var(--shadow-card)',
            transition:'box-shadow .3s, border .3s'
          }}>
            <div className="row between">
              <div className="eyebrow"><span className="dot"/>את</div>
              {recording ? <div className="chip chip-pink" style={{fontSize:11}}><span style={{width:6, height:6, borderRadius:'50%', background:'var(--pink-deep)', display:'inline-block', boxShadow:'0 0 6px var(--pink-deep)'}}/>מקליט</div> : <div className="chip" style={{fontSize:11}}>בהמתנה</div>}
            </div>
            <div className="row gap-4 mt-6" style={{alignItems:'center'}}>
              <div style={{width:96, height:96, borderRadius:'50%', background:'linear-gradient(135deg, #FDA4AF, #7DD3FC)', display:'flex', alignItems:'center', justifyContent:'center', color:'white', fontWeight:800, fontSize:32, boxShadow:'0 12px 30px rgba(14,165,233,0.2)'}}>מ</div>
              <div>
                <div style={{fontSize:22, fontWeight:800, letterSpacing:'-0.02em'}}>מאיה ריברה</div>
                <div className="text-muted" style={{fontSize:13, marginTop:2}}>{recording ? 'משתפת את המחשבות' : 'קחי את הזמן'}</div>
                {recording && <div className="mt-4"><div className="wave pink"><span/><span/><span/><span/><span/><span/><span/><span/><span/></div></div>}
              </div>
            </div>
          </div>
        </div>

        <div className="card mt-8" style={{padding:'40px 44px', borderRadius:32, position:'relative',
          border: '1px solid rgba(125,211,252,0.5)',
          boxShadow:'0 30px 80px rgba(15,23,42,0.08), 0 0 40px rgba(125,211,252,0.18), inset 0 1px 0 rgba(255,255,255,0.9)'
        }}>
          <div className="row between">
            <div className="eyebrow"><Icon.question size={14}/> {questions[qi].topic} · שאלה {qi+1}</div>
            <div className="row gap-2">
              {questions.map((_,i) => <div key={i} style={{width:24, height:4, borderRadius:2, background: i < qi ? 'var(--cyan)' : i === qi ? 'linear-gradient(90deg, #38BDF8, #0EA5E9)' : 'var(--line)'}}/>)}
            </div>
          </div>
          <div key={qi} className="fade-up" style={{fontSize:26, fontWeight:700, lineHeight:1.5, letterSpacing:'-0.015em', marginTop:18, color:'var(--ink)'}}>
            "{questions[qi].q}"
          </div>
          <div className="text-muted mt-6 row gap-4" style={{fontSize:13, fontWeight:600}}>
            <span className="row gap-2"><Icon.clock/> מומלץ ~2 דק׳</span>
            <span style={{color:'var(--line)'}}>·</span>
            <span>קחי הפסקות. חשבי בקול.</span>
          </div>
        </div>
      </div>

      <div style={{position:'fixed', bottom:0, left:0, right:0, zIndex:10}}>
        <div style={{maxWidth:1100, margin:'0 auto', padding:'20px 32px 28px'}}>
          <div className="card" style={{padding:'16px 20px', borderRadius:28, display:'flex', alignItems:'center', justifyContent:'space-between', boxShadow:'0 24px 70px rgba(15,23,42,0.10), 0 0 0 1px rgba(230,238,247,0.9), inset 0 1px 0 rgba(255,255,255,0.9)', background:'rgba(255,255,255,0.92)'}}>
            <div className="row gap-2">
              <button className="btn btn-secondary" style={{padding:'12px 16px', fontSize:13}}><Icon.repeat size={16}/> חזרה על השאלה</button>
              <button className="btn btn-secondary" style={{padding:'12px 16px', fontSize:13}} onClick={() => setPaused(p=>!p)}>
                {paused ? <><Icon.play/> המשך</> : <><Icon.pause/> השהיה</>}
              </button>
            </div>

            <div className="row gap-4" style={{alignItems:'center'}}>
              <button className="btn btn-ghost" style={{fontSize:13}}>אני לא בטוחה</button>
              <button className={`mic-btn ${recording ? 'recording' : ''}`} onClick={() => setRecording(r => !r)} style={{width:72, height:72}}>
                {recording ? <div style={{width:18, height:18, borderRadius:4, background:'white'}}/> : <Icon.mic size={26}/>}
              </button>
              <button className="btn btn-primary" style={{padding:'14px 22px', fontSize:14}} onClick={next}>
                {qi === questions.length - 1 ? 'סיום ראיון' : 'סיום תשובה'} <span className="icon-flip"><Icon.arrow/></span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ----- Complete -----
function InterviewComplete({ go, ctx }) {
  return (
    <div className="screen">
      <Blobs/>
      <TopBar onHome={() => go('dashboard')}/>
      <div className="page-narrow" style={{position:'relative', zIndex:1, paddingTop:60}}>
        <div className="card-hero" style={{padding:'56px 48px', textAlign:'center'}}>
          <div style={{position:'relative', width:160, height:160, margin:'0 auto 32px'}}>
            <div style={{position:'absolute', inset:0, borderRadius:'50%', background:'radial-gradient(circle, rgba(125,211,252,0.4), transparent 70%)', filter:'blur(12px)'}}/>
            <div style={{position:'absolute', inset:-12, borderRadius:'50%', border:'1px solid rgba(125,211,252,0.4)', animation:'pulse-ring 2.4s ease-out infinite'}}/>
            <div style={{position:'absolute', inset:-12, borderRadius:'50%', border:'1px solid rgba(253,164,175,0.4)', animation:'pulse-ring 2.4s ease-out infinite', animationDelay:'1.2s'}}/>
            <div style={{position:'relative', width:160, height:160, borderRadius:'50%', background:'linear-gradient(135deg, #38BDF8, #0EA5E9)', display:'flex', alignItems:'center', justifyContent:'center', color:'white',
              boxShadow:'0 24px 60px rgba(14,165,233,0.4), inset 0 4px 0 rgba(255,255,255,0.4)'}}>
              <Icon.check size={64}/>
            </div>
          </div>

          <div className="eyebrow" style={{justifyContent:'center'}}><span className="dot"/>נשלח</div>
          <h1 className="display mt-4" style={{fontSize:42}}>הראיון הושלם.</h1>
          <p className="subtitle" style={{maxWidth:480, margin:'0 auto'}}>עבודה יפה, מאיה. השיחה נשמרה ונשלחה לפרופ׳ הרטוול. תקבלי תשובה תוך חמישה ימי עסקים.</p>

          <div className="card mt-10" style={{padding:24, background:'rgba(246,251,255,0.7)', boxShadow:'none', borderRadius:24, textAlign:'center'}}>
            <div style={{display:'grid', gridTemplateColumns:'repeat(3, 1fr)', gap:24}}>
              <div>
                <div className="text-muted" style={{fontSize:11, fontWeight:700, letterSpacing:'0.16em'}}>משך</div>
                <div style={{fontSize:22, fontWeight:800, marginTop:4, letterSpacing:'-0.02em'}}>11:42</div>
              </div>
              <div>
                <div className="text-muted" style={{fontSize:11, fontWeight:700, letterSpacing:'0.16em'}}>שאלות</div>
                <div style={{fontSize:22, fontWeight:800, marginTop:4, letterSpacing:'-0.02em'}}>4 / 4</div>
              </div>
              <div>
                <div className="text-muted" style={{fontSize:11, fontWeight:700, letterSpacing:'0.16em'}}>נשלח</div>
                <div style={{fontSize:22, fontWeight:800, marginTop:4, letterSpacing:'-0.02em'}}>הרגע</div>
              </div>
            </div>
          </div>

          <div className="row gap-3 mt-10" style={{justifyContent:'center'}}>
            <button className="btn btn-secondary btn-lg row gap-2"><Icon.download/> הורדת אישור</button>
            <button className="btn btn-primary btn-lg" onClick={() => go('dashboard')}>
              חזרה ללוח הבקרה <span className="icon-flip"><Icon.arrow/></span>
            </button>
          </div>

          <div className="text-muted mt-8" style={{fontSize:12}}>עותק נשלח גם למייל maya.r@university.edu</div>
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { InterviewRoom, InterviewComplete });
