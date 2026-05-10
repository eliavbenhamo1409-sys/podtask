// Screens 3-4: Upload + Processing (Hebrew RTL)
function UploadAssignment({ go, ctx }) {
  const [file, setFile] = React.useState(null);
  const [drag, setDrag] = React.useState(false);
  const [progress, setProgress] = React.useState(0);
  const inputRef = React.useRef();

  React.useEffect(() => {
    if (file && progress < 100) {
      const t = setTimeout(() => setProgress(p => Math.min(100, p + 8)), 80);
      return () => clearTimeout(t);
    }
  }, [file, progress]);

  const handleFile = (f) => {
    if (!f) return;
    setFile({ name: f.name, size: (f.size/1024).toFixed(0)+' KB' });
    setProgress(0);
  };
  const fakeUpload = () => handleFile({ name: 'climate-policy-draft.pdf', size: 184*1024 });

  return (
    <div className="screen">
      <Blobs/>
      <TopBar onHome={() => go('dashboard')}/>
      <div className="page-narrow" style={{position:'relative', zIndex:1}}>
        <button className="btn btn-ghost row gap-2" onClick={() => go('details', ctx)} style={{padding:'8px 0'}}>
          <span className="icon-flip"><Icon.back/></span> חזרה
        </button>
        <div className="mt-4">
          <Steps current={0} items={['העלאה','ניתוח','ראיון','סיום']}/>
        </div>

        <div className="mt-10">
          <div className="eyebrow"><span className="dot"/>שלב 01 · העלאה</div>
          <h1 className="display" style={{fontSize:40}}>גררי את הטיוטה לכאן.</h1>
          <p className="subtitle">PDF, DOCX או טקסט — עד 25 מ״ב. המנחה החכם יקרא את הקובץ לפני הראיון.</p>
        </div>

        {!file ? (
          <div
            className={`dropzone mt-8 ${drag ? 'drag' : ''}`}
            onDragOver={e => { e.preventDefault(); setDrag(true); }}
            onDragLeave={() => setDrag(false)}
            onDrop={e => { e.preventDefault(); setDrag(false); handleFile(e.dataTransfer.files[0]); }}
            onClick={fakeUpload}
            style={{cursor:'pointer'}}
          >
            <div style={{position:'relative', display:'inline-block'}}>
              <div style={{width:96, height:96, borderRadius:'50%', background:'linear-gradient(135deg, rgba(125,211,252,0.3), rgba(253,164,175,0.3))', display:'flex', alignItems:'center', justifyContent:'center', margin:'0 auto', boxShadow:'0 10px 30px rgba(14,165,233,0.18), inset 0 2px 0 rgba(255,255,255,0.6)'}}>
                <div style={{width:64, height:64, borderRadius:'50%', background:'white', display:'flex', alignItems:'center', justifyContent:'center', color:'var(--cyan)'}}>
                  <Icon.upload size={28}/>
                </div>
              </div>
            </div>
            <div style={{fontSize:20, fontWeight:800, marginTop:20, letterSpacing:'-0.01em'}}>גררי קובץ לכאן</div>
            <div className="text-muted mt-2" style={{fontSize:14}}>או לחצי לבחירה — אנחנו נטפל בשאר</div>
            <div className="row gap-3 mt-6" style={{justifyContent:'center'}}>
              <div className="chip" style={{fontSize:11}}>PDF</div>
              <div className="chip" style={{fontSize:11}}>DOCX</div>
              <div className="chip" style={{fontSize:11}}>TXT</div>
              <div className="chip" style={{fontSize:11}}>עד 25 מ״ב</div>
            </div>
            <input ref={inputRef} type="file" hidden onChange={e=>handleFile(e.target.files[0])}/>
          </div>
        ) : (
          <div className="card mt-8" style={{padding:28}}>
            <div className="row gap-4">
              <div style={{width:56, height:56, borderRadius:16, background:'linear-gradient(135deg, rgba(125,211,252,0.25), rgba(253,164,175,0.25))', display:'flex', alignItems:'center', justifyContent:'center', color:'var(--cyan)', flexShrink:0}}>
                <Icon.doc size={26}/>
              </div>
              <div className="flex-1">
                <div className="row between">
                  <div>
                    <div style={{fontWeight:800, fontSize:16}}>{file.name}</div>
                    <div className="text-muted" style={{fontSize:13, marginTop:2}}>{progress < 100 ? `מעלה · ${progress}%` : `${file.size} · מוכן`}</div>
                  </div>
                  {progress >= 100 ? <div className="badge badge-mint"><Icon.check size={12}/>מוכן</div> : <div className="badge badge-cyan"><span className="dot"/>מעלה</div>}
                </div>
                <div style={{marginTop:14, height:6, background:'var(--line-2)', borderRadius:99, overflow:'hidden'}}>
                  <div style={{height:'100%', width:`${progress}%`, background:'linear-gradient(90deg, #7DD3FC, #0EA5E9)', borderRadius:99, transition:'width .15s'}}/>
                </div>
              </div>
              <button className="btn btn-ghost" onClick={() => { setFile(null); setProgress(0); }}><Icon.x/></button>
            </div>
          </div>
        )}

        <div className="card mt-6" style={{padding:24, boxShadow:'none', background:'rgba(246,251,255,0.6)', borderRadius:24}}>
          <div className="row gap-3" style={{alignItems:'flex-start'}}>
            <div style={{color:'var(--cyan)', marginTop:2}}><Icon.spark size={18}/></div>
            <div className="text-muted" style={{fontSize:13, lineHeight:1.6}}>
              <strong style={{color:'var(--ink)'}}>טיוטה אחת מספיקה.</strong> אין צורך לליטש — ה־AI קורא רעיונות, לא דקדוק. תוכלי להרחיב ולחדד את החשיבה שלך בקול במהלך הראיון.
            </div>
          </div>
        </div>

        <div className="row gap-3 mt-8" style={{justifyContent:'flex-end'}}>
          <button className="btn btn-secondary btn-lg" onClick={() => go('details', ctx)}>שמירה ויציאה</button>
          <button className="btn btn-primary btn-lg" disabled={!file || progress < 100}
                  style={{opacity: (!file || progress < 100) ? 0.5 : 1, pointerEvents: (!file||progress<100) ? 'none' : 'auto'}}
                  onClick={() => go('processing', ctx)}>
            המשך <span className="icon-flip"><Icon.arrow/></span>
          </button>
        </div>
      </div>
    </div>
  );
}

