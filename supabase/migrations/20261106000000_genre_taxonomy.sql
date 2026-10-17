-- Platform-wide channel genres are versioned reference data. They are exposed
-- only through the definer RPC below so every workspace classifies against the
-- same immutable version.
--
-- IAB IDs were resolved against the official Content Taxonomy 3.1 TSV at:
-- https://github.com/InteractiveAdvertisingBureau/Taxonomies/blob/de75783684ec6c6f91ee0591bcba16827482d412/Content%20Taxonomies/Content%20Taxonomy%203.1.tsv
-- Commit: de75783684ec6c6f91ee0591bcba16827482d412

create table public.genre_taxonomy_versions (
  version int primary key check (version > 0),
  published_at timestamptz not null default now(),
  notes text
);

create table public.genre_taxonomy (
  version int not null references public.genre_taxonomy_versions(version),
  key text not null check (key ~ '^[a-z][a-z0-9_]{0,39}$'),
  parent_key text null,
  level smallint not null check (level between 1 and 3),
  name_ar text not null check (length(name_ar) between 1 and 80),
  name_en text not null check (length(name_en) between 1 and 80),
  description text not null check (length(description) between 1 and 400),
  iab_id text null,
  position int not null,
  primary key (version, key),
  foreign key (version, parent_key)
    references public.genre_taxonomy(version, key),
  check ((level = 1) = (parent_key is null))
);

create function private.enforce_genre_taxonomy_parent_level()
returns trigger
language plpgsql
security invoker
set search_path = '' as $$
declare
  parent_level smallint;
begin
  if new.parent_key is not null then
    select parent.level
      into parent_level
      from public.genre_taxonomy parent
     where parent.version = new.version
       and parent.key = new.parent_key;

    if parent_level is not null and new.level <> parent_level + 1 then
      raise exception 'invalid_genre_parent_level' using errcode = '23514';
    end if;
  end if;

  if exists (
    select 1
      from public.genre_taxonomy child
     where child.version = new.version
       and child.parent_key = new.key
       and child.level <> new.level + 1
  ) then
    raise exception 'invalid_genre_parent_level' using errcode = '23514';
  end if;

  return new;
end
$$;

create constraint trigger genre_taxonomy_parent_level
after insert or update on public.genre_taxonomy
deferrable initially immediate
for each row execute function private.enforce_genre_taxonomy_parent_level();

alter table public.genre_taxonomy_versions enable row level security;
alter table public.genre_taxonomy enable row level security;
revoke all on table public.genre_taxonomy_versions from public, anon, authenticated;
revoke all on table public.genre_taxonomy from public, anon, authenticated;
revoke all on function private.enforce_genre_taxonomy_parent_level()
  from public, anon, authenticated;

insert into public.genre_taxonomy_versions(version, notes)
values (1, 'v1: level 1, owner-approved 2026-10-17');

insert into public.genre_taxonomy(
  version, key, parent_key, level, name_ar, name_en, description, iab_id, position
)
values
  (1, 'entertainment', null, 1, 'ترفيه', 'Entertainment',
    'برامج ومقاطع تسلية وتحديات ومقالب ومسابقات وبرامج حوارية خفيفة', 'JLBCU7', 1),
  (1, 'comedy', null, 1, 'كوميديا', 'Comedy',
    'محتوى ساخر أو كوميدي: سكتشات، ستاند أب، محاكاة ساخرة', null, 2),
  (1, 'education', null, 1, 'تعليم', 'Education',
    'شرح دروس ومهارات ولغات ومناهج دراسية ومعرفة عامة', '132', 3),
  (1, 'news_politics', null, 1, 'أخبار وشؤون عامة', 'News & Politics',
    'أخبار وتحليل سياسي واقتصادي وشؤون محلية ودولية', null, 4),
  (1, 'religion', null, 1, 'دين وروحانيات', 'Religion & Spirituality',
    'دروس دينية وتلاوة وفتاوى ومواعظ ومحتوى روحي', '453', 5),
  (1, 'sports', null, 1, 'رياضة', 'Sports',
    'كرة القدم والرياضات الأخرى: تحليل ونتائج وملخصات وأخبار أندية', '483', 6),
  (1, 'gaming', null, 1, 'ألعاب', 'Gaming',
    'ألعاب الفيديو: لعب مباشر، مراجعات، رياضات إلكترونية', '680', 7),
  (1, 'food', null, 1, 'طبخ وطعام', 'Food & Drink',
    'وصفات وطبخ ومطاعم وتذوق طعام', '210', 8),
  (1, 'technology', null, 1, 'تقنية', 'Technology',
    'أجهزة وبرمجيات ومراجعات تقنية وذكاء اصطناعي وإنترنت', '596', 9),
  (1, 'kids_family', null, 1, 'أطفال وعائلة', 'Kids & Family',
    'محتوى للأطفال وأناشيد ورسوم وتربية وحياة عائلية', null, 10),
  (1, 'beauty_fashion', null, 1, 'جمال وموضة', 'Beauty & Fashion',
    'مكياج وعناية بالبشرة وأزياء وتسوّق ملابس', '552', 11),
  (1, 'business_finance', null, 1, 'مال وأعمال', 'Business & Finance',
    'ريادة أعمال واستثمار وتسويق ومال شخصي وعملات', '52', 12),
  (1, 'health_fitness', null, 1, 'صحة ولياقة', 'Health & Fitness',
    'صحة ونصائح طبية عامة وتغذية ورياضة بدنية وحميات', '223', 13),
  (1, 'travel', null, 1, 'سفر', 'Travel',
    'رحلات ووجهات وتجارب سفر وسياحة', '653', 14),
  (1, 'automotive', null, 1, 'سيارات', 'Automotive',
    'سيارات ودراجات: مراجعات وتعديل وأخبار وقيادة', '1', 15),
  (1, 'music', null, 1, 'موسيقى', 'Music',
    'أغانٍ وموسيقى وأداء وإنتاج موسيقي ومراجعات', null, 16),
  (1, 'lifestyle_vlogs', null, 1, 'لايف ستايل وفلوقات', 'Lifestyle & Vlogs',
    'يوميات شخصية وفلوقات وحياة منزلية وروتين', null, 17),
  (1, 'documentary_history', null, 1, 'وثائقي وتاريخ', 'Documentary & History',
    'وثائقيات وتاريخ وقصص حقيقية وجرائم وحضارات', null, 18);

create function public.genre_taxonomy(p_version int default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = '' as $$
declare
  selected_version int;
  result jsonb;
begin
  selected_version := p_version;
  if selected_version is null then
    select max(v.version)
      into selected_version
      from public.genre_taxonomy_versions v;
  end if;

  if not exists (
    select 1
      from public.genre_taxonomy_versions v
     where v.version = selected_version
  ) then
    raise exception 'invalid_input' using errcode = '22023';
  end if;

  select jsonb_build_object(
    'version', selected_version,
    'genres', coalesce(
      jsonb_agg(
        jsonb_build_object(
          'key', genre.key,
          'parent_key', genre.parent_key,
          'level', genre.level,
          'name_ar', genre.name_ar,
          'name_en', genre.name_en,
          'description', genre.description,
          'iab_id', genre.iab_id,
          'position', genre.position
        ) order by genre.level, genre.position
      ),
      '[]'::jsonb
    )
  )
    into result
    from public.genre_taxonomy genre
   where genre.version = selected_version;

  return result;
end
$$;

revoke all on function public.genre_taxonomy(int) from public, anon;
grant execute on function public.genre_taxonomy(int) to authenticated, service_role;
