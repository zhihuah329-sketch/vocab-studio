const token = document.querySelector('meta[name="app-token"]').content;
const $ = id => document.getElementById(id);
let words = [];
let selected = new Set();
let latest = null;
let latestExam = null;
let latestTranslation = null;
let latestVocabulary = null;
const wordDetails = new Map();
const ACTIVITY_LABELS = { story: '阅读短文', exam: '等级考试阅读', translation: '翻译训练', vocabulary: 'AI 词表' };
let studyState = { custom: [], progress: {}, activeBook: 'cet4', plans: {}, daily: {}, activity: [] };
let bookMeta = [];
let nickname = '';
let studyItems = [];
let studyQueue = [];
let studyIndex = 0;
let studyCurrent = null;
let studyLoadId = 0;
let selectionTimer;
let selectionRequest = 0;
const studyRepeats = new Set();
const studyOrigins = new Map();
let studyMode = 'review';
let studySaveQueue = Promise.resolve();
const dictionaryCache = new Map();
let studyAudio = null;
let buddyAutoStartAttempted = false;

let saveTimer;
function applyTheme(theme) {
  document.body.dataset.theme = theme;
  $('theme-toggle').textContent = theme === 'dark' ? '☀ 浅色模式' : '☾ 深色模式';
  $('theme-toggle').setAttribute('aria-label', `切换${theme === 'dark' ? '浅色' : '深色'}模式`);
  document.querySelectorAll('.theme-option').forEach(button => {
    const active = button.dataset.themeChoice === theme;
    button.classList.toggle('active', active);
    button.setAttribute('aria-checked', String(active));
  });
}
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    try {
      await post('/api/settings', JSON.stringify({ api_url: endpoint($('api-url').value), model: $('model').value.trim(), theme: document.body.dataset.theme || 'light', nickname }), { 'Content-Type': 'application/json' });
    } catch (error) { message('buddy-status', `配置保存失败：${error.message}`, true); }
  }, 350);
}
async function loadSettings() {
  try {
    const response = await fetch('/api/settings', { headers: { 'X-App-Token': token } });
    const saved = await response.json();
    if (response.ok) {
      $('api-url').value = saved.api_url;
      $('model').value = saved.model;
      nickname = saved.nickname || '';
      $('profile-nickname').value = nickname;
      renderAvatar();
      applyTheme(saved.theme);
      syncPreset();
      if (saved.api_url.includes('127.0.0.1:5178')) detectWorkbuddy(false);
    }
  } catch { applyTheme('light'); }
}
applyTheme('light');
loadSettings();
$('theme-toggle').addEventListener('click', () => { applyTheme(document.body.dataset.theme === 'dark' ? 'light' : 'dark'); scheduleSave(); });
document.querySelectorAll('.theme-option').forEach(button => button.addEventListener('click', () => { applyTheme(button.dataset.themeChoice); scheduleSave(); }));

function message(id, value, error = false) {
  const node = $(id);
  node.textContent = value;
  node.classList.toggle('error', error);
}

async function post(path, body, headers = {}) {
  const response = await fetch(path, { method: 'POST', headers: { 'X-App-Token': token, ...headers }, body });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || `请求失败：${response.status}`);
  return result;
}

async function getJSON(path) {
  const response = await fetch(path, { headers: { 'X-App-Token': token } });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || `请求失败：${response.status}`);
  return result;
}

async function importFile(file) {
  if (!file) return;
  if (file.size > 8 * 1024 * 1024) return message('import-message', '文件超过 8 MB。', true);
  message('import-message', '正在读取文件…');
  try {
    const data = await post('/api/parse', await file.arrayBuffer(), { 'Content-Type': 'application/octet-stream', 'X-Filename': encodeURIComponent(file.name) });
    setWords(data.words);
    $('file-label').textContent = file.name;
    message('import-message', `已识别 ${data.words.length} 个不重复单词。`);
  } catch (error) {
    message('import-message', error.message, true);
  }
}

function setWords(items) {
  words = items;
  selected = new Set(items.slice(0, 12));
  $('word-summary').textContent = items.length ? `已导入 ${items.length} 个，按需点选` : '未识别到单词';
  $('total-count').textContent = `共 ${items.length} 个`;
  $('search-words').value = '';
  renderWords();
  renderProgress();
}

function renderWords() {
  const list = $('word-list');
  list.replaceChildren();
  if (!words.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-words';
    empty.innerHTML = '还没有单词<br><small>先导入一份词表吧</small>';
    list.append(empty);
  } else {
    const query = $('search-words').value.trim().toLowerCase();
    for (const word of words) {
      const button = document.createElement('button');
      button.className = 'word-chip' + (selected.has(word) ? ' selected' : '') + (query && !word.includes(query) ? ' filtered' : '');
      button.textContent = word;
      button.type = 'button';
      button.setAttribute('aria-pressed', selected.has(word));
      button.addEventListener('click', () => {
        if (selected.has(word)) selected.delete(word); else selected.add(word);
        button.classList.toggle('selected', selected.has(word));
        button.setAttribute('aria-pressed', selected.has(word));
        updateCount();
      });
      list.append(button);
    }
  }
  updateCount();
}

function updateCount() { $('selected-count').textContent = selected.size; renderProgress(); }

$('file-input').addEventListener('change', event => importFile(event.target.files[0]));
const drop = $('drop-zone');
for (const event of ['dragenter', 'dragover']) drop.addEventListener(event, e => { e.preventDefault(); drop.classList.add('dragover'); });
for (const event of ['dragleave', 'drop']) drop.addEventListener(event, e => { e.preventDefault(); drop.classList.remove('dragover'); });
drop.addEventListener('drop', event => importFile(event.dataTransfer.files[0]));
$('parse-text').addEventListener('click', async () => {
  const text = $('raw-input').value;
  if (!text.trim()) return message('import-message', '请先粘贴单词。', true);
  try {
    const data = await post('/api/parse', new TextEncoder().encode(text), { 'Content-Type': 'application/octet-stream', 'X-Filename': 'pasted.txt' });
    setWords(data.words);
    $('file-label').textContent = '粘贴内容';
    message('import-message', `已识别 ${data.words.length} 个不重复单词。`);
  } catch (error) { message('import-message', error.message, true); }
});
$('search-words').addEventListener('input', renderWords);
$('select-all').addEventListener('click', () => { selected = new Set(words); renderWords(); });
$('clear-all').addEventListener('click', () => { selected.clear(); renderWords(); });

