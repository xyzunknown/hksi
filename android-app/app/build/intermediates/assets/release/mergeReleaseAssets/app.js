(function () {
  'use strict';

  const DATA = window.HKSI_DATA;
  const app = document.getElementById('app');
  const toastEl = document.getElementById('toast');
  const letters = ['A', 'B', 'C', 'D'];
  const qById = new Map(DATA.questions.map((q) => [String(q.id), q]));
  const chapterById = new Map(DATA.chapters.map((c) => [Number(c.id), c]));
  const nativeCallbacks = new Map();
  let toastTimer = null;
  let lastHash = '';
  let quizSession = null;
  let lastResult = null;
  let examTimer = null;
  let aiQuestionId = null;
  let aiLoading = false;
  let aiError = '';
  let aiAnswer = '';
  let flashIndex = 0;
  let flashRevealed = false;
  let libraryTab = 'wrong';
  let practiceConfig = { mode: 'smart', count: 15, chapter: 'all' };

  const defaultState = () => ({
    qstats: {}, wrong: {}, stars: {}, flags: {}, notes: {}, days: {}, mockHistory: [],
    totals: { seen: 0, correct: 0 }, lastRead: { ch: 1, sec: DATA.chapters[0].sections[0].num },
    aiCache: {}, sync: { endpoint: '', code: '', on: false, last: 0 }, lastModified: Date.now()
  });

  function loadState() {
    try {
      const stored = JSON.parse(localStorage.getItem('hksi_mobile_state_v1') || 'null');
      return Object.assign(defaultState(), stored || {});
    } catch (_) { return defaultState(); }
  }

  let state = loadState();
  let syncTimer = null;

  function saveState(schedule = true) {
    state.lastModified = Date.now();
    localStorage.setItem('hksi_mobile_state_v1', JSON.stringify(state));
    if (schedule && state.sync.on && state.sync.endpoint && state.sync.code) {
      clearTimeout(syncTimer);
      syncTimer = setTimeout(() => syncNow(true), 3000);
    }
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>'"]/g, (char) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
    }[char]));
  }

  function richText(value) {
    return escapeHtml(value || '暂无详细解析。').replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/\n/g, '<br>');
  }

  function icon(name, size = 21) {
    const paths = {
      home: '<path d="M3 11 12 3l9 8v10h-6v-6H9v6H3z"/>',
      book: '<path d="M4 4.5A2.5 2.5 0 0 1 6.5 2H20v17H6.5A2.5 2.5 0 0 0 4 21.5z"/><path d="M4 4.5v17"/>',
      quiz: '<path d="M5 3h14v18H5z"/><path d="M8 8h8M8 12h5M8 16h3"/>',
      user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
      sync: '<path d="M20 7h-5V2"/><path d="M20 7a8 8 0 0 0-14.7-2M4 17h5v5"/><path d="M4 17a8 8 0 0 0 14.7 2"/>',
      arrow: '<path d="m15 18-6-6 6-6"/>',
      check: '<path d="m5 12 4 4L19 6"/>',
      offline: '<path d="M3 15h13a4 4 0 0 0 .8-7.9A6 6 0 0 0 5.2 9 3 3 0 0 0 3 15z"/><path d="m3 3 18 18"/>',
      clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
      cards: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="m9 8 3-2 3 2M9 16l3 2 3-2"/>',
      chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
      note: '<path d="M4 3h16v18H4z"/><path d="M8 8h8M8 12h8M8 16h5"/>',
      star: '<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9z"/>',
      flag: '<path d="M5 22V3M5 4h12l-2 4 2 4H5"/>',
      ai: '<path d="M12 3 9.8 8.8 4 11l5.8 2.2L12 19l2.2-5.8L20 11l-5.8-2.2z"/>',
      send: '<path d="m22 2-7 20-4-9-9-4zM22 2 11 13"/>',
      lock: '<rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
      copy: '<rect x="8" y="8" width="11" height="11" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/>',
      info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/>',
      key: '<circle cx="8" cy="15" r="4"/><path d="m11 12 9-9M15 8l3 3M17 6l3 3"/>',
      download: '<path d="M12 3v12M7 10l5 5 5-5M4 21h16"/>',
      more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>'
    };
    return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.info}</svg>`;
  }

  function showToast(message) {
    clearTimeout(toastTimer);
    toastEl.textContent = message;
    toastEl.classList.add('show');
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2300);
  }

  function openConfirm(title, message, confirmText, onConfirm) {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', title);
    overlay.innerHTML = `<div class="modal-sheet"><h2>${escapeHtml(title)}</h2><p>${escapeHtml(message)}</p><div class="modal-actions"><button class="secondary" data-modal-cancel>再检查一下</button><button class="primary" data-modal-confirm>${escapeHtml(confirmText)}</button></div></div>`;
    document.body.appendChild(overlay);
    const close = () => overlay.remove();
    overlay.querySelector('[data-modal-cancel]').addEventListener('click', close);
    overlay.addEventListener('click', (event) => { if (event.target === overlay) close(); });
    overlay.querySelector('[data-modal-confirm]').addEventListener('click', () => { close(); onConfirm(); });
    overlay.querySelector('[data-modal-confirm]').focus();
  }

  function routeInfo() {
    const raw = (location.hash || '#home').slice(1);
    const [route, query = ''] = raw.split('?');
    return { route: route || 'home', params: new URLSearchParams(query) };
  }

  function navigate(route, params, replace) {
    const query = params ? '?' + new URLSearchParams(params).toString() : '';
    const target = '#' + route + query;
    if (replace) history.replaceState(null, '', target);
    else location.hash = target;
    if (replace) render();
  }

  function topbar(title, back = 'home', right = '') {
    return `<header class="topbar"><button class="icon-button" data-nav="${back}" aria-label="返回">${icon('arrow')}</button><h1>${escapeHtml(title)}</h1><div class="right-slot">${right}</div></header>`;
  }

  function bottomNav(active) {
    const items = [['home', '首页', 'home'], ['chapters', '学习', 'book'], ['practice', '刷题', 'quiz'], ['settings', '我的', 'user']];
    return `<nav class="bottom-nav" aria-label="主导航">${items.map(([route, label, ico]) => `<button class="${active === route ? 'active' : ''}" data-nav="${route}" aria-label="${label}">${icon(ico)}<span>${label}</span></button>`).join('')}</nav>`;
  }

  function shell(content, nav, noNav) {
    return `<div class="app-shell${noNav ? ' no-nav' : ''}"><main id="main" class="screen">${content}</main>${noNav ? '' : bottomNav(nav)}</div>`;
  }

  function questionsForChapter(ch) { return DATA.questions.filter((q) => Number(q.chId) === Number(ch)); }
  function answeredCount() { return Object.keys(state.qstats || {}).length; }
  function accuracy() { return state.totals.seen ? Math.round(state.totals.correct / state.totals.seen * 100) : 0; }
  function todayKey() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
  function dueCount() { return Math.max(8, Math.min(50, Object.keys(state.wrong || {}).length || 12)); }
  function sectionBy(ch, sec) { return (chapterById.get(Number(ch)) || DATA.chapters[0]).sections.find((s) => s.num === sec) || DATA.chapters[0].sections[0]; }

  function renderHome() {
    const last = state.lastRead || { ch: 1, sec: DATA.chapters[0].sections[0].num };
    const chapter = chapterById.get(Number(last.ch)) || DATA.chapters[0];
    const section = sectionBy(chapter.id, last.sec);
    const completion = Math.min(100, Math.round(answeredCount() / DATA.totals.questions * 100));
    const syncLabel = state.sync.on ? '已连接' : '仅本机';
    const content = `<section class="home-hero">
      <div class="brand-row"><div class="brand"><div class="brand-mark">卷一</div><div><strong>HKSI 学习助手</strong><span>Android 离线版</span></div></div><button class="sync-pill" data-nav="sync">${icon('sync',14)}${syncLabel}</button></div>
      <div class="hero-copy"><p class="eyebrow">今天的学习</p><h1>把复杂规则，练成稳定得分。</h1><p>${DATA.totals.questions} 道题已随安装包下载</p></div>
    </section>
    <div class="offline-strip">${icon('check',17)}课程已下载，没有网络也能继续学习</div>
    <div class="content tight">
      <section class="resume"><div class="resume-meta"><span>继续学习 · 第 ${chapter.id} 章</span></div><h2>${escapeHtml(chapter.title)}</h2><p>${escapeHtml(section.num)} · ${escapeHtml(section.title)}</p><div class="progress"><i style="width:${completion}%"></i></div><div class="progress-meta"><span>总进度 ${completion}%</span><span>约 12 分钟</span></div><button class="primary" data-nav="reader" data-params='${JSON.stringify({ ch: chapter.id, sec: section.num })}'>继续阅读 ${icon('book',18)}</button></section>
      <div class="stat-line"><div><strong>${dueCount()}</strong><span>今日待复习</span></div><div><strong>${Object.keys(state.days || {}).length || 1}</strong><span>学习天数</span></div><div><strong>${accuracy()}%</strong><span>累计正确率</span></div></div>
      <div class="section-head"><h2>今天</h2><button class="text-button" data-nav="analytics">查看数据</button></div>
      <div class="task-list">
        <button class="task-row" data-action="quick-practice"><span class="task-icon gold">${icon('quiz')}</span><span class="task-body"><strong>智能复习</strong><span>${dueCount()} 题 · 优先安排错题和薄弱章节</span></span><span class="chev">›</span></button>
        <button class="task-row" data-nav="mock"><span class="task-icon">${icon('clock')}</span><span class="task-body"><strong>模拟考试</strong><span>60 题 · 90 分钟 · 70% 目标线</span></span><span class="chev">›</span></button>
        <button class="task-row" data-nav="flashcards"><span class="task-icon green">${icon('cards')}</span><span class="task-body"><strong>数字速记卡</strong><span>${DATA.totals.flashcards} 张重点卡片</span></span><span class="chev">›</span></button>
        <button class="task-row" data-nav="library"><span class="task-icon">${icon('note')}</span><span class="task-body"><strong>我的资料库</strong><span>错题、收藏、存疑和笔记</span></span><span class="chev">›</span></button>
      </div>
    </div>`;
    return shell(content, 'home');
  }

  function chapterProgress(chapter) {
    const questions = questionsForChapter(chapter.id);
    const done = questions.filter((q) => state.qstats[String(q.id)]).length;
    return questions.length ? Math.round(done / questions.length * 100) : 0;
  }

  function renderChapters() {
    const rows = DATA.chapters.map((chapter) => {
      const progress = chapterProgress(chapter);
      return `<button class="chapter-row" data-nav="chapter" data-params='${JSON.stringify({ id: chapter.id })}'><span class="chapter-num">${chapter.id}</span><span><h3>${escapeHtml(chapter.title)}</h3><p>${chapter.sections.length} 个知识小节 · ${questionsForChapter(chapter.id).length} 道题</p><span class="mini-progress"><i><b style="width:${progress}%"></b></i><span>${progress}%</span></span></span><span class="chev">›</span></button>`;
    }).join('');
    return shell(`${topbar('学习', 'home')}<div class="content"><section class="chapter-summary"><p class="kicker">试卷一 · 9 章</p><h2>按章节掌握监管规则</h2><p>正文、考试重点和练习题都已离线保存。</p></section><div class="chapter-list">${rows}</div></div>`, 'chapters');
  }

  function renderChapter(params) {
    const chapter = chapterById.get(Number(params.get('id'))) || DATA.chapters[0];
    const rows = chapter.sections.map((section) => `<button class="section-row" data-nav="reader" data-params='${JSON.stringify({ ch: chapter.id, sec: section.num })}'><span class="section-number">${escapeHtml(section.num)}</span><span class="task-body"><h3>${escapeHtml(section.title)}</h3><p>${section.questionIds.length ? section.questionIds.length + ' 道章节题' : '阅读知识点'}</p></span><span class="chev">›</span></button>`).join('');
    return shell(`${topbar(`第 ${chapter.id} 章`, 'chapters')}<div class="content"><section class="chapter-summary"><p class="kicker">章节学习</p><h2>${escapeHtml(chapter.title)}</h2><p>${chapter.sections.length} 个知识小节 · ${questionsForChapter(chapter.id).length} 道相关题目</p></section><div class="chapter-list">${rows}</div></div>`, 'chapters');
  }

  function renderReader(params) {
    const ch = Number(params.get('ch') || state.lastRead.ch || 1);
    const sec = params.get('sec') || state.lastRead.sec;
    const chapter = chapterById.get(ch) || DATA.chapters[0];
    const section = sectionBy(chapter.id, sec);
    state.lastRead = { ch: chapter.id, sec: section.num };
    saveState(false);
    const note = state.notes[`section:${chapter.id}:${section.num}`] || '';
    const blocks = `${section.summary ? `<aside class="reader-block"><h3>考试重点</h3><p>${escapeHtml(section.summary)}</p></aside>` : ''}${section.example ? `<aside class="reader-block example"><h3>实际场景</h3><p>${escapeHtml(section.example)}</p></aside>` : ''}`;
    return shell(`${topbar('章节阅读', 'chapter?id=' + chapter.id)}<header class="reader-head"><p class="eyebrow">第 ${chapter.id} 章 · ${escapeHtml(section.num)}</p><h1>${escapeHtml(section.title)}</h1></header><article class="reader-article">${section.html}${blocks}<div class="form-section"><label class="label" for="section-note">离线笔记</label><textarea id="section-note" class="note-area" data-note-key="section:${chapter.id}:${section.num}" placeholder="记录容易混淆的数字、条件或例外…">${escapeHtml(note)}</textarea><p class="helper">笔记只保存在本机；开启同步后会随进度同步。</p></div></article><div class="reader-tools"><button data-action="font-down">小字</button><button data-action="font-up">大字</button><button data-action="save-reader-note">保存笔记</button><button data-action="section-practice" data-ch="${chapter.id}" data-sec="${escapeHtml(section.num)}">练习</button></div>`, null, true);
  }

  function renderPractice() {
    const chapterOptions = DATA.chapters.map((c) => `<option value="${c.id}" ${String(practiceConfig.chapter) === String(c.id) ? 'selected' : ''}>第 ${c.id} 章 · ${escapeHtml(c.title)}</option>`).join('');
    return shell(`${topbar('刷题设置', 'home')}<div class="content"><section class="chapter-summary"><p class="kicker">个人练习</p><h2>按当前状态安排题目</h2><p>答题后立即显示答案、解析和 AI 讲解入口。</p></section>
      <div class="form-section"><h2>练习方式</h2><div class="choice-grid"><button class="chip ${practiceConfig.mode === 'smart' ? 'active' : ''}" data-action="practice-mode" data-value="smart">智能复习</button><button class="chip ${practiceConfig.mode === 'random' ? 'active' : ''}" data-action="practice-mode" data-value="random">随机练习</button><button class="chip ${practiceConfig.mode === 'wrong' ? 'active' : ''}" data-action="practice-mode" data-value="wrong">只练错题</button></div></div>
      <div class="form-section"><h2>题目数量</h2><div class="choice-grid">${[15, 30, 60].map((n) => `<button class="chip ${practiceConfig.count === n ? 'active' : ''}" data-action="practice-count" data-value="${n}">${n} 题</button>`).join('')}</div></div>
      <div class="form-section"><label class="label" for="practice-chapter">章节范围</label><select id="practice-chapter" class="select" data-action="practice-chapter"><option value="all">全部 9 章</option>${chapterOptions}</select><p>智能复习会优先安排答错次数较多和未练习的题目。</p></div>
      <button class="primary" data-action="start-practice">开始 ${practiceConfig.count} 题练习 ${icon('quiz',18)}</button>
    </div>`, 'practice');
  }

  function shuffle(items) {
    const result = items.slice();
    for (let i = result.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [result[i], result[j]] = [result[j], result[i]]; }
    return result;
  }

  function smartSort(items) {
    return items.slice().sort((a, b) => {
      const as = state.qstats[String(a.id)] || { n: 0, c: 0 };
      const bs = state.qstats[String(b.id)] || { n: 0, c: 0 };
      const aw = state.wrong[String(a.id)] ? 4 : 0;
      const bw = state.wrong[String(b.id)] ? 4 : 0;
      const aScore = aw + (as.n ? 1 - as.c / as.n : 2) + Math.random();
      const bScore = bw + (bs.n ? 1 - bs.c / bs.n : 2) + Math.random();
      return bScore - aScore;
    });
  }

  function startPractice(config) {
    let pool = config.chapter === 'all' ? DATA.questions.slice() : questionsForChapter(config.chapter);
    if (config.section) {
      const section = sectionBy(config.chapter, config.section);
      const sectionIds = new Set(section.questionIds);
      pool = pool.filter((q) => sectionIds.has(String(q.id)));
      if (!pool.length) pool = questionsForChapter(config.chapter);
    }
    if (config.mode === 'wrong') {
      const wrong = pool.filter((q) => state.wrong[String(q.id)]);
      if (wrong.length) pool = wrong; else showToast('还没有错题，已改为智能复习');
    }
    pool = config.mode === 'random' ? shuffle(pool) : smartSort(pool);
    const count = Math.min(Number(config.count) || 15, pool.length);
    quizSession = { type: 'practice', ids: pool.slice(0, count).map((q) => String(q.id)), index: 0, selected: '', revealed: false, answered: {} };
    navigate('quiz');
  }

  function currentQuestion() { return quizSession && qById.get(quizSession.ids[quizSession.index]); }

  function recordAnswer(question, selected) {
    const id = String(question.id);
    const ok = selected === question.ans;
    const stat = state.qstats[id] || { n: 0, c: 0, lastTs: 0 };
    stat.n += 1; if (ok) stat.c += 1; stat.lastTs = Date.now(); state.qstats[id] = stat;
    state.totals.seen += 1; if (ok) state.totals.correct += 1;
    if (ok) delete state.wrong[id]; else state.wrong[id] = 1;
    state.days[todayKey()] = (state.days[todayKey()] || 0) + 1;
    saveState();
    return ok;
  }

  function renderQuiz() {
    if (!quizSession || quizSession.type !== 'practice' || !currentQuestion()) return renderPractice();
    const question = currentQuestion();
    const selected = quizSession.selected;
    const revealed = quizSession.revealed;
    const ok = revealed && selected === question.ans;
    const options = question.opts.map((option, index) => {
      const letter = letters[index];
      let cls = selected === letter ? 'selected' : '';
      if (revealed && letter === question.ans) cls = 'correct';
      else if (revealed && selected === letter) cls = 'wrong';
      return `<button class="option ${cls}" data-action="select-option" data-value="${letter}" ${revealed ? 'disabled' : ''}><b>${letter}</b><span>${escapeHtml(option)}</span></button>`;
    }).join('');
    const answer = revealed ? `<section class="answer-panel"><div class="answer-state ${ok ? 'ok' : 'bad'}">${icon(ok ? 'check' : 'info', 23)}${ok ? '回答正确' : `正确答案是 ${question.ans}`}</div><div class="explanation">${richText(question.exp)}</div><div class="utility-row"><button class="${state.stars[String(question.id)] ? 'active' : ''}" data-action="toggle-star">${icon('star', 15)} 收藏</button><button class="${state.flags[String(question.id)] ? 'active' : ''}" data-action="toggle-flag">${icon('flag', 15)} 存疑</button><button data-action="open-ai">${icon('ai', 15)} AI 讲解</button></div></section>` : '';
    const isLast = quizSession.index === quizSession.ids.length - 1;
    return shell(`<div class="quiz-shell"><header class="quiz-meta"><div class="between"><button class="icon-button" data-action="leave-quiz" aria-label="退出练习">${icon('arrow')}</button><span class="quiz-count">第 ${quizSession.index + 1} / ${quizSession.ids.length} 题</span><button class="icon-button ${state.stars[String(question.id)] ? 'active' : ''}" data-action="toggle-star" aria-label="收藏">${icon('star')}</button></div><div class="quiz-progress"><i style="width:${(quizSession.index + 1) / quizSession.ids.length * 100}%"></i></div></header><main class="question-wrap"><p class="question-source">第 ${question.chId} 章 · ${escapeHtml(question.source || '综合题库')}</p><h1>${escapeHtml(question.q)}</h1>${options}${answer}</main><div class="quiz-actions">${revealed ? `<button class="secondary" data-action="open-ai">AI 讲解</button><button class="primary" data-action="next-question">${isLast ? '完成练习' : '下一题'}</button>` : `<button class="primary" data-action="submit-answer" ${selected ? '' : 'disabled'}>提交答案</button>`}</div></div>`, null, true);
  }

  function startMock() {
    const pool = shuffle(DATA.questions);
    quizSession = { type: 'mock', ids: pool.slice(0, 60).map((q) => String(q.id)), index: 0, selected: '', answers: {}, flags: {}, endAt: Date.now() + 90 * 60 * 1000 };
    clearInterval(examTimer);
    examTimer = setInterval(() => {
      if (!quizSession || quizSession.type !== 'mock') return clearInterval(examTimer);
      const el = document.querySelector('.timer');
      if (el) el.textContent = timeRemaining();
      if (Date.now() >= quizSession.endAt) submitMock(true);
    }, 1000);
    navigate('exam');
  }

  function timeRemaining() {
    const remaining = Math.max(0, (quizSession ? quizSession.endAt : 0) - Date.now());
    const seconds = Math.floor(remaining / 1000);
    return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
  }

  function renderMock() {
    return shell(`${topbar('模拟考试', 'home')}<div class="content"><section class="chapter-summary"><p class="kicker">正式模式</p><h2>准备一次完整模拟</h2><p>交卷前不显示答案，计时结束会自动提交。</p></section><div class="stat-line"><div><strong>60</strong><span>题目</span></div><div><strong>90</strong><span>分钟</span></div><div><strong>70%</strong><span>目标线</span></div></div><div class="notice warn">开始后会持续计时。你可以随时打开题号总览，并标记需要复查的题目。</div><button class="primary" data-action="start-mock">阅读规则并开始 ${icon('clock',18)}</button></div>`, 'practice');
  }

  function renderExam() {
    if (!quizSession || quizSession.type !== 'mock' || !currentQuestion()) return renderMock();
    const question = currentQuestion();
    const id = String(question.id);
    const selected = quizSession.answers[id] || '';
    const options = question.opts.map((option, index) => {
      const letter = letters[index];
      return `<button class="option ${selected === letter ? 'selected' : ''}" data-action="exam-option" data-value="${letter}"><b>${letter}</b><span>${escapeHtml(option)}</span></button>`;
    }).join('');
    const answered = Object.keys(quizSession.answers).length;
    return shell(`<div class="quiz-shell"><header class="quiz-meta"><div class="between"><button class="icon-button" data-action="exam-map" aria-label="题号总览">${icon('quiz')}</button><span class="quiz-count">${quizSession.index + 1} / ${quizSession.ids.length} · 已答 ${answered}</span><span class="timer">${timeRemaining()}</span></div><div class="quiz-progress"><i style="width:${answered / quizSession.ids.length * 100}%"></i></div></header><main class="question-wrap"><div class="between"><p class="question-source">第 ${question.chId} 章 · 正式模式</p><button class="text-button" data-action="exam-flag">${quizSession.flags[id] ? '已标记存疑' : '标记存疑'}</button></div><h1>${escapeHtml(question.q)}</h1>${options}</main><div class="quiz-actions"><button class="secondary" data-action="exam-prev" ${quizSession.index === 0 ? 'disabled' : ''}>上一题</button><button class="primary" data-action="exam-next">${quizSession.index === quizSession.ids.length - 1 ? '题号总览' : '下一题'}</button></div></div>`, null, true);
  }

  function renderExamMap() {
    if (!quizSession || quizSession.type !== 'mock') return renderMock();
    const map = quizSession.ids.map((id, index) => `<button class="${quizSession.answers[id] ? 'done' : ''} ${quizSession.flags[id] ? 'flagged' : ''}" data-action="jump-exam" data-index="${index}">${index + 1}</button>`).join('');
    const answered = Object.keys(quizSession.answers).length;
    return shell(`${topbar('题号总览', 'exam')}<div class="content"><section class="chapter-summary"><p class="kicker">剩余时间 ${timeRemaining()}</p><h2>已完成 ${answered} / 60 题</h2><p>深色为已作答，金色下划线为存疑。</p></section><div class="question-map">${map}</div><button class="primary" data-action="submit-mock">确认并交卷</button></div>`, null, true);
  }

  function submitMock() {
    if (!quizSession || quizSession.type !== 'mock') return;
    clearInterval(examTimer);
    let correct = 0;
    quizSession.ids.forEach((id) => {
      const answer = quizSession.answers[id];
      if (answer) { const q = qById.get(id); if (recordAnswer(q, answer)) correct += 1; }
    });
    lastResult = { total: quizSession.ids.length, answered: Object.keys(quizSession.answers).length, correct, ids: quizSession.ids.slice(), answers: { ...quizSession.answers }, ts: Date.now() };
    state.mockHistory.push({ ts: lastResult.ts, correct, total: lastResult.total });
    saveState();
    quizSession = null;
    navigate('result');
  }

  function renderResult() {
    const result = lastResult || state.mockHistory[state.mockHistory.length - 1];
    if (!result) return renderMock();
    const total = result.total || 60;
    const correct = result.correct || 0;
    const score = Math.round(correct / total * 100);
    const passed = score >= 70;
    return shell(`<section class="result-hero"><p class="eyebrow">模拟考试结果</p><div class="score-ring" style="--score:${score * 3.6}deg"><strong>${score}</strong></div><h1>${passed ? '达到目标线' : '距离目标线还差一点'}</h1><p>${passed ? '继续保持稳定正确率。' : '先复习错题，再做一次针对练习。'}</p></section><div class="content"><div class="result-grid"><div><strong>${correct}</strong><span>答对</span></div><div><strong>${total - correct}</strong><span>答错或未答</span></div><div><strong>${score}%</strong><span>正确率</span></div></div><button class="primary" data-nav="library">查看错题资料库</button><button class="secondary" style="width:100%;margin-top:10px" data-nav="home">返回首页</button></div>`, 'practice');
  }

  function hasApiKey() {
    try { return !!(window.HKSI_NATIVE && window.HKSI_NATIVE.hasApiKey()); }
    catch (_) { return false; }
  }

  function renderAI() {
    const question = qById.get(String(aiQuestionId));
    if (!question) return renderSettings();
    const cached = state.aiCache[String(question.id)] || '';
    const message = aiError ? `<div class="ai-message"><strong class="danger">暂时无法生成</strong><br>${escapeHtml(aiError)}</div>` : aiLoading ? `<div class="ai-message loading"><span class="dots"><span></span><span></span><span></span></span> 正在结合题目和已有解析整理答案…</div>` : aiAnswer || cached ? `<div class="ai-message">${richText(aiAnswer || cached)}</div>` : `<div class="ai-message">${richText(question.exp || '这道题暂时没有现成解析。保存 API 密钥后，可以让 AI 根据题干和选项给出详细说明。')}</div>`;
    const keyNotice = hasApiKey() ? '' : `<div class="notice warn" style="margin-bottom:14px">尚未保存 AI 密钥。你仍可查看题库原有解析；需要 AI 讲解时，请先到“AI 设置”保存。</div>`;
    return shell(`${topbar('AI 讲解', 'quiz')}<div class="ai-panel"><div class="ai-orb">${icon('ai',30)}</div><h2>把判断依据说清楚</h2><p>${escapeHtml(question.q)}</p>${keyNotice}${message}${!aiLoading ? `<button class="primary gold" data-action="ask-ai">${hasApiKey() ? '生成更详细的解释' : '前往 AI 设置'}</button>` : ''}</div><div class="ai-compose"><input id="ai-followup" aria-label="追问" placeholder="继续追问：为什么不是其他选项？"><button data-action="ai-followup" aria-label="发送">${icon('send')}</button></div>`, null, true);
  }

  function aiPrompt(question, followup) {
    const options = question.opts.map((option, index) => `${letters[index]}. ${option}`).join('\n');
    return `题目：${question.q}\n${options}\n正确答案：${question.ans}\n题库已有解析：${question.exp || '无'}${followup ? `\n用户追问：${followup}\n此前 AI 回答：${aiAnswer || state.aiCache[String(question.id)] || '无'}` : '\n请给出详细讲解。'}`;
  }

  function nativePromise(method, args) {
    if (!window.HKSI_NATIVE || typeof window.HKSI_NATIVE[method] !== 'function') {
      return new Promise((resolve) => setTimeout(() => resolve(method === 'askAI' ? '结论：应选择题库标注的正确答案。\n\n判断时先抓住题干限定词，再把每个选项与监管职责逐项对应。其他选项通常混入了不属于该机构的职责，或把一般目标写成了法定要求。\n\n记忆方法：先认主体，再认权限，最后检查题目是否问“不是”或“除外”。' : '{}'), 500));
    }
    return new Promise((resolve, reject) => {
      const id = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
      nativeCallbacks.set(id, { resolve, reject });
      window.HKSI_NATIVE[method](id, ...args);
      setTimeout(() => { if (nativeCallbacks.has(id)) { nativeCallbacks.delete(id); reject(new Error('请求超时，请检查网络')); } }, method === 'askAI' ? 70000 : 30000);
    });
  }

  window.HKSI_NATIVE_CALLBACK = function (id, success, payload) {
    const callback = nativeCallbacks.get(id);
    if (!callback) return;
    nativeCallbacks.delete(id);
    if (success) callback.resolve(payload); else callback.reject(new Error(payload));
  };

  async function requestAI(followup) {
    const question = qById.get(String(aiQuestionId));
    if (!question) return;
    if (!hasApiKey() && window.HKSI_NATIVE) return navigate('ai-settings');
    aiLoading = true; aiError = ''; render();
    try {
      const answer = await nativePromise('askAI', [aiPrompt(question, followup)]);
      aiAnswer = answer;
      state.aiCache[String(question.id)] = answer;
      saveState(false);
    } catch (error) { aiError = error.message; }
    aiLoading = false; render();
  }

  function libraryQuestions() {
    let ids = [];
    if (libraryTab === 'wrong') ids = Object.keys(state.wrong || {});
    if (libraryTab === 'star') ids = Object.keys(state.stars || {});
    if (libraryTab === 'flag') ids = Object.keys(state.flags || {});
    return ids.map((id) => qById.get(id)).filter(Boolean);
  }

  function renderLibrary() {
    const questions = libraryQuestions();
    const tabs = [['wrong', '错题'], ['star', '收藏'], ['flag', '存疑'], ['note', '笔记']];
    let body = '';
    if (libraryTab === 'note') {
      const notes = Object.entries(state.notes || {}).filter(([, value]) => String(value).trim());
      body = notes.length ? notes.map(([key, value]) => `<div class="task-row"><span class="task-icon">${icon('note')}</span><span class="task-body"><strong>${escapeHtml(key.startsWith('section:') ? '章节笔记' : '题目笔记')}</strong><span>${escapeHtml(value)}</span></span></div>`).join('') : emptyState('还没有笔记', '在章节阅读或答题时记录容易混淆的内容。');
    } else {
      body = questions.length ? questions.map((q) => `<button class="task-row" data-action="practice-single" data-id="${escapeHtml(String(q.id))}"><span class="task-icon ${libraryTab === 'wrong' ? 'gold' : ''}">${icon(libraryTab === 'star' ? 'star' : libraryTab === 'flag' ? 'flag' : 'quiz')}</span><span class="task-body"><strong>${escapeHtml(q.q)}</strong><span>第 ${q.chId} 章 · 点按重新练习</span></span><span class="chev">›</span></button>`).join('') : emptyState(`还没有${tabs.find((t) => t[0] === libraryTab)[1]}内容`, '学习过程中点按相应标记，之后会集中出现在这里。');
    }
    return shell(`${topbar('我的资料库', 'home')}<div class="content"><div class="tab-strip">${tabs.map(([id, label]) => `<button class="${libraryTab === id ? 'active' : ''}" data-action="library-tab" data-value="${id}">${label}</button>`).join('')}</div><div class="task-list">${body}</div></div>`, 'settings');
  }

  function emptyState(title, copy) { return `<div class="empty"><div class="glyph">${icon('note')}</div><h2>${title}</h2><p>${copy}</p></div>`; }

  function renderFlashcards() {
    const card = DATA.flashcards[flashIndex % DATA.flashcards.length];
    return shell(`${topbar('数字速记卡', 'home')}<div class="content"><section class="chapter-summary"><p class="kicker">${flashIndex + 1} / ${DATA.flashcards.length}</p><h2>先回想，再翻卡确认</h2><p>点按卡片显示来源提示。</p></section><button class="flashcard" data-action="flip-card"><span class="eyebrow">第 ${card.ch || '?'} 章 · ${escapeHtml(card.sec || '重点')}</span><p>${escapeHtml(card.text)}</p><small>${flashRevealed ? '重点内容已显示 · 继续下一张巩固记忆' : '点按翻卡'}</small></button><div class="inline-row" style="gap:9px"><button class="secondary" style="flex:1" data-action="flash-prev">上一张</button><button class="primary" style="flex:2;margin:0" data-action="flash-next">下一张</button></div></div>`, 'chapters');
  }

  function renderAnalytics() {
    const days = [];
    for (let i = 6; i >= 0; i--) { const d = new Date(); d.setDate(d.getDate() - i); const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; days.push({ label: '日一二三四五六'[d.getDay()], value: state.days[key] || 0 }); }
    const max = Math.max(1, ...days.map((d) => d.value));
    const bars = days.map((d) => `<div class="bar"><i style="height:${Math.max(5, d.value / max * 140)}px"></i><span>${d.label}</span></div>`).join('');
    const chapterRows = DATA.chapters.map((c) => {
      const qs = questionsForChapter(c.id); let seen = 0, correct = 0;
      qs.forEach((q) => { const s = state.qstats[String(q.id)]; if (s) { seen += s.n; correct += s.c; } });
      const value = seen ? Math.round(correct / seen * 100) : 0;
      return `<div class="task-row"><span class="chapter-num">${c.id}</span><span class="task-body"><strong>${escapeHtml(c.title)}</strong><span class="mini-progress"><i><b style="width:${value}%"></b></i><span>${value}% 正确率</span></span></span></div>`;
    }).join('');
    return shell(`${topbar('学习数据', 'home')}<div class="content"><div class="stat-line"><div><strong>${state.totals.seen}</strong><span>完成题数</span></div><div><strong>${accuracy()}%</strong><span>正确率</span></div><div><strong>${Object.keys(state.wrong || {}).length}</strong><span>当前错题</span></div></div><div class="section-head"><h2>近 7 日完成题数</h2></div><div class="bar-chart">${bars}</div><div class="section-head"><h2>章节正确率</h2></div><div class="task-list">${chapterRows}</div></div>`, 'settings');
  }

  function renderSettings() {
    const keyReady = hasApiKey();
    return shell(`${topbar('我的', 'home')}<div class="content"><section class="chapter-summary"><p class="kicker">本机学习档案</p><h2>连续学习，记录留在自己手里</h2><p>不需要账号。离线记录保存在这台手机中。</p></section><div class="settings-group"><h2>数据与同步</h2><button class="settings-row" data-nav="sync"><span class="task-icon">${icon('sync')}</span><span class="task-body"><strong>离线与同步</strong><span>${state.sync.on ? '已连接同步码 · ' + state.sync.code : '仅保存在本机'}</span></span><span class="status-badge ${state.sync.on ? 'ok' : ''}">${state.sync.on ? '已开启' : '未开启'}</span></button><button class="settings-row" data-nav="analytics"><span class="task-icon">${icon('chart')}</span><span class="task-body"><strong>学习数据</strong><span>${state.totals.seen} 次答题记录</span></span><span class="chev">›</span></button><button class="settings-row" data-nav="library"><span class="task-icon">${icon('note')}</span><span class="task-body"><strong>错题、收藏和笔记</strong><span>${Object.keys(state.wrong || {}).length} 道错题</span></span><span class="chev">›</span></button></div><div class="settings-group"><h2>AI 与应用</h2><button class="settings-row" data-nav="ai-settings"><span class="task-icon gold">${icon('ai')}</span><span class="task-body"><strong>AI 讲解设置</strong><span>密钥只加密保存在本机</span></span><span class="status-badge ${keyReady ? 'ok' : ''}">${keyReady ? '已配置' : '未配置'}</span></button><button class="settings-row" data-action="reset-data"><span class="task-icon">${icon('more')}</span><span class="task-body"><strong class="danger">清空本机学习记录</strong><span>不会删除安装包内的题库</span></span></button></div><p class="helper" style="text-align:center">HKSI 学习助手 1.0 · ${DATA.totals.questions} 道题 · ${DATA.totals.flashcards} 张速记卡</p></div>`, 'settings');
  }

  function renderAISettings() {
    const configured = hasApiKey();
    return shell(`${topbar('AI 设置', 'settings')}<div class="content"><section class="chapter-summary"><p class="kicker">本机专用</p><h2>${configured ? 'AI 讲解已经可用' : '保存你的 API 密钥'}</h2><p>密钥由安卓系统加密，只保存在这台手机里，不会写进 APK 或同步记录。</p></section><div class="notice warn">每次生成讲解都会使用你的 API 额度。题目、选项和已有解析会发送给 AI 服务。</div><div class="form-section"><label class="label" for="api-key">OpenAI API 密钥</label><input id="api-key" class="input" type="password" autocomplete="off" placeholder="sk-…"><p class="helper">为安全起见，已保存的密钥不会再次显示。</p></div><button class="primary" data-action="save-api-key">${configured ? '更新密钥' : '保存密钥'}</button>${configured ? `<button class="secondary danger" style="width:100%;margin-top:10px" data-action="clear-api-key">删除本机密钥</button>` : ''}</div>`, 'settings');
  }

  function renderSync() {
    const code = state.sync.code || '尚未创建';
    return shell(`${topbar('离线与同步', 'settings')}<div class="content"><section class="chapter-summary"><p class="kicker">无需登录</p><h2>${state.sync.on ? '学习记录已连接' : '用同步码连接网页和设备'}</h2><p>没有网络时，新进度先保存在本机；恢复网络后可手动同步。</p></section>${state.sync.code ? `<div class="sync-code"><span>你的同步码</span><strong>${escapeHtml(code)}</strong><button data-action="copy-sync">${icon('copy',15)} 复制同步码</button></div>` : ''}<div class="form-section"><label class="label" for="sync-endpoint">同步服务地址</label><input id="sync-endpoint" class="input" type="url" value="${escapeHtml(state.sync.endpoint || '')}" placeholder="https://你的网页域名/api/sync"><p class="helper">填写现有网页的同步地址，必须以 https 开头。</p></div><div class="form-section"><label class="label" for="sync-code-input">同步码</label><input id="sync-code-input" class="input" value="${escapeHtml(state.sync.code || '')}" maxlength="64" placeholder="输入网页或其他设备上的同步码"></div><button class="primary" data-action="connect-sync">连接并立即同步</button><button class="secondary" style="width:100%;margin-top:10px" data-action="create-sync">生成新的同步码</button>${state.sync.on ? `<button class="text-button danger" style="width:100%;margin-top:10px" data-action="disconnect-sync">断开同步</button>` : ''}<div class="notice" style="margin-top:18px">同步内容包括答题记录、错题、收藏、存疑和笔记；不会同步 AI 密钥。</div></div>`, 'settings');
  }

  function mergeState(local, remote) {
    const result = Object.assign(defaultState(), local || {});
    const other = remote || {};
    ['wrong', 'stars', 'flags'].forEach((key) => { result[key] = Object.assign({}, result[key] || {}, other[key] || {}); });
    result.notes = Object.assign({}, result.notes || {}, other.notes || {});
    result.qstats = result.qstats || {};
    Object.entries(other.qstats || {}).forEach(([id, value]) => { const old = result.qstats[id]; if (!old || (value.n || 0) > (old.n || 0)) result.qstats[id] = value; });
    result.days = result.days || {};
    Object.entries(other.days || {}).forEach(([day, value]) => { result.days[day] = Math.max(result.days[day] || 0, value || 0); });
    result.totals = { seen: Math.max(result.totals?.seen || 0, other.totals?.seen || 0), correct: Math.max(result.totals?.correct || 0, other.totals?.correct || 0) };
    result.mockHistory = [...(result.mockHistory || []), ...(other.mockHistory || [])].filter((item, index, all) => item && all.findIndex((x) => x.ts === item.ts) === index).sort((a, b) => a.ts - b.ts);
    if ((other.lastModified || 0) > (result.lastModified || 0) && other.lastRead) result.lastRead = other.lastRead;
    result.sync = local.sync;
    result.aiCache = local.aiCache || {};
    return result;
  }

  async function syncNow(silent) {
    if (!state.sync.endpoint || !state.sync.code) { if (!silent) showToast('请先填写同步服务地址和同步码'); return false; }
    try {
      if (!silent) showToast('正在读取云端记录…');
      let remoteRaw = await nativePromise('syncGet', [state.sync.endpoint, state.sync.code]);
      let remote = {};
      try { remote = JSON.parse(remoteRaw || '{}'); } catch (_) { remote = {}; }
      state = mergeState(state, remote);
      const upload = JSON.parse(JSON.stringify(state)); delete upload.aiCache; delete upload.sync;
      await nativePromise('syncPut', [state.sync.endpoint, state.sync.code, JSON.stringify(upload)]);
      state.sync.on = true; state.sync.last = Date.now(); saveState(false);
      if (!silent) showToast('同步完成');
      render(); return true;
    } catch (error) { if (!silent) showToast('同步失败：' + error.message); return false; }
  }

  function render() {
    const y = window.scrollY;
    const currentHash = location.hash || '#home';
    const changed = currentHash !== lastHash;
    lastHash = currentHash;
    const { route, params } = routeInfo();
    const pages = {
      home: () => renderHome(), chapters: () => renderChapters(), chapter: () => renderChapter(params), reader: () => renderReader(params),
      practice: () => renderPractice(), quiz: () => renderQuiz(), mock: () => renderMock(), exam: () => renderExam(), 'exam-map': () => renderExamMap(),
      result: () => renderResult(), ai: () => renderAI(), library: () => renderLibrary(), flashcards: () => renderFlashcards(), analytics: () => renderAnalytics(),
      settings: () => renderSettings(), 'ai-settings': () => renderAISettings(), sync: () => renderSync()
    };
    app.innerHTML = (pages[route] || pages.home)();
    requestAnimationFrame(() => window.scrollTo(0, changed ? 0 : y));
  }

  app.addEventListener('click', async (event) => {
    const nav = event.target.closest('[data-nav]');
    if (nav) {
      const route = nav.dataset.nav;
      if (route.includes('?')) { const [name, query] = route.split('?'); return navigate(name, Object.fromEntries(new URLSearchParams(query))); }
      let params = null; try { params = nav.dataset.params ? JSON.parse(nav.dataset.params) : null; } catch (_) { }
      navigate(route, params); return;
    }
    const target = event.target.closest('[data-action]');
    if (!target) return;
    const action = target.dataset.action;
    if (action === 'quick-practice') startPractice({ mode: 'smart', count: dueCount(), chapter: 'all' });
    if (action === 'practice-mode') { practiceConfig.mode = target.dataset.value; render(); }
    if (action === 'practice-count') { practiceConfig.count = Number(target.dataset.value); render(); }
    if (action === 'start-practice') { const select = document.getElementById('practice-chapter'); practiceConfig.chapter = select ? select.value : 'all'; startPractice(practiceConfig); }
    if (action === 'section-practice') startPractice({ mode: 'smart', count: 15, chapter: target.dataset.ch, section: target.dataset.sec });
    if (action === 'practice-single') { const q = qById.get(target.dataset.id); quizSession = { type: 'practice', ids: [String(q.id)], index: 0, selected: '', revealed: false, answered: {} }; navigate('quiz'); }
    if (action === 'select-option' && quizSession && !quizSession.revealed) { quizSession.selected = target.dataset.value; render(); }
    if (action === 'submit-answer' && quizSession && quizSession.selected) { const q = currentQuestion(); recordAnswer(q, quizSession.selected); quizSession.revealed = true; render(); }
    if (action === 'next-question') { if (quizSession.index >= quizSession.ids.length - 1) { quizSession = null; showToast('练习完成，记录已保存'); navigate('home'); } else { quizSession.index += 1; quizSession.selected = ''; quizSession.revealed = false; render(); } }
    if (action === 'leave-quiz') openConfirm('退出本次练习', '已完成的答题记录会保留，你可以稍后重新开始。', '确认退出', () => { quizSession = null; navigate('practice'); });
    if (action === 'toggle-star') { const q = currentQuestion(); if (!q) return; const id = String(q.id); if (state.stars[id]) delete state.stars[id]; else state.stars[id] = 1; saveState(); render(); }
    if (action === 'toggle-flag') { const q = currentQuestion(); if (!q) return; const id = String(q.id); if (state.flags[id]) delete state.flags[id]; else state.flags[id] = 1; saveState(); render(); }
    if (action === 'open-ai') { const q = currentQuestion(); if (!q) return; aiQuestionId = String(q.id); aiAnswer = ''; aiError = ''; navigate('ai'); }
    if (action === 'ask-ai') requestAI('');
    if (action === 'ai-followup') { const input = document.getElementById('ai-followup'); const value = input ? input.value.trim() : ''; if (value) requestAI(value); else showToast('先输入想追问的问题'); }
    if (action === 'save-reader-note') { const textarea = document.getElementById('section-note'); if (textarea) { state.notes[textarea.dataset.noteKey] = textarea.value.trim(); saveState(); showToast('笔记已保存'); } }
    if (action === 'font-up' || action === 'font-down') { const article = document.querySelector('.reader-article'); if (article) { const current = Number(article.dataset.fontSize || 15); const next = Math.max(13, Math.min(20, current + (action === 'font-up' ? 1 : -1))); article.dataset.fontSize = next; article.style.fontSize = next + 'px'; article.querySelectorAll('p,.list-item').forEach((node) => node.style.fontSize = next + 'px'); } }
    if (action === 'start-mock') openConfirm('开始前确认', '考试共 60 题，限时 90 分钟。开始后会持续计时，交卷前不显示答案。', '开始计时', startMock);
    if (action === 'exam-option') { const q = currentQuestion(); quizSession.answers[String(q.id)] = target.dataset.value; render(); }
    if (action === 'exam-flag') { const id = String(currentQuestion().id); if (quizSession.flags[id]) delete quizSession.flags[id]; else quizSession.flags[id] = 1; render(); }
    if (action === 'exam-prev' && quizSession.index > 0) { quizSession.index -= 1; render(); }
    if (action === 'exam-next') { if (quizSession.index < quizSession.ids.length - 1) { quizSession.index += 1; render(); } else navigate('exam-map'); }
    if (action === 'exam-map') navigate('exam-map');
    if (action === 'jump-exam') { quizSession.index = Number(target.dataset.index); navigate('exam'); }
    if (action === 'submit-mock') { const unanswered = quizSession.ids.length - Object.keys(quizSession.answers).length; openConfirm('确认交卷', unanswered ? `还有 ${unanswered} 题未作答，交卷后将立即生成成绩。` : '所有题目已经作答，交卷后将立即生成成绩。', '确认交卷', submitMock); }
    if (action === 'library-tab') { libraryTab = target.dataset.value; render(); }
    if (action === 'flip-card') { flashRevealed = !flashRevealed; render(); }
    if (action === 'flash-prev') { flashIndex = (flashIndex - 1 + DATA.flashcards.length) % DATA.flashcards.length; flashRevealed = false; render(); }
    if (action === 'flash-next') { flashIndex = (flashIndex + 1) % DATA.flashcards.length; flashRevealed = false; render(); }
    if (action === 'save-api-key') { const input = document.getElementById('api-key'); const value = input ? input.value.trim() : ''; if (!value) return showToast('请输入 API 密钥'); try { const ok = window.HKSI_NATIVE && window.HKSI_NATIVE.saveApiKey(value); showToast(ok ? '密钥已安全保存' : '密钥格式不正确'); if (ok) setTimeout(render, 400); } catch (_) { showToast('请在 APK 中保存密钥'); } }
    if (action === 'clear-api-key') openConfirm('删除 AI 密钥', '删除后，题库原有解析仍可使用，但 AI 讲解需要重新保存密钥。', '确认删除', () => { window.HKSI_NATIVE.clearApiKey(); showToast('密钥已删除'); render(); });
    if (action === 'connect-sync' || action === 'create-sync') {
      const endpoint = (document.getElementById('sync-endpoint') || {}).value?.trim() || '';
      let code = (document.getElementById('sync-code-input') || {}).value?.trim() || '';
      if (!/^https:\/\//i.test(endpoint)) return showToast('同步地址必须以 https:// 开头');
      if (action === 'create-sync') code = Math.random().toString(36).slice(2, 10).toUpperCase();
      if (!code) return showToast('请输入同步码');
      state.sync = { endpoint, code: code.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64), on: true, last: 0 }; saveState(false);
      if (action === 'create-sync') { try { const upload = JSON.parse(JSON.stringify(state)); delete upload.aiCache; delete upload.sync; await nativePromise('syncPut', [endpoint, state.sync.code, JSON.stringify(upload)]); showToast('新同步码已创建'); render(); } catch (error) { state.sync.on = false; saveState(false); showToast('创建失败：' + error.message); } }
      else await syncNow(false);
    }
    if (action === 'copy-sync') { const code = state.sync.code; try { await navigator.clipboard.writeText(code); showToast('同步码已复制'); } catch (_) { const input = document.createElement('input'); input.value = code; document.body.appendChild(input); input.select(); document.execCommand('copy'); input.remove(); showToast('同步码已复制'); } }
    if (action === 'disconnect-sync') openConfirm('断开同步', '本机学习记录会保留，但之后的新记录不再上传。', '确认断开', () => { state.sync.on = false; saveState(false); showToast('已断开同步'); render(); });
    if (action === 'reset-data') openConfirm('清空本机学习记录', '错题、收藏、笔记和考试记录会被清空，此操作不能恢复；安装包内的题库不会删除。', '确认清空', () => { const sync = state.sync; state = defaultState(); state.sync = sync; saveState(false); showToast('本机学习记录已清空'); render(); });
  });

  app.addEventListener('change', (event) => {
    if (event.target && event.target.dataset.action === 'practice-chapter') practiceConfig.chapter = event.target.value;
  });

  window.addEventListener('hashchange', render);
  window.addEventListener('offline', () => showToast('当前离线，课程和题库仍可使用'));
  window.addEventListener('online', () => showToast('网络已恢复'));
  if (!location.hash) history.replaceState(null, '', '#home');
  render();
})();
