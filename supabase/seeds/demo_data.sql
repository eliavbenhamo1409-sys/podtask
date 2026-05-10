-- Demo seed: one institution, one course, three published assignments.
-- Run via: supabase MCP execute_sql, or apply_migration.
-- Replace the demo student id below with your test user id (from auth.users)
-- to enroll them in the course.

insert into public.institutions (id, name, slug)
values
  ('00000000-0000-0000-0000-000000000001', 'Northstar University', 'northstar')
on conflict (id) do nothing;

insert into public.courses (id, institution_id, name, code, semester, lecturer_name)
values
  ('00000000-0000-0000-0000-000000000010',
   '00000000-0000-0000-0000-000000000001',
   'מדיניות ציבורית 301',
   'PUB301',
   '2026-spring',
   'פרופ׳ אלינור הרטוול')
on conflict (id) do nothing;

insert into public.assignments (id, course_id, title, description, instructions, due_at, status, language, interview_duration_minutes)
values
  ('00000000-0000-0000-0000-000000000100',
   '00000000-0000-0000-0000-000000000010',
   'מדיניות אקלים וכלכלה התנהגותית',
   'נייר עמדה על מדיניות אקלים וכלכלה התנהגותית.',
   'כתבי נייר עמדה באורך של כ־1,500 מילים שינתח כיצד כלכלה התנהגותית יכולה לשפר את ההשתתפות בתוכניות תמחור פחמן.',
   now() + interval '1 day',
   'published',
   'he',
   12),
  ('00000000-0000-0000-0000-000000000101',
   '00000000-0000-0000-0000-000000000010',
   'סמליות בספרות המאה ה־20',
   'ניתוח סמלים בארבעה רומנים מרכזיים מהמאה ה־20.',
   'בחרי שני רומנים מרשימת הקריאה ונתחי שלוש סצנות סמליות.',
   now() + interval '4 days',
   'published',
   'he',
   15),
  ('00000000-0000-0000-0000-000000000102',
   '00000000-0000-0000-0000-000000000010',
   'דינמיקת זורמים — דוח מעבדה 3',
   'דוח מעבדה על ניסוי 3 ביציבות זרימה.',
   'תארי את ההגדרה הניסיונית, גזרי את משוואת היציבות, והשוויי לתוצאות שהתקבלו במעבדה.',
   now() + interval '6 days',
   'published',
   'he',
   10)
on conflict (id) do nothing;

-- After creating a test user via Supabase Auth, run:
--   insert into public.course_members (course_id, user_id, role) values
--     ('00000000-0000-0000-0000-000000000010', '<auth-user-id>', 'student');
