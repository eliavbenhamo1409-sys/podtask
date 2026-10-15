-- TEMPORARY load-test helpers for `load/e2e.ts` (NOT a migration).
--
-- Run this file with the Supabase MCP `execute_sql` before a production load
-- test and run the DROP block at the end afterwards. Private schema, revoked
-- from every API role, so nothing here is reachable through PostgREST.
--
--   select count(*) from private.loadtest_provision('<tag>', '<test user uuid>', <n>,
--          'in_progress' | 'ready', <mock: true>, 'he', 'good' | 'wrong' | 'mixed' | 'arabic', <mock ms per call>);
--   select private.loadtest_cleanup('<tag>');
--
-- provision: one institution `loadtest-<tag>` with N assignments (consent and
-- camera off), each with a submission, a 5-question plan, document parse /
-- chunk / analysis, an interview owned by the test user and, for
-- `in_progress`, a stored host + student transcript. With p_mock the
-- assignments are added to `grading_config.engine.mock_assignment_ids`, so
-- the outbox trigger queues their grading jobs on the server-side mock model
-- (zero model spend). cleanup: removes the tag's events, usage logs, capacity
-- slots and mock ids, then deletes the institution (cascade).
--
-- Drop afterwards:
--   drop function private.loadtest_provision(text, uuid, integer, text, boolean, text, text, integer);
--   drop function private.loadtest_cleanup(text);
create or replace function private.loadtest_provision(
  p_tag text, p_user uuid, p_n integer, p_status text, p_mock boolean,
  p_language text default 'he', p_answer_set text default 'good', p_mock_delay_ms integer default 2000
)
returns table(interview_id uuid, assignment_id uuid)
language plpgsql
security definer
set search_path = public, private
as $fn$
declare
  v_inst uuid; v_course uuid; v_asg uuid; v_sub uuid; v_iv uuid; v_start timestamptz; i integer; k integer;
  v_plan jsonb; v_doc text; v_answers text[]; v_ids uuid[] := '{}';
  v_q text[] := array['q1','q2','q3','q4','q5'];
  v_host text[] := array[
    'אנחנו בשאלה הראשונה. ספרי לי בקצרה על נושא העבודה ומדוע בחרת בו.',
    'אנחנו בשאלה השנייה. מה ההבדל בין מס פחמן לבין מערכת מסחר בפליטות, מבחינת איפה נקבעים המחיר והכמות?',
    'אנחנו בשאלה השלישית. על אילו נתונים התבססת?',
    'אנחנו בשאלה הרביעית. איך היית מגיבה לטענה שמערכת מסחר עם פיצוי פחות רגרסיבית?',
    'אנחנו בשאלה החמישית והאחרונה. מה היית משנה בעבודה?'];
