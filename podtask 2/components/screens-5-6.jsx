// Screens 5-6: Lobby + Mic Test (Hebrew RTL)
function InterviewLobby({ go, ctx }) {
  const topics = ['מנגנוני תמחור פחמן', 'דחיפות התנהגותיות', 'מקרי מבחן אמיתיים', 'טיעוני נגד'];
  const tips = [
    { t:'מקום שקט', d:'חדר עם מינימום רעשי רקע — לא צריך אולפן.'},
    { t:'לחשוב בקול', d:'הפסקות, "רגע, אני חושבת מחדש", ופניות צד — הכל מתקבל בברכה.'},
    { t:'בלי לשנן', d:'זו שיחה, לא דקלום. סמכי על הטיוטה שלך.'},
  ];

  return (
    <div className="screen">
      <Blobs variant="studio"/>
      <TopBar onHome={() => go('dashboard')}/>
      <div className="page" style={{position:'relative', zIndex:1}}>
        <div className="row gap-3"><div className="badge badge-cyan"><span className="dot"/>הסטודיו מוכן</div></div>
        <h1 className="display mt-4" style={{fontSize:42}}>הראיון שלך מוכן.</h1>
        <p className="subtitle" style={{maxWidth:580}}>נשמי עמוק. המנחה החכם קרא את הטיוטה והכין שיחה רגועה סביב הרעיונות שלך. בערך שתים־עשרה דקות.</p>

        <div style={{display:'grid', gridTemplateColumns:'1.1fr 1fr', gap:32, marginTop:40, alignItems:'start'}}>
          <div className="card-hero" style={{padding:36, position:'relative', overflow:'hidden'}}>
            <div className="row between">
              <div className="eyebrow"><Icon.mic size={14}/> ראיון פודקאסט</div>
              <div className="chip chip-cyan" style={{fontSize:11}}>~12 דק׳</div>
            </div>

            <div className="row gap-6 mt-8" style={{alignItems:'center'}}>
              <div style={{position:'relative'}}>
                <div className="glow-orb" style={{width:120, height:120}}/>
                <div style={{position:'absolute', bottom:-4, left:-4, width:32, height:32, borderRadius:'50%', background:'white', display:'flex', alignItems:'center', justifyContent:'center', boxShadow:'0 4px 12px rgba(14,165,233,0.3)', color:'var(--cyan)'}}><Icon.spark size={16}/></div>
              </div>
              <div className="flex-1">
                <div style={{fontSize:12, fontWeight:700, color:'var(--cyan)', letterSpacing:'0.18em'}}>המנחה שלך</div>
                <div style={{fontSize:24, fontWeight:800, letterSpacing:'-0.02em', marginTop:4}}>אריה</div>
                <div className="text-muted" style={{fontSize:14, marginTop:2}}>סקרן, סבלני, שואל שאלת המשך אחת טובה.</div>
                <div className="mt-4"><Icon.wave/></div>
              </div>
            </div>

            <div style={{height:1, background:'rgba(230,238,247,0.7)', margin:'28px 0'}}/>

            <div style={{fontSize:13, fontWeight:700, letterSpacing:'0.14em', color:'var(--ink-2)'}}>נדבר על</div>
            <div className="row gap-2 mt-4" style={{flexWrap:'wrap'}}>
              {topics.map(t => <div key={t} className="chip chip-cyan">{t}</div>)}
            </div>

            <div className="mt-8">
              <button className="btn btn-primary btn-lg" style={{width:'100%'}} onClick={() => go('mic', ctx)}>
                <Icon.mic size={18}/> בדיקת מיקרופון והתחלה
              </button>
              <div className="text-muted mt-4" style={{fontSize:12, textAlign:'center'}}>אפשר לעצור או להפסיק בכל רגע.</div>
            </div>
          </div>

          <div>
            <div className="card" style={{padding:32}}>
              <div className="eyebrow"><Icon.spark size={14}/> לפני שמתחילים</div>
              <div className="flex-col gap-4 mt-4">
                {tips.map((tip,i) => (
                  <div key={i} className="row gap-4" style={{alignItems:'flex-start'}}>
                    <div style={{width:32, height:32, borderRadius:10, background: i===0 ? 'rgba(125,211,252,0.18)' : i===1 ? 'rgba(253,164,175,0.22)' : 'rgba(186,230,253,0.4)',
                      color: i===1 ? 'var(--pink-deep)' : 'var(--cyan)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:13, fontWeight:800, flexShrink:0}}>{i+1}</div>
                    <div>
                      <div style={{fontWeight:800, fontSize:15}}>{tip.t}</div>
                      <div className="text-muted" style={{fontSize:13, lineHeight:1.5, marginTop:2}}>{tip.d}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="card mt-6" style={{padding:24, background:'rgba(255,241,245,0.6)', boxShadow:'none', borderRadius:24}}>
              <div className="row gap-3">
                <div style={{width:36, height:36, borderRadius:12, background:'rgba(253,164,175,0.3)', color:'var(--pink-deep)', display:'flex', alignItems:'center', justifyContent:'center'}}><Icon.question size={18}/></div>
                <div>
                  <div style={{fontWeight:800, fontSize:14}}>תקועה בשאלה?</div>
                  <div className="text-muted" style={{fontSize:13, marginTop:4, lineHeight:1.5}}>תגידי "אני לא בטוחה" ואריה ינסח מחדש או יעבור הלאה. בלי קנס.</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ----- Mic Test -----
function MicTest({ go, ctx }) {
  const [perm, setPerm] = React.useState('idle');
  const [recording, setRecording] = React.useState(false);
  const [recorded, setRecorded] = React.useState(false);
  const [playing, setPlaying] = React.useState(false);

  return (
    <div className="screen">
      <Blobs/>
      <TopBar onHome={() => go('dashboard')}/>
      <div className="page-narrow" style={{position:'relative', zIndex:1}}>
        <button className="btn btn-ghost row gap-2" onClick={() => go('lobby', ctx)} style={{padding:'8px 0'}}>
          <span className="icon-flip"><Icon.back/></span> חזרה לחדר ההמתנה
        </button>

        <div className="mt-6">
          <div className="eyebrow"><span className="dot"/>בדיקת מיקרופון</div>
          <h1 className="display" style={{fontSize:38}}>נוודא שאריה שומע אותך.</h1>
          <p className="subtitle">הקליטי קליפ קצר ונאזין יחד. לוקח בערך עשר שניות.</p>
        </div>

        <div className="card-hero mt-8" style={{padding:48}}>
          {perm === 'idle' && (
            <div style={{textAlign:'center'}}>
              <div style={{position:'relative', width:120, height:120, margin:'0 auto 24px'}}>
                <div style={{position:'absolute', inset:0, borderRadius:'50%', background:'radial-gradient(circle, rgba(125,211,252,0.3), transparent 70%)', filter:'blur(8px)'}}/>
                <div style={{position:'relative', width:120, height:120, borderRadius:'50%', background:'linear-gradient(135deg, rgba(125,211,252,0.25), rgba(253,164,175,0.25))', display:'flex', alignItems:'center', justifyContent:'center', boxShadow:'0 16px 40px rgba(14,165,233,0.18), inset 0 2px 0 rgba(255,255,255,0.6)'}}>
                  <div style={{width:80, height:80, borderRadius:'50%', background:'white', display:'flex', alignItems:'center', justifyContent:'center', color:'var(--cyan)'}}><Icon.mic size={32}/></div>
                </div>
              </div>
              <h3 style={{fontSize:22, fontWeight:800, letterSpacing:'-0.02em', margin:0}}>אישור גישה למיקרופון</h3>
              <p className="subtitle mt-2" style={{maxWidth:420, margin:'8px auto 0'}}>השמע נשאר במכשיר שלך עד שתשלחי את הראיון. אנחנו אף פעם לא מקליטים בלי הסכמתך.</p>
              <div className="row gap-3 mt-8" style={{justifyContent:'center'}}>
                <button className="btn btn-secondary btn-lg" onClick={() => setPerm('denied')}>לא עכשיו</button>
                <button className="btn btn-primary btn-lg" onClick={() => setPerm('granted')}><Icon.mic size={18}/> אישור מיקרופון</button>
              </div>
            </div>
          )}

          {perm === 'denied' && (
            <div className="card" style={{padding:24, background:'rgba(255,241,245,0.6)', boxShadow:'none', borderRadius:20, textAlign:'center'}}>
              <div style={{fontWeight:800, color:'#BE123C'}}>נדרשת הרשאת מיקרופון</div>
              <div className="text-muted mt-2" style={{fontSize:13}}>צריך לאשר גישה בהגדרות הדפדפן כדי להמשיך.</div>
              <button className="btn btn-primary mt-6" onClick={() => setPerm('granted')}>נסי שוב</button>
            </div>
          )}

          {perm === 'granted' && (
            <div>
              <div className="row between">
                <div className="badge badge-mint"><span className="dot"/>המיקרופון מחובר</div>
                <div className="text-muted" style={{fontSize:13, fontWeight:600}}>ברירת מחדל · מיקרופון של MacBook Pro</div>
              </div>

              <div style={{marginTop:24, padding:'40px 24px', borderRadius:24, background:'rgba(255,255,255,0.7)', border:'1px solid rgba(230,238,247,0.9)',
                boxShadow: recording ? '0 0 40px rgba(251,113,133,0.25), inset 0 1px 0 rgba(255,255,255,0.9)' : '0 0 30px rgba(125,211,252,0.18), inset 0 1px 0 rgba(255,255,255,0.9)',
                textAlign:'center', transition:'box-shadow .4s'}}>
                <div className={recording ? 'wave pink' : 'wave'} style={{justifyContent:'center', height:60, transform:'scale(1.4)'}}>
                  <span/><span/><span/><span/><span/><span/><span/><span/><span/>
                </div>
                <div className="text-muted mt-6" style={{fontSize:13, fontWeight:600}}>
                  {recording ? 'מקליט… אמרי משפט או שניים' : recorded ? `הקלטת בדיקה · ${playing ? 'משמיע עכשיו' : 'לחצי כדי להאזין'}` : 'לחצי על המיקרופון להקלטה קצרה'}
                </div>
              </div>

              <div className="row gap-4 mt-8" style={{justifyContent:'center'}}>
                <button className={`mic-btn ${recording ? 'recording' : ''}`} onClick={() => {
                  if (!recording && !recorded) { setRecording(true); setTimeout(() => { setRecording(false); setRecorded(true); }, 2200); }
                  else if (recording) { setRecording(false); setRecorded(true); }
                }}>
                  {recording ? <Icon.x size={24}/> : <Icon.mic size={28}/>}
                </button>
                {recorded && (
                  <button className="btn btn-secondary btn-lg" onClick={() => { setPlaying(true); setTimeout(()=>setPlaying(false), 2200); }}>
                    {playing ? <><Icon.pause/> משמיע</> : <><Icon.play/> השמעת הקלטה</>}
                  </button>
                )}
                {recorded && (
                  <button className="btn btn-ghost row gap-2" onClick={() => { setRecorded(false); setPlaying(false); }}>
                    <Icon.repeat size={16}/> הקלטה מחדש
                  </button>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="row gap-3 mt-8" style={{justifyContent:'flex-end'}}>
          <button className="btn btn-secondary btn-lg" onClick={() => go('lobby', ctx)}>ביטול</button>
          <button className="btn btn-primary btn-lg" disabled={!recorded}
            style={{opacity: recorded ? 1 : 0.5, pointerEvents: recorded ? 'auto' : 'none'}}
            onClick={() => go('interview', ctx)}>
            התחלת הראיון <span className="icon-flip"><Icon.arrow/></span>
          </button>
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { InterviewLobby, MicTest });