function syncPreset() {
  let matched = false;
  document.querySelectorAll('.preset').forEach(button => {
    const active = Boolean(button.dataset.url && button.dataset.url === $('api-url').value && (!button.dataset.model || button.dataset.model === $('model').value));
    button.classList.toggle('active', active);
    matched ||= active;
  });
  if (!matched) document.querySelector('.preset[data-custom]').classList.add('active');
  updateApiChip();
}
function updateApiChip() {
  const model = $('model').value.trim();
  const configured = Boolean(endpoint($('api-url').value) && model);
  const chip = $('api-chip');
  chip.textContent = configured ? `● ${model}` : '● 未配置接口';
  chip.classList.toggle('ready', configured);
  chip.title = configured ? `当前接口：${endpoint($('api-url').value)}` : '点击前往设置 AI 接口';
}
$('api-chip').addEventListener('click', () => showView('settings'));
function setApiState(text, kind = '') {
  const node = $('api-state');
  node.textContent = text;
  node.className = `api-state ${kind}`.trim();
}
document.querySelectorAll('.preset').forEach(button => button.addEventListener('click', () => {
  if (button.dataset.url) {
    $('api-url').value = button.dataset.url;
    $('model').value = button.dataset.model || '';
  }
  syncPreset();
  scheduleSave();
  if (button.dataset.workbuddy) detectWorkbuddy(true);
}));
$('api-url').addEventListener('input', () => { syncPreset(); updateBuddyModelSelection(); scheduleSave(); });
$('model').addEventListener('input', () => { syncPreset(); updateBuddyModelSelection(); scheduleSave(); });