begin
  select id into v_inst from institutions where slug = 'loadtest-' || p_tag;
  if v_inst is null then
    insert into institutions (name, slug) values ('LOADTEST ' || p_tag, 'loadtest-' || p_tag) returning id into v_inst;
    insert into courses (institution_id, name, code) values (v_inst, 'LOADTEST ' || p_tag, 'LOADTEST') returning id into v_course;
  else
    select id into v_course from courses where institution_id = v_inst limit 1;
  end if;

  v_plan := jsonb_build_object('questions', jsonb_build_array(
    jsonb_build_object('id','q1','kind','opening','topic','פתיחה','question','ספרי לי בקצרה על נושא העבודה ומדוע בחרת בו.','anchor','','key_points',jsonb_build_array('תמחור פחמן ככלי מדיניות','השוואה בין מס פחמן למערכת מסחר בפליטות','השפעה חלוקתית על משקי בית'),'follow_ups','[]'::jsonb,'recommended_seconds',75),
    jsonb_build_object('id','q2','kind','concept','topic','מושג מרכזי','question','מה ההבדל בין מס פחמן לבין מערכת מסחר בפליטות, מבחינת איפה נקבעים המחיר והכמות?','anchor','מס פחמן קובע מחיר קבוע לטון פליטה ומשאיר את כמות הפליטות לשוק','key_points',jsonb_build_array('מס פחמן: מחיר ידוע מראש, כמות משתנה','מסחר בפליטות: כמות ידועה (תקרה), מחיר משתנה','המחיר במסחר נקבע בשוק ההיתרים'),'follow_ups','[]'::jsonb,'recommended_seconds',75),
    jsonb_build_object('id','q3','kind','evidence','topic','נתונים','question','על אילו נתונים התבססת?','anchor','הנתונים נאספו מהלשכה המרכזית לסטטיסטיקה','key_points',jsonb_build_array('הלשכה המרכזית לסטטיסטיקה','דוחות משרד האנרגיה','השנים 2019 עד 2023'),'follow_ups','[]'::jsonb,'recommended_seconds',75),
    jsonb_build_object('id','q4','kind','counter','topic','טענת נגד','question','איך היית מגיבה לטענה שמערכת מסחר עם פיצוי פחות רגרסיבית?','anchor','מערכת מסחר ללא פיצוי היא רגרסיבית','key_points',jsonb_build_array('פיצוי משנה את ההשפעה החלוקתית','הממצא נוגע למקרה ללא פיצוי','עיצוב ההחזר קובע'),'follow_ups','[]'::jsonb,'recommended_seconds',75),
    jsonb_build_object('id','q5','kind','reflection','topic','השתקפות','question','מה היית משנה בעבודה?','anchor','','key_points',jsonb_build_array('נתונים לפי עשירונים אחרי 2023','הרחבת ההשוואה לכלים נוספים'),'follow_ups','[]'::jsonb,'recommended_seconds',75)
  ));

  if p_answer_set = 'arabic' then
    v_doc := 'في هذا العمل أقارن بين ضريبة الكربون ونظام تداول الانبعاثات. ضريبة الكربون تحدد سعرا ثابتا لكل طن من الانبعاثات وتترك كمية الانبعاثات للسوق، بينما نظام التداول يحدد سقفا للكمية ويترك السعر للسوق. جمعت البيانات من دائرة الإحصاء المركزية ومن تقارير وزارة الطاقة للسنوات من 2019 إلى 2023. النتيجة الرئيسية هي أن ضريبة الكربون مع إعادة مبلغ موحد للأسر تقدمية، بينما نظام التداول بدون تعويض تنازلي لأن الأسر ذات الدخل المنخفض تنفق حصة أكبر من دخلها على الطاقة.';
    v_answers := array[
      'عملي يتناول تسعير الكربون كأداة سياسة عامة، واخترت المقارنة بين ضريبة الكربون ونظام تداول الانبعاثات لأنني أردت أن أفهم من يتحمل العبء بين الأسر الغنية والفقيرة.',
      'ضريبة الكربون تحدد سعرا ثابتا لكل طن من الانبعاثات وتترك كمية الانبعاثات للسوق، بينما نظام التداول يحدد سقفا للكمية ويترك السعر للسوق. جمعت البيانات من دائرة الإحصاء المركزية ومن تقارير وزارة الطاقة',
      'اعتمدت على بيانات دائرة الإحصاء المركزية حول إنفاق الأسر وعلى تقارير وزارة الطاقة من 2019 إلى 2023.',
      'صحيح أن التعويض يغير التأثير التوزيعي، ونتيجتي تتعلق بالحالة بدون تعويض، فمع إعادة مبلغ موحد يمكن أن يصبح النظام تقدميا أيضا.',
      'كنت سأضيف بيانات أحدث حسب العشيرات وأوسع المقارنة لتشمل أدوات أخرى مثل الدعم الأخضر.'];
  else
    v_doc := 'בעבודה זו אני משווה בין מס פחמן לבין מערכת מסחר בפליטות. מס פחמן קובע מחיר קבוע לטון פליטה ומשאיר את כמות הפליטות לשוק, ואילו מערכת מסחר קובעת תקרת כמות ומשאירה את המחיר לשוק. הנתונים נאספו מהלשכה המרכזית לסטטיסטיקה ומדוחות משרד האנרגיה לשנים 2019 עד 2023. הממצא המרכזי הוא שמס פחמן עם החזר כספי אחיד למשקי בית הוא פרוגרסיבי, בעוד שמערכת מסחר ללא פיצוי היא רגרסיבית, כי משקי בית בעשירונים הנמוכים מוציאים חלק גדול יותר מהכנסתם על אנרגיה. המגבלה העיקרית היא היעדר נתונים לפי עשירונים אחרי 2023.';
    if p_answer_set = 'wrong' then
      v_answers := array[
        'העבודה היא על נושא חשוב מאוד בכלכלה, ובחרתי בו כי הוא מעניין ורלוונטי לכולם, ויש בו הרבה היבטים שכדאי לחקור.',
        'ההבדל המרכזי הוא שמס פחמן קובע תקרת כמות לפליטות ומשאיר את המחיר לשוק, בעוד שמערכת מסחר בפליטות קובעת מחיר קבוע לטון פליטה ומשאירה את הכמות לשוק.',
        'השתמשתי בנתונים מהאינטרנט ומכמה מאמרים שמצאתי, בעיקר מ־2010.',
        'אני לא חושבת שפיצוי משנה משהו, מסחר בפליטות תמיד רגרסיבי לא משנה מה עושים עם הכסף, וגם פיצוי הוא מה שהופך אותו לפרוגרסיבי.',
        'הייתי משקיעה יותר זמן ומנסה להיות יותר מדויקת. תמיד אפשר לשפר.'];
    elsif p_answer_set = 'mixed' then
      v_answers := array[
        'העבודה שלי עוסקת בתמחור פחמן ככלי מדיניות ובהשוואה בין מס פחמן למערכת מסחר בפליטות.',
        'במס פחמן המחיר לטון קבוע. במסחר יש תקרה.',
        null,
        'פיצוי יכול לשנות את התוצאה, אבל בעבודה בדקתי רק את המקרה בלי פיצוי.',
        'הייתי מוסיפה נתונים עדכניים יותר לפי עשירונים.'];
    else
      v_answers := array[
        'העבודה שלי עוסקת בתמחור פחמן ככלי מדיניות. בחרתי להשוות בין מס פחמן למערכת מסחר בפליטות כי רציתי להבין את ההשפעה החלוקתית על משקי בית בעשירונים שונים.',
        'מס פחמן קובע מראש את המחיר לכל טון פליטה, והשוק מחליט כמה לפלוט בפועל. במערכת מסחר הממשלה קובעת תקרה לכמות ומחלקת היתרים, והמחיר של ההיתר נקבע במסחר ביניהם, לכן במס בטוחים במחיר ובמסחר בטוחים בכמות.',
        'התבססתי על נתוני הלשכה המרכזית לסטטיסטיקה על הוצאות משקי בית לפי עשירונים ועל דוחות משרד האנרגיה לשנים 2019 עד 2023.',
        'זה נכון שפיצוי משנה את ההשפעה החלוקתית. הממצא שלי נוגע למקרה ללא פיצוי, ועם החזר אחיד גם מסחר יכול להיות פרוגרסיבי, כך שעיצוב ההחזר הוא מה שקובע.',
        'הייתי מוסיפה נתונים עדכניים לפי עשירונים אחרי 2023 ומרחיבה את ההשוואה לכלים נוספים כמו סובסידיות ירוקות.'];
    end if;
  end if;

  for i in 1..p_n loop
    insert into assignments (course_id, title, status, language, settings)
    values (v_course, 'LOADTEST ' || p_tag || ' #' || i, 'published', 'he',
            jsonb_build_object('integrity', jsonb_build_object('require_consent', false, 'camera', 'off', 'activity_monitoring', false, 'host_flags', false)))
    returning id into v_asg;
    insert into submissions (assignment_id, student_id, status, original_filename, mime_type)
    values (v_asg, p_user, 'interview_ready', 'loadtest.txt', 'text/plain') returning id into v_sub;
    v_start := now() - interval '12 minutes';
    insert into interviews (submission_id, assignment_id, student_id, status, language, started_at, metadata)
    values (v_sub, v_asg, p_user, p_status::interview_status, p_language,
            case when p_status = 'in_progress' then v_start else null end,
            case when p_status = 'in_progress' then jsonb_build_object('attempts', 1) else '{}'::jsonb end)
    returning id into v_iv;
    insert into interview_plans (interview_id, model, plan) values (v_iv, 'loadtest', v_plan);
    insert into document_parses (submission_id, provider, markdown, metadata)
    values (v_sub, 'manual_text', v_doc, jsonb_build_object('source', 'raw_text'));
    insert into document_chunks (submission_id, chunk_index, content) values (v_sub, 0, v_doc);
    insert into document_analyses (submission_id, model, summary, main_argument, key_concepts)
    values (v_sub, 'loadtest', 'השוואה בין מס פחמן למערכת מסחר בפליטות ובחינת ההשפעה החלוקתית על משקי בית.',
            'מס פחמן עם החזר אחיד הוא פרוגרסיבי; מסחר ללא פיצוי רגרסיבי.', jsonb_build_array('מס פחמן','מסחר בפליטות','השפעה חלוקתית'));
    if p_status = 'in_progress' then
      for k in 1..5 loop
        insert into interview_messages (interview_id, speaker, message_type, content, plan_question_id, metadata, created_at)
        values (v_iv, 'ai_host', 'question', v_host[k], v_q[k], jsonb_build_object('source','loadtest','client_id','lt-h-'||k), v_start + make_interval(secs => k * 120));
        if p_answer_set = 'mixed' and k = 3 then
          insert into interview_messages (interview_id, speaker, message_type, content, plan_question_id, metadata, created_at)
          values (v_iv, 'system', 'system', 'skipped_question:3', 'q3', jsonb_build_object('source','loadtest'), v_start + make_interval(secs => k * 120 + 10));
        elsif v_answers[k] is not null then
          insert into interview_messages (interview_id, speaker, message_type, content, plan_question_id, metadata, created_at)
          values (v_iv, 'student', 'answer', v_answers[k], v_q[k],
                  jsonb_build_object('source','loadtest','client_id','lt-s-'||k,'latency_ms', 1500 + k * 300, 'speech_ms', 15000),
                  v_start + make_interval(secs => k * 120 + 30));
        end if;
      end loop;
    end if;
    v_ids := v_ids || v_asg;
    interview_id := v_iv; assignment_id := v_asg;
    return next;
  end loop;

  if p_mock then
    update grading_config
    set engine = jsonb_set(
                   jsonb_set(engine, '{mock_assignment_ids}', coalesce(engine->'mock_assignment_ids', '[]'::jsonb) || to_jsonb(v_ids::text[])),
                   '{mock_delay_ms}', to_jsonb(p_mock_delay_ms))
    where id = 1;
  end if;