// ----- Processing -----
function Processing({ go, ctx }) {
  const messages = [
    'קוראים את המטלה שלך…',
    'מאתרים את הרעיונות המרכזיים…',
    'מכינים שאלות בסגנון פודקאסט…',
    'מסדרים את חדר הראיון…',
  ];
  const [step, setStep] = React.useState(0);

  React.useEffect(() => {
    if (step < messages.length) {
      const t = setTimeout(() => setStep(step + 1), 1700);
      return () => clearTimeout(t);
    } else {
      const t = setTimeout(() => go('lobby', ctx), 900);
      return () => clearTimeout(t);
    }
  }, [step]);

  return (
    <div className="screen">
      <Blobs variant="studio"/>
      <TopBar onHome={() => go('dashboard')}/>
      <div className="page-narrow" style={{position:'relative', zIndex:1, paddingTop:60}}>
        <div className="card-hero" style={{padding:'56px 48px', textAlign:'center'}}>
          <div className="eyebrow" style={{justifyContent:'center'}}><Icon.spark size={14}/> ה־AI מתכונן</div>
          <h1 className="title mt-4" style={{fontSize:32}}>רגע — המנחה קורא את העבודה.</h1>
          <p className="subtitle">בדרך כלל זה לוקח כשלושים שניות.</p>

          <div style={{position:'relative', width:280, height:280, margin:'48px auto'}}>
            <div style={{position:'absolute', inset:0, borderRadius:'50%', border:'1px solid rgba(125,211,252,0.4)', animation:'pulse-ring 2.4s ease-out infinite'}}/>
            <div style={{position:'absolute', inset:0, borderRadius:'50%', border:'1px solid rgba(253,164,175,0.4)', animation:'pulse-ring 2.4s ease-out infinite', animationDelay:'1.2s'}}/>
            <div className="glow-orb" style={{width:200, height:200, position:'absolute', top:'50%', left:'50%', transform:'translate(-50%,-50%)', animation:'spin 10s linear infinite, float 4s ease-in-out infinite'}}/>
            {[...Array(6)].map((_,i)=>(
              <div key={i} style={{position:'absolute', width:6, height:6, borderRadius:'50%', background:'var(--pink-soft)', boxShadow:'0 0 10px var(--pink-soft)',
                top: `${50 + 45*Math.sin(i*Math.PI/3)}%`, left: `${50 + 45*Math.cos(i*Math.PI/3)}%`, animation:`float ${2+i*0.3}s ease-in-out infinite`, animationDelay:`${i*0.2}s`}}/>
            ))}
          </div>

          <div style={{minHeight:32}}>
            {messages.map((m,i) => (
              i === step ? <div key={i} className="fade-up" style={{fontSize:17, fontWeight:600, color:'var(--ink-2)'}}>{m}</div> :
              i < step ? null : null
            ))}
            {step >= messages.length && <div className="fade-up row gap-2" style={{justifyContent:'center', fontSize:17, fontWeight:700, color:'var(--cyan)'}}><Icon.check/> מוכן. פותחים את הסטודיו…</div>}
          </div>

          <div className="mt-10">
            <Steps current={Math.min(step, 3)} items={['קריאה','מתווה','שאלות','סטודיו']}/>
          </div>
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { UploadAssignment, Processing });