async function detectWorkbuddy(select) {
  message('buddy-status', '正在检测本机代理…');
  try {
    const response = await fetch('/api/workbuddy', { headers: { 'X-App-Token': token } });
    const result = await response.json();
    if (!result.available) {
      setApiState('未连接', 'error');
      setBuddyCardState('未连接', 'error');
      $('buddy-model-list').replaceChildren(document.createTextNode('后台代理未就绪；点击下方按钮启动后重试。'));
      message('buddy-status', result.message, true);
      if (!select && !buddyAutoStartAttempted && $('api-url').value.includes('127.0.0.1:5178')) {
        buddyAutoStartAttempted = true;
        try {
          const started = await post('/api/workbuddy/start', '{}', { 'Content-Type': 'application/json' });
          message('buddy-status', started.message || '正在连接 Buddy…');
          if (started.starting) setTimeout(() => detectWorkbuddy(true), 5000);
        } catch (error) { message('buddy-status', error.message, true); }
      }
      return;
    }
    const options = $('model-options');
    options.replaceChildren();
    const modelList = $('buddy-model-list');
    modelList.replaceChildren();
    for (const name of result.models) {
      const option = document.createElement('option');
      option.value = name;
      options.append(option);
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'buddy-model';
      button.textContent = name;
      button.addEventListener('click', () => {
        $('api-url').value = result.api_url;
        $('model').value = name;
        syncPreset();
        scheduleSave();
        updateBuddyModelSelection();
        message('buddy-status', `已选择 Buddy 模型：${name}`);
      });
      modelList.append(button);
    }
    if (!result.models.length) modelList.append(document.createTextNode('当前没有可用模型，请在 Buddy 管理面板中检查账号状态。'));
    if (select || $('api-url').value === result.api_url) {
      $('api-url').value = result.api_url;
      if (!$('model').value || !result.models.includes($('model').value)) $('model').value = result.models[0] || '';
      syncPreset();
      scheduleSave();
    }
    updateBuddyModelSelection();
    message('buddy-status', result.models.length ? `已识别 Buddy，找到 ${result.models.length} 个模型` : '已识别 Buddy，暂无可用模型');
    setApiState(result.models.length ? 'Buddy 已连接' : 'Buddy 无模型', result.models.length ? 'ok' : 'error');
    setBuddyCardState(result.models.length ? '已连接' : '无模型', result.models.length ? 'ok' : 'error');
  } catch (error) { setApiState('检测失败', 'error'); setBuddyCardState('检测失败', 'error'); message('buddy-status', `检测失败：${error.message}`, true); }
}
function setBuddyCardState(label, kind = '') {
  const node = $('buddy-card-state');
  node.textContent = label;
  node.className = `api-state ${kind}`;
}
function updateBuddyModelSelection() {
  document.querySelectorAll('.buddy-model').forEach(button => {
    const active = $('model').value === button.textContent && $('api-url').value.includes('127.0.0.1:5178');
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
}
$('buddy-open-panel').addEventListener('click', async () => {
  const panel = $('buddy-panel');
  if (!panel.classList.contains('hidden')) {
    panel.classList.add('hidden');
    $('buddy-open-panel').textContent = '展开 Buddy 管理面板';
    $('buddy-open-panel').setAttribute('aria-expanded', 'false');
    return;
  }
  try {
    const result = await post('/api/workbuddy/start', '{}', { 'Content-Type': 'application/json' });
    if (result.starting) await new Promise(resolve => setTimeout(resolve, 3000));
    const ready = await getJSON('/api/workbuddy');
    if (!ready.available) throw new Error(ready.message || 'Buddy 代理尚未启动。');
    await detectWorkbuddy(false);
    const frame = $('buddy-panel-frame');
    if (!frame.src) frame.src = 'http://127.0.0.1:5178/';
    panel.classList.remove('hidden');
    $('buddy-open-panel').textContent = '收起 Buddy 管理面板';
    $('buddy-open-panel').setAttribute('aria-expanded', 'true');
  } catch (error) { message('buddy-status', error.message, true); }
});
$('buddy-refresh-panel').addEventListener('click', () => {
  detectWorkbuddy(false);
  const frame = $('buddy-panel-frame');
  if (frame.src) frame.src = 'http://127.0.0.1:5178/?refresh=' + Date.now();
});
$('detect-workbuddy').addEventListener('click', () => detectWorkbuddy(true));
$('start-workbuddy').addEventListener('click', async () => {
  message('buddy-status', '正在启动 Buddy…');
  try {
    const result = await post('/api/workbuddy/start', '{}', { 'Content-Type': 'application/json' });
    message('buddy-status', result.message || 'Buddy 已运行，正在读取模型…');
    setTimeout(() => detectWorkbuddy(true), result.starting ? 4000 : 0);
  } catch (error) { message('buddy-status', error.message, true); }
});
$('test-api').addEventListener('click', async () => {
  let request;
  try { request = sharedRequest(); } catch (error) { return message('buddy-status', error.message, true); }
  $('test-api').disabled = true;
  setApiState('测试中…');
  message('buddy-status', '正在发送一次测试请求…');
  const started = performance.now();
  try {
    const result = await post('/api/translate-selection', JSON.stringify({ ...request, text: 'hello', context: 'hello' }), { 'Content-Type': 'application/json' });
    const seconds = ((performance.now() - started) / 1000).toFixed(1);
    setApiState('连接正常', 'ok');
    message('buddy-status', `连接成功（${seconds} 秒）：hello → ${result.translation}`);
  } catch (error) {
    setApiState('连接失败', 'error');
    message('buddy-status', `测试失败：${error.message}`, true);
  } finally { $('test-api').disabled = false; }
});

function endpoint(value) {
  const url = value.trim().replace(/\/+$/, '');
  if (url.endsWith('/v1')) return url + '/chat/completions';
  return url;
}

function sharedRequest() {
  const api_url = endpoint($('api-url').value);
  const model = $('model').value.trim();
  if (!api_url || !model) throw new Error('请先在「设置 → AI 接口」中填写 API URL 和模型名称。');
  scheduleSave();
  return { api_url, model, api_key: $('api-key').value.trim(), words: words.filter(word => selected.has(word)) };
}

$('generate').addEventListener('click', async () => {
  if (!selected.size) return message('generate-message', '请至少选择一个单词。', true);
  let request;
  try { request = sharedRequest(); } catch (error) { return message('generate-message', error.message, true); }
  const button = $('generate');
  button.disabled = true;
  message('generate-message', '正在生成，可能需要几十秒…');
  try {
    const result = await post('/api/generate', JSON.stringify({
      ...request,
      level: $('level').value, length: Number($('length').value), topic: $('topic').value.trim()
    }), { 'Content-Type': 'application/json' });
    latest = { ...result, words: request.words };
    renderResult(latest);
    recordActivity('story', result.title);
    message('generate-message', result.missing.length ? `已生成，${result.missing.length} 个目标词未出现。` : '已生成，所有目标词均已出现。', Boolean(result.missing.length));
  } catch (error) {
    message('generate-message', error.message, true);
  } finally { button.disabled = false; }
});

const views = {
  home: { label: '总览', eyebrow: 'YOUR ENGLISH PRACTICE STUDIO', title: '从认识一个词，<br><em>走向真正会用。</em>', description: '从词汇积累到阅读、考试与翻译，串起你的英语学习。' },
  story: { label: '阅读短文', eyebrow: 'YOUR WORDS, YOUR STORY', title: '把今天的单词，<br><em>读成一篇故事。</em>', description: '导入词表，选择目标词，生成专属英文阅读材料。' },
  exam: { label: '等级考试阅读', eyebrow: 'READ · THINK · ANSWER', title: '读一篇文章，<br><em>练一场考试。</em>', description: '选择考试类型，完成原创模拟阅读与五道选择题。' },
  kaoyan: { label: '考研英语', eyebrow: 'POSTGRADUATE ENGLISH', title: '为考研做准备，<br><em>从今天这一篇开始。</em>', description: '英语一/二阅读、翻译和考研词汇计划集中练习。' },
  translation: { label: '翻译训练', eyebrow: 'FROM WORDS TO EXPRESSION', title: '把理解写出来，<br><em>让表达更准确。</em>', description: '汉译英或英译汉，先独立作答，再对照参考译文。' },
  vocabulary: { label: 'AI 生成词表', eyebrow: 'BUILD YOUR WORD BANK', title: '选一个方向，<br><em>生成下一份词表。</em>', description: '按等级和主题生成词汇、释义与例句，直接加入练习。' },
  study: { label: '背单词', eyebrow: 'A LITTLE, EVERY DAY', title: '每天记一点，<br><em>让词汇真正留下。</em>', description: '选择词书，先回忆再翻面，按记忆情况安排复习。' },
  profile: { label: '个人数据', eyebrow: 'YOUR PROGRESS', title: '看见每一天，<br><em>积累成长的轨迹。</em>', description: '背词进度、学习趋势与练习记录，全部保存在本机。' },
  settings: { label: '设置', eyebrow: 'PREFERENCES', title: '配置一次，<br><em>每次都顺手。</em>', description: 'AI 接口、外观主题与本地数据管理。' }
};
// Views that work with the imported word list keep the left column visible.
const WORD_VIEWS = new Set(['story', 'exam', 'translation', 'vocabulary', 'study']);

function showView(name) {
  hideSelectionTranslation();
  for (const key of Object.keys(views)) $('view-' + key).classList.toggle('hidden', key !== name);
  document.querySelectorAll('[data-view]').forEach(button => button.classList.toggle('active', button.dataset.view === name));
  $('breadcrumb-current').textContent = views[name].label;
  $('intro-eyebrow').textContent = views[name].eyebrow;
  $('intro-title').innerHTML = views[name].title;
  $('intro-description').textContent = views[name].description;
  const usesWords = WORD_VIEWS.has(name);
  document.querySelector('.columns').classList.toggle('wide', !usesWords);
  $('resources-toggle').classList.toggle('hidden', !usesWords);
  if (window.matchMedia('(max-width: 820px)').matches) setResourcesVisible(name === 'story');
  if (name === 'profile') renderProfile();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
document.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => showView(button.dataset.view)));
$('kaoyan-reading').addEventListener('click', () => {
  $('exam-type').value = $('kaoyan-track').value;
  updateExamLengthHint();
  showView('exam');
  $('generate-exam').click();
});
$('kaoyan-translation').addEventListener('click', () => {
  $('translation-direction').value = 'en-zh';
  $('translation-level').value = '考研英语';
  showView('translation');
  $('generate-translation').click();
});
$('kaoyan-study').addEventListener('click', async () => {
  await studyReady;
  showView('study');
  $('study-book').value = 'ky';
  await loadStudyBook();
});

function setResourcesVisible(visible) {
  $('resources').classList.toggle('resources-collapsed', !visible);
  $('resources-toggle').setAttribute('aria-expanded', String(visible));
  $('resources-toggle').classList.toggle('active', visible);
}
$('resources-toggle').addEventListener('click', () => {
  setResourcesVisible($('resources').classList.contains('resources-collapsed'));
});

function setBusy(buttonId, statusId, busy, text = '') {
  $(buttonId).disabled = busy;
  if (text) message(statusId, text);
}

function make(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

$('generate-exam').addEventListener('click', async () => {
  let request;
  try { request = sharedRequest(); } catch (error) { return message('exam-message', error.message, true); }
  setBusy('generate-exam', 'exam-message', true, '正在生成文章和试题…');
  try {
    const result = await post('/api/exam', JSON.stringify({ ...request, exam: $('exam-type').value, topic: $('exam-topic').value.trim() }), { 'Content-Type': 'application/json' });
    latestExam = { ...result, exam: $('exam-type').value };
    renderExam(latestExam);
    latestExam.recordAt = recordActivity('exam', result.title);
    message('exam-message', '试题已生成，完成五题后提交答案。');
  } catch (error) { message('exam-message', error.message, true); }
  finally { $('generate-exam').disabled = false; }
});

const examLengthHints = {
  '英语四级': '四级仔细阅读：单篇约 300–350 词，附 5 道选择题。',
  '英语六级': '六级仔细阅读：单篇约 400–450 词，附 5 道选择题。'
};
function updateExamLengthHint() {
  $('exam-length-hint').textContent = (examLengthHints[$('exam-type').value] || '原创模拟阅读：单篇约 300–450 词，附 5 道选择题。') + ' 已选目标词会尽量自然融入。';
}
$('exam-type').addEventListener('change', updateExamLengthHint);
updateExamLengthHint();

function renderExam(result) {
  $('exam-title').textContent = result.title;
  const wordCount = (result.passage.match(/[A-Za-z]+(?:['’-][A-Za-z]+)*/g) || []).length;
  $('exam-label').textContent = `${result.exam} · ${wordCount} 词 · 原创模拟`;
  $('exam-passage').textContent = result.passage;
  $('exam-translation').textContent = result.translation;
  $('exam-translation').classList.add('hidden');
  $('toggle-exam-translation').textContent = '查看文章译文';
  $('exam-score').classList.add('hidden');
  $('exam-score').textContent = '';
  const container = $('exam-questions');
  container.replaceChildren();
  result.questions.forEach((question, index) => {
    const card = make('div', 'question-card');
    card.append(make('div', 'question-number', `QUESTION ${String(index + 1).padStart(2, '0')}`));
    card.append(make('h3', '', `${index + 1}. ${question.stem}`));
    question.options.forEach((option, optionIndex) => {
      const letter = 'ABCD'[optionIndex];
      const label = make('label', 'option-row');
      const input = document.createElement('input');
      input.type = 'radio';
      input.name = `question-${index}`;
      input.value = letter;
      label.append(input, make('span', 'option-letter', letter), make('span', '', option));
      card.append(label);
    });
    const explanation = make('div', 'answer-explanation hidden');
    explanation.id = `explanation-${index}`;
    card.append(explanation);
    container.append(card);
  });
  $('exam-result').classList.remove('hidden');
  $('exam-result').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

$('submit-exam').addEventListener('click', () => {
  if (!latestExam) return;
  const answers = latestExam.questions.map((_, index) => document.querySelector(`input[name="question-${index}"]:checked`)?.value);
  if (answers.some(answer => !answer)) return message('exam-message', '请先完成全部 5 道题。', true);
  let score = 0;
  latestExam.questions.forEach((question, index) => {
    const correct = answers[index] === question.answer;
    if (correct) score++;
    const explanation = $(`explanation-${index}`);
    explanation.textContent = `${correct ? '✓ 回答正确' : `✗ 你的答案 ${answers[index]}`} · 正确答案 ${question.answer}。${question.explanation}`;
    explanation.classList.remove('hidden');
    explanation.classList.toggle('incorrect', !correct);
  });
  $('exam-score').textContent = `得分 ${score} / 5  ·  已显示每题解析`;
  $('exam-score').classList.remove('hidden');
  message('exam-message', `已提交：${score}/5 分。`);
  const record = studyState.activity.find(item => item.kind === 'exam' && item.at === latestExam.recordAt);
  if (record) {
    record.score = score;
    saveStudyState().then(renderProgress).catch(() => {});
  }
});

$('toggle-exam-translation').addEventListener('click', () => {
  const hidden = $('exam-translation').classList.toggle('hidden');
  $('toggle-exam-translation').textContent = hidden ? '查看文章译文' : '收起文章译文';
});

$('download-exam').addEventListener('click', () => {
  if (!latestExam) return;
  const questions = latestExam.questions.map((q, i) => `${i + 1}. ${q.stem}\n${q.options.map((o, j) => `${'ABCD'[j]}. ${o}`).join('\n')}\n\n答案：${q.answer}。${q.explanation}`).join('\n\n');
  download('等级考试阅读.md', `# ${latestExam.title}\n\n${latestExam.exam} · 原创模拟\n\n${latestExam.passage}\n\n## 题目与解析\n\n${questions}\n\n## 文章译文\n\n${latestExam.translation}\n`);
});

$('generate-translation').addEventListener('click', async () => {
  let request;
  try { request = sharedRequest(); } catch (error) { return message('translation-message', error.message, true); }
  setBusy('generate-translation', 'translation-message', true, '正在生成翻译题…');
  try {
    const result = await post('/api/translation', JSON.stringify({ ...request, direction: $('translation-direction').value, level: $('translation-level').value, topic: $('translation-topic').value.trim() }), { 'Content-Type': 'application/json' });
    latestTranslation = { ...result, direction: $('translation-direction').value };
    renderTranslation(latestTranslation);
    recordActivity('translation', result.title);
    message('translation-message', '题目已生成，写完后对照参考答案。');
  } catch (error) { message('translation-message', error.message, true); }
  finally { $('generate-translation').disabled = false; }
});

function renderTranslation(result) {
  $('translation-title').textContent = result.title;
  $('translation-label').textContent = result.direction === 'zh-en' ? '汉译英 · 5 题' : '英译汉 · 5 题';
  $('translation-feedback').textContent = '';
  const container = $('translation-items');
  container.replaceChildren();
  result.items.forEach((item, index) => {
    const card = make('div', 'translation-question');
    card.append(make('div', 'question-number', `SENTENCE ${String(index + 1).padStart(2, '0')}`));
    card.append(make('p', 'source-sentence', item.source));
    const answer = make('textarea', 'answer-input');
    answer.id = `translation-answer-${index}`;
    answer.rows = 3;
    answer.placeholder = '在这里写下你的译文…';
    card.append(answer);
    const reference = make('div', 'reference-answer hidden');
    reference.append(make('strong', '', '参考译文'), make('p', '', item.reference), make('small', '', item.note));
    card.append(reference);
    container.append(card);
  });
  $('translation-result').classList.remove('hidden');
  $('translation-result').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

$('show-references').addEventListener('click', () => {
  if (!latestTranslation) return;
  document.querySelectorAll('.reference-answer').forEach(element => element.classList.remove('hidden'));
  const completed = latestTranslation.items.filter((_, index) => $(`translation-answer-${index}`).value.trim()).length;
  $('translation-feedback').textContent = `已作答 ${completed}/5 题。参考译文可有不同表达，请结合提示自行比较。`;
});

$('download-translation').addEventListener('click', () => {
  if (!latestTranslation) return;
  const items = latestTranslation.items.map((item, index) => `${index + 1}. ${item.source}\n\n我的译文：${$(`translation-answer-${index}`).value.trim() || '（未作答）'}\n\n参考译文：${item.reference}\n\n提示：${item.note}`).join('\n\n');
  download('翻译训练.md', `# ${latestTranslation.title}\n\n${latestTranslation.direction === 'zh-en' ? '汉译英' : '英译汉'}\n\n${items}\n`);
});

$('generate-vocabulary').addEventListener('click', async () => {
  let request;
  try { request = sharedRequest(); } catch (error) { return message('vocab-message', error.message, true); }
  setBusy('generate-vocabulary', 'vocab-message', true, '正在生成词表…');
  try {
    const result = await post('/api/vocabulary', JSON.stringify({ ...request, level: $('vocab-level').value, count: Number($('vocab-count').value), topic: $('vocab-topic').value.trim() }), { 'Content-Type': 'application/json' });
    latestVocabulary = result;
    recordActivity('vocabulary', result.title);
    $('vocab-title').textContent = result.title;
    $('vocab-total').textContent = `${result.items.length} 个词汇`;
    const list = $('vocab-items');
    list.replaceChildren();
    result.items.forEach((item, index) => {
      const row = make('div', 'vocab-row');
      const heading = make('div', 'vocab-row-head');
      heading.append(make('span', 'vocab-index', String(index + 1).padStart(2, '0')), make('strong', '', item.word), make('span', 'vocab-meaning', item.meaning));
      row.append(heading, make('p', '', item.example));
      list.append(row);
    });
    $('vocab-result').classList.remove('hidden');
    $('vocab-result').scrollIntoView({ behavior: 'smooth', block: 'start' });
    message('vocab-message', `已生成 ${result.items.length} 个词汇，可加入词表或导出。`);
  } catch (error) { message('vocab-message', error.message, true); }
  finally { $('generate-vocabulary').disabled = false; }
});

$('use-vocabulary').addEventListener('click', () => {
  if (!latestVocabulary) return;
  const combined = [...new Set([...words, ...latestVocabulary.items.map(item => item.word)])];
  const added = combined.length - words.length;
  setWords(combined);
  latestVocabulary.items.forEach(item => wordDetails.set(item.word, item));
  for (const item of latestVocabulary.items) selected.add(item.word);
  renderWords();
  $('file-label').textContent = 'AI 生成词表';
  message('vocab-message', `已加入 ${added} 个新词，当前选中 ${selected.size} 个。`);
});

function todayISO(offset = 0) {
  const day = new Date();
  day.setHours(12, 0, 0, 0);
  day.setDate(day.getDate() + offset);
  return `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
}

async function saveStudyState() {
  const snapshot = JSON.stringify(studyState);
  studySaveQueue = studySaveQueue.catch(() => {}).then(() => post('/api/study', snapshot, { 'Content-Type': 'application/json' }));
  await studySaveQueue;
}

async function loadStudyData() {
  try {
    const [books, saved] = await Promise.all([getJSON('/api/books'), getJSON('/api/study')]);
    studyState = saved;
    bookMeta = books.books;
    const select = $('study-book');
    for (const book of books.books) {
      const option = document.createElement('option');
      option.value = book.id;
      option.textContent = `${book.title} · ${book.count} 词`;
      select.append(option);
    }
    select.value = saved.activeBook;
    if (!select.value) select.value = 'cet4';
    renderProgress();
    await loadStudyBook();
  } catch (error) { message('study-message', `读取词书失败：${error.message}`, true); }
}

async function loadStudyBook() {
  const id = ++studyLoadId;
  const bookId = $('study-book').value;
  $('study-session').classList.add('hidden');
  message('study-message', '正在读取词书…');
  try {
    const items = bookId === 'custom' ? studyState.custom : (await getJSON(`/api/book?id=${encodeURIComponent(bookId)}`)).items;
    if (id !== studyLoadId) return;
    studyItems = items;
    studyState.activeBook = bookId;
    const plan = currentStudyPlan();
    $('study-new-target').value = plan.newPerDay;
    $('study-review-target').value = plan.reviewPerDay;
    renderStudyStats();
    message('study-message', items.length ? '词书已就绪，开始今天的练习吧。' : '这本词书还是空的，可把当前选中的词加入我的词表。');
    saveStudyState().catch(error => message('study-message', `记录保存失败：${error.message}`, true));
  } catch (error) { message('study-message', error.message, true); }
}
$('study-book').addEventListener('change', loadStudyBook);

function studyKey(item) { return `${$('study-book').value}:${item.word}`; }
function currentStudyPlan() { return studyState.plans?.[$('study-book').value] || { newPerDay: 20, reviewPerDay: 40 }; }
function currentDailyStudy() {
  const bookId = $('study-book').value;
  return studyState.daily?.[todayISO()]?.[bookId] || { new: [], review: [] };
}
function renderStudyStats() {
  const entries = studyItems.map(item => studyState.progress[studyKey(item)]);
  const done = currentDailyStudy();
  const plan = currentStudyPlan();
  const due = studyItems.filter(item => {
    const record = studyState.progress[studyKey(item)];
    return record && record.due <= todayISO() && record.firstSeen !== todayISO() && !done.review.includes(item.word);
  }).length;
  const unseen = entries.filter(item => !item).length;
  const pendingNew = studyItems.filter(item => {
    const record = studyState.progress[studyKey(item)];
    return record?.firstSeen === todayISO() && record.due <= todayISO() && !done.new.includes(item.word);
  }).length;
  const newGoal = Math.min(plan.newPerDay, done.new.length + pendingNew + unseen);
  const reviewGoal = Math.min(plan.reviewPerDay, done.review.length + due);
  const totalGoal = newGoal + reviewGoal;
  const completed = Math.min(done.new.length, newGoal) + Math.min(done.review.length, reviewGoal);
  $('study-total').textContent = studyItems.length;
  $('study-due').textContent = due;
  $('study-learned').textContent = entries.filter(item => item && item.seen > 0).length;
  $('study-today-progress').textContent = `新词 ${done.new.length}/${newGoal} · 复习 ${done.review.length}/${reviewGoal}`;
  $('study-plan-meter-fill').style.width = `${totalGoal ? Math.round(100 * completed / totalGoal) : 100}%`;
  $('study-plan-note').textContent = totalGoal && completed >= totalGoal ? '今日计划已完成，明天继续保持。' : `还需完成 ${Math.max(0, newGoal - done.new.length)} 个新词和 ${Math.max(0, reviewGoal - done.review.length)} 个复习词。`;
  const remainingNew = unseen + pendingNew;
  const days = Math.ceil(remainingNew / plan.newPerDay);
  $('study-finish-date').textContent = remainingNew ? `约 ${days} 天学完新词 · 预计 ${todayISO(days - 1)}` : '新词已学完 · 按计划继续复习';
  $('start-study').textContent = totalGoal && completed >= totalGoal ? '今日计划已完成' : '开始今日任务';
}

$('save-study-plan').addEventListener('click', async () => {
  const newPerDay = Number($('study-new-target').value);
  const reviewPerDay = Number($('study-review-target').value);
  if (!Number.isInteger(newPerDay) || newPerDay < 1 || newPerDay > 100 || !Number.isInteger(reviewPerDay) || reviewPerDay < 0 || reviewPerDay > 200) {
    return message('study-message', '每天新学请设为 1–100，最多复习请设为 0–200。', true);
  }
  studyState.plans[$('study-book').value] = { newPerDay, reviewPerDay };
  try {
    await saveStudyState();
    renderStudyStats();
    message('study-message', '每日计划已保存。');
  } catch (error) { message('study-message', `计划保存失败：${error.message}`, true); }
});

$('study-from-current').addEventListener('click', async () => {
  const chosen = words.filter(word => selected.has(word));
  if (!chosen.length) return message('study-message', '请先导入或生成词表，并选择要背的单词。', true);
  const existing = new Set(studyState.custom.map(item => item.word));
  let added = 0;
  for (const word of chosen) {
    if (existing.has(word)) continue;
    const detail = wordDetails.get(word) || {};
    studyState.custom.push({ word, meaning: detail.meaning || '', phonetic: detail.phonetic || '' });
    existing.add(word);
    added++;
  }
  $('study-book').value = 'custom';
  try {
    await saveStudyState();
    await loadStudyBook();
    message('study-message', `已加入 ${added} 个新词到“我的词表”。`);
  } catch (error) { message('study-message', error.message, true); }
});

function startStudy(mode = 'review') {
  if (!studyItems.length) return message('study-message', '请先选择有单词的词书。', true);
  const plan = currentStudyPlan();
  const done = currentDailyStudy();
  const due = studyItems.filter(item => {
    const record = studyState.progress[studyKey(item)];
    return record && record.firstSeen !== todayISO() && record.due <= todayISO() && !done.review.includes(item.word);
  }).sort((a, b) => studyState.progress[studyKey(a)].due.localeCompare(studyState.progress[studyKey(b)].due));
  const pendingNew = studyItems.filter(item => {
    const record = studyState.progress[studyKey(item)];
    return record?.firstSeen === todayISO() && record.due <= todayISO() && !done.new.includes(item.word);
  });
  const fresh = studyItems.filter(item => !studyState.progress[studyKey(item)]);
  const newRemaining = Math.max(0, plan.newPerDay - done.new.length);
  const reviewRemaining = Math.max(0, plan.reviewPerDay - done.review.length);
  const todayNew = [...pendingNew.slice(0, newRemaining), ...fresh.slice(0, Math.max(0, newRemaining - pendingNew.length))];
  studyQueue = [...due.slice(0, reviewRemaining), ...todayNew];
  if (!studyQueue.length) return message('study-message', '今天的计划已完成；有待复习的单词会按到期日再次出现。');
  studyRepeats.clear();
  studyOrigins.clear();
  for (const item of due) studyOrigins.set(studyKey(item), 'review');
  for (const item of todayNew) studyOrigins.set(studyKey(item), 'new');
  studyIndex = 0;
  studyMode = mode;
  $('study-session').classList.remove('hidden');
  renderStudyCard();
  $('study-session').scrollIntoView({ behavior: 'smooth', block: 'start' });
}
$('start-study').addEventListener('click', () => startStudy('review'));
$('start-spelling').addEventListener('click', () => startStudy('spelling'));

async function enrichStudyCard(item) {
  const word = item.word;
  try {
    if (!dictionaryCache.has(word)) dictionaryCache.set(word, getJSON(`/api/dictionary?word=${encodeURIComponent(word)}`));
    const detail = await dictionaryCache.get(word);
    if (studyCurrent !== item) return;
    if (detail.phonetic) $('study-phonetic').textContent = detail.phonetic;
    $('study-example').textContent = detail.example ? `例句：${detail.example}` : '暂无词典例句';
    item.audio = detail.audio;
    if (!detail.audio) $('study-audio').textContent = '▶ 系统朗读';
  } catch { if (studyCurrent === item) $('study-example').textContent = '词典暂不可用'; }
}
function speakStudyWord() {
  if (!studyCurrent) return;
  if (studyAudio) { studyAudio.pause(); studyAudio = null; }
  if (studyCurrent.audio) {
    studyAudio = new Audio(studyCurrent.audio);
    studyAudio.play().catch(() => fallbackSpeech());
  } else fallbackSpeech();
}
function fallbackSpeech() {
  if (!('speechSynthesis' in window)) return message('study-message', '当前系统没有可用朗读功能。', true);
  speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(studyCurrent.word);
  utterance.lang = 'en-US';
  utterance.rate = .85;
  speechSynthesis.speak(utterance);
}
$('study-audio').addEventListener('click', speakStudyWord);
function checkSpelling() {
  if (!studyCurrent || studyMode !== 'spelling') return;
  const input = $('study-spelling-input').value.trim().toLowerCase();
  if (!input) return message('study-message', '先输入单词，再检查拼写。', true);
  const correct = input === studyCurrent.word.toLowerCase();
  $('study-spelling-result').textContent = correct ? '拼写正确！' : `拼写有误，正确答案：${studyCurrent.word}`;
  $('study-spelling-result').classList.toggle('error', !correct);
  $('study-word').textContent = studyCurrent.word;
  $('study-word').classList.remove('hidden');
  $('study-answer').classList.remove('hidden');
  $('study-meaning').textContent = studyCurrent.meaning || '';
  $('study-phase').textContent = correct ? '拼写正确，进入下一个' : '再看一遍，稍后重练';
  $('check-spelling').disabled = true;
  $('again-study').classList.toggle('hidden', correct);
  $('remember-study').classList.toggle('hidden', !correct);
  $('reveal-study').classList.add('hidden');
}
$('check-spelling').addEventListener('click', checkSpelling);
$('study-spelling-input').addEventListener('keydown', event => { if (event.key === 'Enter') checkSpelling(); });

function renderStudyCard() {
  studyCurrent = studyQueue[studyIndex];
  if (!studyCurrent) {
    $('study-session').classList.add('hidden');
    message('study-message', `本次完成 ${studyIndex} 张卡片，进度已保存。`);
    renderStudyStats();
    return;
  }
  $('study-position').textContent = `${studyIndex + 1} / ${studyQueue.length}`;
  $('study-phase').textContent = '先回忆，再翻面';
  $('study-meter-fill').style.width = `${Math.round(studyIndex / studyQueue.length * 100)}%`;
  $('study-word').textContent = studyCurrent.word;
  $('study-word').classList.toggle('hidden', studyMode === 'spelling');
  $('study-phonetic').textContent = studyCurrent.phonetic ? `/${studyCurrent.phonetic.replace(/^\/+|\/+$/g, '')}/` : '正在查询音标…';
  $('study-example').textContent = '正在查询词典例句…';
  $('study-audio').textContent = '▶ 真人发音';
  $('study-spelling').classList.toggle('hidden', studyMode !== 'spelling');
  $('study-spelling-input').value = '';
  $('study-spelling-result').textContent = '';
  $('check-spelling').disabled = false;
  $('reveal-study').classList.toggle('hidden', studyMode === 'spelling');
  if (studyMode === 'spelling') {
    $('study-phase').textContent = '听发音，按释义拼写';
    $('study-spelling-input').focus();
  }
  enrichStudyCard(studyCurrent);
  $('study-meaning').textContent = '';
  $('study-answer-note').textContent = '';
  $('study-answer').classList.add('hidden');
  $('reveal-study').classList.toggle('hidden', studyMode === 'spelling');
  $('again-study').classList.add('hidden');
  $('remember-study').classList.add('hidden');
}

$('reveal-study').addEventListener('click', async () => {
  if (!studyCurrent) return;
  const item = studyCurrent;
  $('study-answer').classList.remove('hidden');
  $('reveal-study').classList.add('hidden');
  $('again-study').classList.remove('hidden');
  $('remember-study').classList.remove('hidden');
  $('study-phase').textContent = '判断自己是否记住了';
  if (item.meaning) {
    $('study-meaning').textContent = item.meaning;
    return;
  }
  $('study-meaning').textContent = '正在查询中文释义…';
  try {
    const request = sharedRequest();
    const result = await post('/api/translate-selection', JSON.stringify({ ...request, text: item.word }), { 'Content-Type': 'application/json' });
    item.meaning = result.translation;
    if (studyCurrent === item) {
      $('study-meaning').textContent = result.translation;
      $('study-answer-note').textContent = result.note;
    }
    if ($('study-book').value === 'custom') saveStudyState().catch(() => {});
  } catch {
    if (studyCurrent === item) $('study-meaning').textContent = '暂无释义，请配置 AI 接口后重试。';
  }
});

async function rateStudy(remembered) {
  if (!studyCurrent) return;
  const key = studyKey(studyCurrent);
  const prior = studyState.progress[key] || { box: 0, seen: 0, due: todayISO() };
  const box = remembered ? Math.min(5, prior.box + 1) : 0;
  studyState.progress[key] = { box, seen: prior.seen + 1, due: remembered ? todayISO([0, 1, 2, 4, 8, 16][box]) : todayISO(), firstSeen: prior.firstSeen || todayISO() };
  if (remembered) {
    const date = todayISO();
    studyState.daily[date] ||= {};
    studyState.daily[date][$('study-book').value] ||= { new: [], review: [] };
    const list = studyState.daily[date][$('study-book').value][studyOrigins.get(key) || 'review'];
    if (!list.includes(studyCurrent.word)) list.push(studyCurrent.word);
  }
  if (!remembered) {
    studyQueue.push(studyCurrent);
  }
  $('again-study').disabled = true;
  $('remember-study').disabled = true;
  try {
    await saveStudyState();
    renderProgress();
    renderStudyStats();
    studyIndex++;
    renderStudyCard();
  } catch (error) { message('study-message', `进度保存失败：${error.message}`, true); }
  finally { $('again-study').disabled = false; $('remember-study').disabled = false; }
}
$('again-study').addEventListener('click', () => rateStudy(false));
$('remember-study').addEventListener('click', () => rateStudy(true));
document.addEventListener('keydown', event => {
  if ($('view-study').classList.contains('hidden') || $('study-session').classList.contains('hidden') || ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) return;
  if (event.code === 'Space' && !$('reveal-study').classList.contains('hidden')) { event.preventDefault(); $('reveal-study').click(); }
  if (event.key === '1' && !$('again-study').classList.contains('hidden')) $('again-study').click();
  if (event.key === '2' && !$('remember-study').classList.contains('hidden')) $('remember-study').click();
});
const studyReady = loadStudyData();

$('download-vocabulary').addEventListener('click', () => {
  if (!latestVocabulary) return;
  const csvCell = value => `"${String(value).replaceAll('"', '""')}"`;
  const rows = [['word', 'meaning', 'example'], ...latestVocabulary.items.map(item => [item.word, item.meaning, item.example])];
  const blob = new Blob(['\ufeff' + rows.map(row => row.map(csvCell).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = 'AI词汇表.csv';
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

function download(filename, text) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/markdown;charset=utf-8' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function recordActivity(kind, title) {
  const at = new Date().toISOString();
  studyState.activity = [...(studyState.activity || []), { kind, title: String(title || '').slice(0, 120), at }].slice(-500);
  renderProgress();
  saveStudyState().then(renderProgress).catch(error => console.warn('练习记录保存失败', error));
  return at;
}

function dateKey(value) {
  const day = new Date(value);
  return `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
}
function formatActivityTime(iso) {
  const day = dateKey(iso);
  const time = new Date(iso).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  if (day === todayISO()) return `今天 ${time}`;
  if (day === todayISO(-1)) return `昨天 ${time}`;
  return `${day.slice(5)} ${time}`;
}
function activityCounts() {
  const counts = { story: 0, exam: 0, translation: 0, vocabulary: 0 };
  for (const item of studyState.activity || []) if (item.kind in counts) counts[item.kind]++;
  return counts;
}
// Per-day totals: flashcards completed (new + review across all books) and AI practices.
function dailyTotals() {
  const totals = {};
  for (const [date, books] of Object.entries(studyState.daily || {})) {
    let count = 0;
    for (const book of Object.values(books)) count += (book.new?.length || 0) + (book.review?.length || 0);
    if (count) totals[date] = { study: count, practice: 0 };
  }
  for (const item of studyState.activity || []) {
    const date = dateKey(item.at);
    totals[date] ||= { study: 0, practice: 0 };
    totals[date].practice++;
  }
  return totals;
}
function renderActivityList(container, items) {
  container.replaceChildren();
  if (!items.length) {
    container.append(make('div', 'empty-activity', '完成一次 AI 练习后，记录会显示在这里。'));
    return;
  }
  for (const item of items) {
    const row = make('div', 'activity-row');
    const details = make('div');
    const label = ACTIVITY_LABELS[item.kind] + (typeof item.score === 'number' ? ` · ${item.score}/5 分` : '');
    details.append(make('strong', '', label), make('span', '', item.title));
    row.append(make('span', `activity-dot dot-${item.kind}`, '✓'), details, make('time', '', formatActivityTime(item.at)));
    container.append(row);
  }
}

function renderProgress() {
  const counts = activityCounts();
  $('stat-words').textContent = selected.size;
  $('stat-studies').textContent = dailyTotals()[todayISO()]?.study || 0;
  $('stat-stories').textContent = counts.story;
  $('stat-exams').textContent = counts.exam;
  $('stat-translations').textContent = counts.translation;
  $('stat-vocabularies').textContent = counts.vocabulary;
  renderActivityList($('activity-list'), [...(studyState.activity || [])].reverse().slice(0, 5));
  if (!$('view-profile').classList.contains('hidden')) renderProfile();
}

function renderAvatar() {
  $('profile-avatar').textContent = nickname ? [...nickname][0].toUpperCase() : '学';
}
function streakDays(totals) {
  let streak = 0;
  // Today without activity yet does not break a streak that ended yesterday.
  let offset = totals[todayISO()] ? 0 : -1;
  while (totals[todayISO(offset)]) { streak++; offset--; }
  return streak;
}
function renderProfile() {
  const totals = dailyTotals();
  const records = Object.values(studyState.progress || {});
  const activeDates = Object.keys(totals).sort();
  const exams = (studyState.activity || []).filter(item => item.kind === 'exam' && typeof item.score === 'number');
  const counts = activityCounts();
  $('profile-streak').textContent = streakDays(totals);
  $('profile-since').textContent = activeDates.length ? `从 ${activeDates[0]} 开始学习 · 已坚持 ${activeDates.length} 天` : '开始背词或完成一次练习后，这里会记录你的成长。';
  $('kpi-learned').textContent = records.filter(item => item.seen > 0).length;
  $('kpi-mastered').textContent = records.filter(item => item.box >= 4).length;
  $('kpi-today').textContent = totals[todayISO()]?.study || 0;
  $('kpi-days').textContent = activeDates.length;
  $('kpi-practice').textContent = (studyState.activity || []).length;
  $('kpi-exam').textContent = exams.length ? (exams.reduce((sum, item) => sum + item.score, 0) / exams.length).toFixed(1) : '—';

  const chart = $('trend-chart');
  chart.replaceChildren();
  const days = Array.from({ length: 30 }, (_, index) => todayISO(index - 29));
  const peak = Math.max(1, ...days.map(day => (totals[day]?.study || 0) + (totals[day]?.practice || 0) * 5));
  for (const day of days) {
    const value = totals[day] || { study: 0, practice: 0 };
    const column = make('div', 'trend-column' + (day === todayISO() ? ' today' : ''));
    column.title = `${day}：背词 ${value.study} 个，练习 ${value.practice} 次`;
    const practice = make('span', 'trend-practice');
    practice.style.height = `${(value.practice * 5) / peak * 100}%`;
    const study = make('span', 'trend-study');
    study.style.height = `${value.study / peak * 100}%`;
    column.append(practice, study);
    chart.append(column);
  }
  $('trend-start').textContent = days[0].slice(5);

  const learnedByBook = {};
  for (const [key, record] of Object.entries(studyState.progress || {})) {
    if (!(record.seen > 0)) continue;
    const book = key.split(':')[0];
    learnedByBook[book] = (learnedByBook[book] || 0) + 1;
  }
  const books = [{ id: 'custom', title: '我的词表', count: (studyState.custom || []).length }, ...bookMeta];
  const bookList = $('book-progress');
  bookList.replaceChildren();
  for (const book of books) {
    const learned = learnedByBook[book.id] || 0;
    const percent = book.count ? Math.min(100, Math.round(learned / book.count * 100)) : 0;
    const row = make('div', 'book-row' + (learned ? '' : ' idle'));
    const head = make('div', 'book-row-head');
    head.append(make('strong', '', book.title), make('span', '', `${learned} / ${book.count} · ${percent}%`));
    const bar = make('div', 'book-bar');
    const fill = make('span');
    fill.style.width = `${percent}%`;
    bar.append(fill);
    row.append(head, bar);
    bookList.append(row);
  }

  const breakdown = $('practice-breakdown');
  breakdown.replaceChildren();
  for (const [kind, label] of Object.entries(ACTIVITY_LABELS)) {
    const cell = make('div', `breakdown-${kind}`);
    cell.append(make('strong', '', String(counts[kind])), make('span', '', label));
    breakdown.append(cell);
  }
  renderActivityList($('profile-activity'), [...(studyState.activity || [])].reverse().slice(0, 10));
}

let nicknameTimer;
$('profile-nickname').addEventListener('input', () => {
  nickname = $('profile-nickname').value.trim().slice(0, 30);
  renderAvatar();
  clearTimeout(nicknameTimer);
  nicknameTimer = setTimeout(() => { scheduleSave(); message('profile-name-status', '已保存'); }, 500);
});

$('export-data').addEventListener('click', () => {
  const payload = { app: 'VocabStudio', exported_at: new Date().toISOString(), settings: { api_url: endpoint($('api-url').value), model: $('model').value.trim(), theme: document.body.dataset.theme, nickname }, study: studyState };
  const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `词页学习数据-${todayISO()}.json`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  message('data-message', '已导出学习数据（不含 API Key）。');
});
$('clear-activity').addEventListener('click', async () => {
  if (!(studyState.activity || []).length) return message('data-message', '当前没有练习记录。');
  if (!confirm('确定清空全部 AI 练习记录吗？背词进度不受影响。')) return;
  const previous = studyState.activity;
  studyState.activity = [];
  try {
    await saveStudyState();
    renderProgress();
    message('data-message', '练习记录已清空。');
  } catch (error) {
    studyState.activity = previous;
    message('data-message', `清空失败：${error.message}`, true);
  }
});

renderProgress();
showView('home');

function renderResult(result) {
  $('story-title').textContent = result.title;
  $('coverage').textContent = `${result.words.length - result.missing.length}/${result.words.length} 词覆盖`;
  $('translation').textContent = result.translation;
  const passage = $('passage');
  passage.replaceChildren();
  const pattern = new RegExp(`(?<![A-Za-z])(${result.words.map(escapeRegExp).join('|')})(?![A-Za-z])`, 'gi');
  let cursor = 0;
  for (const match of result.passage.matchAll(pattern)) {
    passage.append(document.createTextNode(result.passage.slice(cursor, match.index)));
    const mark = document.createElement('mark');
    mark.textContent = match[0];
    passage.append(mark);
    cursor = match.index + match[0].length;
  }
  passage.append(document.createTextNode(result.passage.slice(cursor)));
  $('result-card').classList.remove('hidden');
  showTab('english');
  $('result-card').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function escapeRegExp(value) { return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

function hideSelectionTranslation() {
  selectionRequest++;
  $('selection-translation').classList.add('hidden');
}
function selectionInReading() {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || !selection.rangeCount) return null;
  const range = selection.getRangeAt(0);
  const reading = [$("passage"), $("exam-passage")].find(node => !node.classList.contains('hidden') && node.contains(range.startContainer) && node.contains(range.endContainer));
  if (!reading || reading.closest('.mode-view.hidden')) return null;
  return { text: selection.toString().trim().replace(/\s+/g, ' '), context: reading.textContent, rect: range.getBoundingClientRect() };
}
function placeSelectionTranslation(rect) {
  const popover = $('selection-translation');
  const width = Math.min(370, window.innerWidth - 24);
  popover.style.width = `${width}px`;
  popover.style.left = `${Math.max(12, Math.min(rect.left, window.innerWidth - width - 12))}px`;
  const height = popover.getBoundingClientRect().height;
  popover.style.top = `${rect.bottom + height + 12 < window.innerHeight ? rect.bottom + 10 : Math.max(10, rect.top - height - 10)}px`;
}
async function translateCurrentSelection() {
  const selectedText = selectionInReading();
  if (!selectedText || !selectedText.text) return;
  const id = ++selectionRequest;
  const popover = $('selection-translation');
  $('selection-source').textContent = selectedText.text;
  $('selection-result').textContent = selectedText.text.length > 500 ? '选中内容较长，请缩短到 500 字符以内。' : '正在翻译…';
  $('selection-note').textContent = '';
  popover.classList.remove('hidden');
  placeSelectionTranslation(selectedText.rect);
  if (selectedText.text.length > 500) return;
  try {
    const request = sharedRequest();
    const result = await post('/api/translate-selection', JSON.stringify({ ...request, text: selectedText.text, context: selectedText.context }), { 'Content-Type': 'application/json' });
    if (id !== selectionRequest) return;
    $('selection-result').textContent = result.translation;
    $('selection-note').textContent = result.note;
    placeSelectionTranslation(selectedText.rect);
  } catch (error) {
    if (id !== selectionRequest) return;
    $('selection-result').textContent = error.message;
    $('selection-note').textContent = '';
    placeSelectionTranslation(selectedText.rect);
  }
}
document.addEventListener('selectionchange', () => {
  clearTimeout(selectionTimer);
  selectionTimer = setTimeout(translateCurrentSelection, 450);
});
document.querySelectorAll('.selectable-reading').forEach(reading => reading.addEventListener('pointerup', () => {
  clearTimeout(selectionTimer);
  setTimeout(translateCurrentSelection, 0);
}));
$('close-selection-translation').addEventListener('click', hideSelectionTranslation);
window.addEventListener('scroll', hideSelectionTranslation, { passive: true });
function showTab(tab) {
  $('passage').classList.toggle('hidden', tab !== 'english');
  $('translation').classList.toggle('hidden', tab !== 'chinese');
  $('tab-english').classList.toggle('active', tab === 'english');
  $('tab-chinese').classList.toggle('active', tab === 'chinese');
}
$('tab-english').addEventListener('click', () => showTab('english'));
$('tab-chinese').addEventListener('click', () => showTab('chinese'));
$('copy').addEventListener('click', async () => {
  if (!latest) return;
  try {
    await navigator.clipboard.writeText(`${latest.title}\n\n${latest.passage}`);
    $('copy').textContent = '✓ 已复制';
    setTimeout(() => $('copy').textContent = '复制原文', 1600);
  } catch { message('generate-message', '复制失败，请手动选中短文。', true); }
});
$('download').addEventListener('click', () => {
  if (!latest) return;
  const markdown = `# ${latest.title}\n\n${latest.passage}\n\n## 中文译文\n\n${latest.translation}\n\n## 目标单词\n\n${latest.words.join(', ')}\n`;
  const url = URL.createObjectURL(new Blob([markdown], { type: 'text/markdown;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = '阅读短文.md';
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