end;
$fn$;

create or replace function private.loadtest_cleanup(p_tag text)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $fn$
declare
  v_inst uuid; v_interviews uuid[]; v_reports uuid[]; v_asg text[]; n_ev integer; n_logs integer; n_slots integer;
begin
  select id into v_inst from institutions where slug = 'loadtest-' || p_tag;
  if v_inst is null then return jsonb_build_object('found', false); end if;
  select array_agg(i.id), array_agg(i.assignment_id::text) into v_interviews, v_asg
  from interviews i join assignments a on a.id = i.assignment_id join courses c on c.id = a.course_id where c.institution_id = v_inst;
  select array_agg(r.id) into v_reports from reports r where r.interview_id = any(coalesce(v_interviews, '{}'));
  delete from system_events where entity_id = any(coalesce(v_interviews, '{}')) or entity_id = any(coalesce(v_reports, '{}'));
  get diagnostics n_ev = row_count;
  delete from ai_usage_logs where entity_id = any(coalesce(v_interviews, '{}'));
  get diagnostics n_logs = row_count;
  delete from ai_slot_leases where holder = any(select 'interview:' || x::text from unnest(coalesce(v_interviews, '{}')) x);
  get diagnostics n_slots = row_count;
  update grading_config
  set engine = jsonb_set(engine, '{mock_assignment_ids}',
        coalesce((select jsonb_agg(e) from jsonb_array_elements_text(coalesce(engine->'mock_assignment_ids','[]'::jsonb)) e where e <> all(coalesce(v_asg, '{}'))), '[]'::jsonb))
  where id = 1;
  delete from institutions where id = v_inst;  -- cascades courses, assignments, submissions, interviews and everything under them
  return jsonb_build_object('found', true, 'interviews', coalesce(array_length(v_interviews, 1), 0), 'system_events', n_ev, 'usage_logs', n_logs, 'slots', n_slots);
end;
$fn$;

revoke all on function private.loadtest_provision(text, uuid, integer, text, boolean, text, text, integer) from public, anon, authenticated;
revoke all on function private.loadtest_cleanup(text) from public, anon, authenticated;
