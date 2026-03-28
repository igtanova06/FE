const STORAGE_KEY = "nwc-quiz-lab-state-v1";
const CRAM_TARGET_COUNT = 300;
const CRAM_BLOCK_SIZE = 50;
const OPTION_SHORTCUT_KEYS = ["a", "b", "c", "d", "e", "f", "g", "h", "j"];

const quizBank = window.QUIZ_BANK || { modules: [], questions: [], sources: [] };
const questionMap = new Map(quizBank.questions.map((question) => [question.id, question]));
const moduleMap = new Map(quizBank.modules.map((module) => [module.id, module]));

const state = loadState();
reconcileState();
bindControls();
renderApp();

function loadState() {
  const defaultState = {
    mode: "practice",
    moduleId: "all",
    filter: "all",
    search: "",
    currentQuestionId: null,
    shuffledIds: [],
    retakeSessionIds: [],
    retakeSessionRecords: {},
    cramSessionIds: [],
    cramSessionRecords: {},
    cramBlockIndex: 0,
    cramSourceModuleId: "all",
    records: {},
  };

  try {
    const rawState = window.localStorage.getItem(STORAGE_KEY);
    if (!rawState) {
      return defaultState;
    }

    const parsedState = JSON.parse(rawState);
    if (parsedState.sessionRecords && !parsedState.retakeSessionRecords) {
      parsedState.retakeSessionRecords = parsedState.sessionRecords;
    }

    return { ...defaultState, ...parsedState };
  } catch (error) {
    return defaultState;
  }
}

function saveState() {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function reconcileState() {
  const validIds = new Set(quizBank.questions.map((question) => question.id));

  Object.keys(state.records).forEach((questionId) => {
    if (!validIds.has(questionId)) {
      delete state.records[questionId];
      return;
    }

    normalizeGlobalRecord(state.records[questionId]);
  });

  Object.keys(state.retakeSessionRecords).forEach((questionId) => {
    if (!validIds.has(questionId)) {
      delete state.retakeSessionRecords[questionId];
      return;
    }

    normalizeSpecialRecord(state.retakeSessionRecords[questionId]);
  });

  Object.keys(state.cramSessionRecords).forEach((questionId) => {
    if (!validIds.has(questionId)) {
      delete state.cramSessionRecords[questionId];
      return;
    }

    normalizeSpecialRecord(state.cramSessionRecords[questionId]);
  });

  state.search = String(state.search || "");
  state.moduleId = moduleMap.has(state.moduleId) ? state.moduleId : "all";
  state.filter = ["all", "unanswered", "incorrect", "starred"].includes(state.filter)
    ? state.filter
    : "all";
  state.mode = ["practice", "review"].includes(state.mode) ? state.mode : "practice";
  state.shuffledIds = normalizeIdList(state.shuffledIds, validIds);
  state.retakeSessionIds = normalizeIdList(state.retakeSessionIds, validIds);
  state.cramSessionIds = normalizeIdList(state.cramSessionIds, validIds);
  state.cramBlockIndex = Number.isInteger(state.cramBlockIndex) ? state.cramBlockIndex : 0;
  state.cramSourceModuleId =
    state.cramSourceModuleId === "all" || moduleMap.has(state.cramSourceModuleId)
      ? state.cramSourceModuleId
      : "all";

  const totalCramBlocks = Math.ceil(state.cramSessionIds.length / CRAM_BLOCK_SIZE);
  state.cramBlockIndex = totalCramBlocks
    ? Math.min(state.cramBlockIndex, totalCramBlocks - 1)
    : 0;

  if (!validIds.has(state.currentQuestionId)) {
    state.currentQuestionId = quizBank.questions[0]?.id || null;
  }
}

function normalizeIdList(values, validIds) {
  if (!Array.isArray(values)) {
    return [];
  }

  return values.filter((value) => validIds.has(value));
}

function normalizeGlobalRecord(record) {
  record.selected = Array.isArray(record.selected) ? record.selected : [];
  record.checked = Boolean(record.checked);
  record.revealed = Boolean(record.revealed);
  record.starred = Boolean(record.starred);
  record.correct = typeof record.correct === "boolean" ? record.correct : null;
  record.needsRetry = Boolean(record.needsRetry);
}

function normalizeSpecialRecord(record) {
  record.selected = Array.isArray(record.selected) ? record.selected : [];
  record.checked = Boolean(record.checked);
  record.revealed = Boolean(record.revealed);
  record.correct = typeof record.correct === "boolean" ? record.correct : null;
}

function isRetakeSessionActive() {
  return state.retakeSessionIds.length > 0;
}

function isCramSessionActive() {
  return state.cramSessionIds.length > 0;
}

function isSpecialSessionActive() {
  return isRetakeSessionActive() || isCramSessionActive();
}

function shouldIgnoreQuizShortcut(event) {
  if (event.altKey || event.ctrlKey || event.metaKey) {
    return true;
  }

  const activeElement = document.activeElement;
  if (!activeElement) {
    return false;
  }

  const tagName = activeElement.tagName;
  return (
    activeElement.isContentEditable ||
    tagName === "INPUT" ||
    tagName === "TEXTAREA" ||
    tagName === "SELECT"
  );
}

function updateSelection(question, optionId) {
  if (!question || !question.options.length) {
    return;
  }

  const record = getInteractionRecord(question.id);
  if (record.checked && !isSpecialSessionActive() && state.mode !== "review") {
    return;
  }

  if (question.type === "multiple") {
    record.selected = toggleArrayValue(record.selected, optionId);
  } else {
    record.selected = record.selected[0] === optionId ? [] : [optionId];
  }

  if (!record.checked) {
    record.revealed = false;
    record.correct = null;
  }

  renderApp();
}

function submitCurrentAnswer() {
  const question = getCurrentQuestion();
  if (!question || !question.options.length) {
    return;
  }

  const interactionRecord = getInteractionRecord(question.id);
  if (!interactionRecord.selected.length) {
    return;
  }

  interactionRecord.checked = true;
  interactionRecord.revealed = true;
  interactionRecord.correct = compareSelections(question.correctOptionIds, interactionRecord.selected);

  const globalRecord = getGlobalRecord(question.id);
  globalRecord.selected = [...interactionRecord.selected];
  globalRecord.checked = true;
  globalRecord.revealed = true;
  globalRecord.correct = interactionRecord.correct;
  globalRecord.needsRetry = !interactionRecord.correct;

  renderApp();
}

function selectOptionByShortcut(shortcutKey) {
  const question = getCurrentQuestion();
  if (!question || !question.options.length) {
    return;
  }

  const optionIndex = OPTION_SHORTCUT_KEYS.indexOf(shortcutKey);
  if (optionIndex === -1) {
    return;
  }

  const option = question.options[optionIndex];
  if (!option) {
    return;
  }

  updateSelection(question, option.id);
}

function bindControls() {
  document.getElementById("mode-switch").addEventListener("click", (event) => {
    if (isSpecialSessionActive()) {
      return;
    }

    const button = event.target.closest("[data-mode]");
    if (!button) {
      return;
    }

    state.mode = button.dataset.mode;
    state.filter = state.mode === "review" ? "incorrect" : "all";
    state.shuffledIds = [];
    ensureCurrentQuestion();
    renderApp();
  });

  document.getElementById("status-filters").addEventListener("click", (event) => {
    if (isSpecialSessionActive()) {
      return;
    }

    const button = event.target.closest("[data-filter]");
    if (!button) {
      return;
    }

    state.filter = button.dataset.filter;
    state.shuffledIds = [];
    ensureCurrentQuestion();
    renderApp();
  });

  document.getElementById("module-filters").addEventListener("click", (event) => {
    if (isSpecialSessionActive()) {
      return;
    }

    const button = event.target.closest("[data-module-id]");
    if (!button) {
      return;
    }

    state.moduleId = button.dataset.moduleId;
    state.shuffledIds = [];
    ensureCurrentQuestion();
    renderApp();
  });

  document.getElementById("search-input").addEventListener("input", (event) => {
    if (isSpecialSessionActive()) {
      return;
    }

    state.search = event.target.value;
    state.shuffledIds = [];
    ensureCurrentQuestion();
    renderApp();
  });

  document.addEventListener("keydown", (event) => {
    if (shouldIgnoreQuizShortcut(event)) {
      return;
    }

    if (event.key === "Enter") {
      if (event.repeat) {
        return;
      }

      event.preventDefault();
      submitCurrentAnswer();
      return;
    }

    const shortcutKey = event.key.toLowerCase();
    if (OPTION_SHORTCUT_KEYS.includes(shortcutKey)) {
      if (event.repeat) {
        return;
      }

      event.preventDefault();
      selectOptionByShortcut(shortcutKey);
      return;
    }

    if (event.key === "ArrowLeft") {
      event.preventDefault();
      moveQuestion(-1);
      return;
    }

    if (event.key === "ArrowRight") {
      event.preventDefault();
      moveQuestion(1);
    }
  });

  document.getElementById("start-cram-btn").addEventListener("click", () => {
    if (isSpecialSessionActive()) {
      return;
    }

    startCramSession();
    renderApp();
  });

  document.getElementById("next-cram-block-btn").addEventListener("click", () => {
    if (!isCramSessionActive()) {
      return;
    }

    const summary = getCramSummary();
    if (state.cramBlockIndex >= summary.totalBlocks - 1) {
      return;
    }

    state.cramBlockIndex += 1;
    state.currentQuestionId = getCurrentCramBlockQuestions()[0]?.id || state.currentQuestionId;
    renderApp();
  });

  document.getElementById("end-cram-btn").addEventListener("click", () => {
    if (!isCramSessionActive()) {
      return;
    }

    endCramSession();
    renderApp();
  });

  document.getElementById("retry-incorrect-btn").addEventListener("click", () => {
    if (isSpecialSessionActive()) {
      return;
    }

    const preferredQuestions = state.moduleId !== "all" ? getRetryQuestions(state.moduleId) : [];
    const retryQuestions = preferredQuestions.length ? preferredQuestions : getRetryQuestions();

    if (!retryQuestions.length) {
      window.alert("Chưa có câu sai nào để luyện lại.");
      return;
    }

    retryQuestions.forEach((question) => {
      const record = getGlobalRecord(question.id);
      record.selected = [];
      record.checked = false;
      record.correct = null;
      record.revealed = false;
    });

    state.mode = "review";
    state.filter = "incorrect";
    state.search = "";
    state.shuffledIds = retryQuestions.map((question) => question.id);

    if (state.moduleId !== "all" && !preferredQuestions.length) {
      state.moduleId = "all";
    }

    state.currentQuestionId = state.shuffledIds[0] || retryQuestions[0].id;
    renderApp();
  });

  document.getElementById("retake-incorrect-btn").addEventListener("click", () => {
    if (isSpecialSessionActive()) {
      return;
    }

    startIncorrectRetakeSession();
    renderApp();
  });

  document.getElementById("exit-retake-btn").addEventListener("click", () => {
    if (!isRetakeSessionActive()) {
      return;
    }

    endRetakeSession();
    renderApp();
  });

  document.getElementById("shuffle-btn").addEventListener("click", () => {
    if (isSpecialSessionActive()) {
      return;
    }

    const visibleQuestions = getVisibleQuestions();
    state.shuffledIds = shuffleArray(visibleQuestions.map((question) => question.id));
    state.currentQuestionId = state.shuffledIds[0] || state.currentQuestionId;
    renderApp();
  });

  document.getElementById("reset-btn").addEventListener("click", () => {
    if (!window.confirm("Xóa toàn bộ tiến độ, câu đánh dấu và đáp án đã chọn?")) {
      return;
    }

    state.records = {};
    state.retakeSessionIds = [];
    state.retakeSessionRecords = {};
    state.cramSessionIds = [];
    state.cramSessionRecords = {};
    state.cramBlockIndex = 0;
    state.shuffledIds = [];
    ensureCurrentQuestion();
    renderApp();
  });

  document.getElementById("question-pills").addEventListener("click", (event) => {
    const button = event.target.closest("[data-question-id]");
    if (!button) {
      return;
    }

    state.currentQuestionId = button.dataset.questionId;
    renderApp();
  });

  document.getElementById("options-list").addEventListener("click", (event) => {
    const button = event.target.closest("[data-option-id]");
    if (!button) {
      return;
    }

    const question = getCurrentQuestion();
    updateSelection(question, button.dataset.optionId);
  });

  document.getElementById("check-btn").addEventListener("click", () => {
    submitCurrentAnswer();
  });

  document.getElementById("reveal-btn").addEventListener("click", () => {
    const question = getCurrentQuestion();
    if (!question) {
      return;
    }

    const interactionRecord = getInteractionRecord(question.id);
    interactionRecord.revealed = true;
    if (!interactionRecord.checked) {
      interactionRecord.correct = null;
    }

    renderApp();
  });

  ["prev-btn-top", "prev-btn-bottom"].forEach((buttonId) => {
    document.getElementById(buttonId).addEventListener("click", () => moveQuestion(-1));
  });

  ["next-btn-top", "next-btn-bottom"].forEach((buttonId) => {
    document.getElementById(buttonId).addEventListener("click", () => moveQuestion(1));
  });

  document.getElementById("bookmark-btn").addEventListener("click", () => {
    const question = getCurrentQuestion();
    if (!question) {
      return;
    }

    const globalRecord = getGlobalRecord(question.id);
    globalRecord.starred = !globalRecord.starred;
    renderApp();
  });
}

function startIncorrectRetakeSession() {
  const preferredQuestions = state.moduleId !== "all" ? getRetryQuestions(state.moduleId) : [];
  const sessionQuestions = preferredQuestions.length ? preferredQuestions : getRetryQuestions();

  if (!sessionQuestions.length) {
    window.alert("Chưa có câu sai nào để thi lại.");
    return;
  }

  state.retakeSessionIds = sessionQuestions.map((question) => question.id);
  state.retakeSessionRecords = {};
  state.mode = "practice";
  state.filter = "all";
  state.search = "";
  state.shuffledIds = [];
  state.currentQuestionId = state.retakeSessionIds[0];
}

function endRetakeSession() {
  state.retakeSessionIds = [];
  state.retakeSessionRecords = {};
  state.shuffledIds = [];
  ensureCurrentQuestion();
}

function startCramSession() {
  const sessionIds = buildCramSessionIds();
  if (!sessionIds.length) {
    window.alert("Không có câu hỏi nào để bắt đầu Cram 1 Day.");
    return;
  }

  state.cramSessionIds = sessionIds;
  state.cramSessionRecords = {};
  state.cramBlockIndex = 0;
  state.cramSourceModuleId = state.moduleId;
  state.mode = "practice";
  state.filter = "all";
  state.search = "";
  state.shuffledIds = [];
  state.currentQuestionId = sessionIds[0];
}

function endCramSession() {
  state.cramSessionIds = [];
  state.cramSessionRecords = {};
  state.cramBlockIndex = 0;
  state.cramSourceModuleId = "all";
  state.shuffledIds = [];
  ensureCurrentQuestion();
}

function buildCramSessionIds() {
  const candidateQuestions = getCramCandidateQuestions();
  if (!candidateQuestions.length) {
    return [];
  }

  const incorrectQuestions = shuffleArray(
    candidateQuestions.filter((question) => getGlobalRecord(question.id).needsRetry),
  );
  const incorrectIds = new Set(incorrectQuestions.map((question) => question.id));

  const unansweredQuestions = shuffleArray(
    candidateQuestions.filter(
      (question) =>
        !incorrectIds.has(question.id) && !isQuestionAnswered(question, state.records[question.id]),
    ),
  );
  const unansweredIds = new Set(unansweredQuestions.map((question) => question.id));

  const remainingQuestions = shuffleArray(
    candidateQuestions.filter(
      (question) => !incorrectIds.has(question.id) && !unansweredIds.has(question.id),
    ),
  );

  return [...incorrectQuestions, ...unansweredQuestions, ...remainingQuestions]
    .slice(0, Math.min(CRAM_TARGET_COUNT, candidateQuestions.length))
    .map((question) => question.id);
}

function getCramCandidateQuestions() {
  let candidateQuestions = [...quizBank.questions];

  if (state.moduleId !== "all") {
    candidateQuestions = candidateQuestions.filter((question) => question.moduleId === state.moduleId);
  }

  return candidateQuestions;
}

function getCramAllQuestions() {
  return state.cramSessionIds
    .map((questionId) => questionMap.get(questionId))
    .filter(Boolean);
}

function getCurrentCramBlockQuestions() {
  const allQuestions = getCramAllQuestions();
  const startIndex = state.cramBlockIndex * CRAM_BLOCK_SIZE;
  return allQuestions.slice(startIndex, startIndex + CRAM_BLOCK_SIZE);
}

function getCramSummary() {
  const allQuestions = getCramAllQuestions();
  const currentBlockQuestions = getCurrentCramBlockQuestions();
  const totalBlocks = Math.ceil(allQuestions.length / CRAM_BLOCK_SIZE) || 0;

  const answeredTotal = allQuestions.filter((question) =>
    isQuestionAnswered(question, getCramSessionRecord(question.id)),
  ).length;
  const correctTotal = allQuestions.filter((question) => getCramSessionRecord(question.id).correct).length;
  const answeredBlock = currentBlockQuestions.filter((question) =>
    isQuestionAnswered(question, getCramSessionRecord(question.id)),
  ).length;

  return {
    totalQuestions: allQuestions.length,
    totalBlocks,
    currentBlockIndex: totalBlocks ? state.cramBlockIndex : 0,
    currentBlockQuestions,
    answeredTotal,
    correctTotal,
    answeredBlock,
    remainingTotal: Math.max(allQuestions.length - answeredTotal, 0),
    finished: allQuestions.length > 0 && answeredTotal === allQuestions.length,
  };
}

function renderApp() {
  renderModeSwitch();
  renderModuleFilters();
  renderStatusFilters();
  renderCramPanel();
  renderActionButtons();
  renderSources();
  renderStats();
  renderNavigator();
  renderQuestion();
  renderSearchState();
  saveState();
}

function renderSearchState() {
  const searchInput = document.getElementById("search-input");
  searchInput.value = state.search;
  searchInput.disabled = isSpecialSessionActive();
}

function renderCramPanel() {
  const title = document.getElementById("cram-title");
  const copy = document.getElementById("cram-copy");
  const goal = document.getElementById("cram-goal");
  const block = document.getElementById("cram-block");
  const remaining = document.getElementById("cram-remaining");

  if (isCramSessionActive()) {
    const summary = getCramSummary();
    title.textContent = summary.finished ? "Đã hoàn thành cram hôm nay" : "Cram 1 Day đang chạy";
    copy.textContent = summary.finished
      ? `Bạn đã hoàn tất ${summary.totalQuestions} câu trong kế hoạch hôm nay. Có thể kết thúc cram hoặc làm lại các câu sai.`
      : `Ưu tiên câu sai rồi câu chưa làm. Đang ở chặng ${summary.currentBlockIndex + 1}/${summary.totalBlocks}, block hiện tại đã làm ${summary.answeredBlock}/${summary.currentBlockQuestions.length} câu.`;
    goal.textContent = String(summary.totalQuestions);
    block.textContent = `${summary.currentBlockIndex + 1}/${summary.totalBlocks}`;
    remaining.textContent = String(summary.remainingTotal);
    return;
  }

  const candidateQuestions = getCramCandidateQuestions();
  const plannedCount = Math.min(CRAM_TARGET_COUNT, candidateQuestions.length);
  const retryCount = candidateQuestions.filter((question) => getGlobalRecord(question.id).needsRetry).length;
  const unansweredCount = candidateQuestions.filter(
    (question) => !isQuestionAnswered(question, state.records[question.id]),
  ).length;
  const plannedBlocks = Math.ceil(plannedCount / CRAM_BLOCK_SIZE) || 0;
  const scopeLabel = getScopeLabel(state.moduleId);

  title.textContent = "Kế hoạch hôm nay";
  copy.textContent = `Từ ${scopeLabel}: tối đa ${plannedCount} câu, ưu tiên ${retryCount} câu sai và ${unansweredCount} câu chưa làm, chia theo chặng ${CRAM_BLOCK_SIZE} câu.`;
  goal.textContent = String(plannedCount);
  block.textContent = plannedBlocks ? `0/${plannedBlocks}` : "0/0";
  remaining.textContent = String(plannedCount);
}

function renderActionButtons() {
  const retryCount = getRetryQuestions().length;
  const retakeActive = isRetakeSessionActive();
  const cramActive = isCramSessionActive();
  const specialActive = isSpecialSessionActive();
  const cramSummary = cramActive ? getCramSummary() : null;

  const startCramButton = document.getElementById("start-cram-btn");
  startCramButton.disabled = specialActive || getCramCandidateQuestions().length === 0;
  startCramButton.textContent = "Bắt đầu Cram 1 Day";

  const nextCramButton = document.getElementById("next-cram-block-btn");
  nextCramButton.disabled = !cramActive || cramSummary.currentBlockIndex >= cramSummary.totalBlocks - 1;
  nextCramButton.textContent = cramActive
    ? `Sang chặng ${Math.min(cramSummary.currentBlockIndex + 2, cramSummary.totalBlocks)}/${cramSummary.totalBlocks}`
    : "Sang chặng tiếp";

  const endCramButton = document.getElementById("end-cram-btn");
  endCramButton.disabled = !cramActive;
  endCramButton.textContent = cramActive ? "Kết thúc cram" : "Chưa có cram đang chạy";

  const retryButton = document.getElementById("retry-incorrect-btn");
  retryButton.textContent = retryCount ? `Luyện lại câu sai (${retryCount})` : "Luyện lại câu sai";
  retryButton.disabled = retryCount === 0 || specialActive;

  const retakeButton = document.getElementById("retake-incorrect-btn");
  retakeButton.textContent = retryCount ? `Thi lại câu sai (${retryCount})` : "Thi lại câu sai";
  retakeButton.disabled = retryCount === 0 || specialActive;

  const exitRetakeButton = document.getElementById("exit-retake-btn");
  exitRetakeButton.disabled = !retakeActive;
  exitRetakeButton.textContent = retakeActive ? "Thoát phiên thi lại" : "Chưa có phiên thi lại";

  document.getElementById("shuffle-btn").disabled = specialActive;

  document.querySelectorAll("#mode-switch [data-mode]").forEach((button) => {
    button.disabled = specialActive;
  });

  document.querySelectorAll("#status-filters [data-filter]").forEach((button) => {
    button.disabled = specialActive;
  });

  document.querySelectorAll("#module-filters [data-module-id]").forEach((button) => {
    button.disabled = specialActive;
  });
}

function getVisibleQuestions() {
  if (isRetakeSessionActive()) {
    return state.retakeSessionIds
      .map((questionId) => questionMap.get(questionId))
      .filter(Boolean);
  }

  if (isCramSessionActive()) {
    return getCurrentCramBlockQuestions();
  }

  let visibleQuestions = [...quizBank.questions];

  if (state.moduleId !== "all") {
    visibleQuestions = visibleQuestions.filter((question) => question.moduleId === state.moduleId);
  }

  const searchTerm = normalizeText(state.search);
  if (searchTerm) {
    visibleQuestions = visibleQuestions.filter((question) =>
      normalizeText(
        `${question.moduleLabel} ${question.promptText} ${question.options
          .map((option) => option.text)
          .join(" ")}`,
      ).includes(searchTerm),
    );
  }

  visibleQuestions = visibleQuestions.filter((question) => {
    const record = state.records[question.id];

    if (state.filter === "unanswered") {
      return !isQuestionAnswered(question, record);
    }

    if (state.filter === "incorrect") {
      return Boolean(record?.needsRetry);
    }

    if (state.filter === "starred") {
      return Boolean(record?.starred);
    }

    return true;
  });

  if (state.shuffledIds.length) {
    const orderMap = new Map(state.shuffledIds.map((id, index) => [id, index]));
    visibleQuestions.sort((left, right) => {
      const leftOrder = orderMap.has(left.id) ? orderMap.get(left.id) : Number.MAX_SAFE_INTEGER;
      const rightOrder = orderMap.has(right.id) ? orderMap.get(right.id) : Number.MAX_SAFE_INTEGER;
      if (leftOrder !== rightOrder) {
        return leftOrder - rightOrder;
      }
      return left.questionNumber - right.questionNumber;
    });
  }

  return visibleQuestions;
}

function ensureCurrentQuestion() {
  const visibleQuestions = getVisibleQuestions();
  if (!visibleQuestions.length) {
    state.currentQuestionId = null;
    return;
  }

  if (!visibleQuestions.some((question) => question.id === state.currentQuestionId)) {
    state.currentQuestionId = visibleQuestions[0].id;
  }
}

function getCurrentQuestion() {
  ensureCurrentQuestion();
  return questionMap.get(state.currentQuestionId) || null;
}

function getGlobalRecord(questionId) {
  if (!state.records[questionId]) {
    state.records[questionId] = {
      selected: [],
      checked: false,
      correct: null,
      revealed: false,
      starred: false,
      needsRetry: false,
    };
  }

  return state.records[questionId];
}

function getRetakeSessionRecord(questionId) {
  if (!state.retakeSessionRecords[questionId]) {
    state.retakeSessionRecords[questionId] = {
      selected: [],
      checked: false,
      correct: null,
      revealed: false,
    };
  }

  return state.retakeSessionRecords[questionId];
}

function getCramSessionRecord(questionId) {
  if (!state.cramSessionRecords[questionId]) {
    state.cramSessionRecords[questionId] = {
      selected: [],
      checked: false,
      correct: null,
      revealed: false,
    };
  }

  return state.cramSessionRecords[questionId];
}

function getInteractionRecord(questionId) {
  if (isRetakeSessionActive()) {
    return getRetakeSessionRecord(questionId);
  }

  if (isCramSessionActive()) {
    return getCramSessionRecord(questionId);
  }

  return getGlobalRecord(questionId);
}

function getDisplayRecord(questionId) {
  if (isRetakeSessionActive()) {
    return getRetakeSessionRecord(questionId);
  }

  if (isCramSessionActive()) {
    return getCramSessionRecord(questionId);
  }

  return getGlobalRecord(questionId);
}

function getRetryQuestions(moduleId = null) {
  return quizBank.questions.filter((question) => {
    if (moduleId && question.moduleId !== moduleId) {
      return false;
    }

    return Boolean(state.records[question.id]?.needsRetry);
  });
}

function getRetakeSessionSummary(visibleQuestions) {
  const answered = visibleQuestions.filter((question) =>
    isQuestionAnswered(question, getRetakeSessionRecord(question.id)),
  ).length;
  const correct = visibleQuestions.filter((question) => getRetakeSessionRecord(question.id).correct).length;

  return {
    answered,
    correct,
    total: visibleQuestions.length,
    finished: visibleQuestions.length > 0 && answered === visibleQuestions.length,
  };
}

function renderModeSwitch() {
  document.querySelectorAll("#mode-switch [data-mode]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.mode === state.mode);
  });
}

function renderModuleFilters() {
  const container = document.getElementById("module-filters");
  const totalLabel = `${quizBank.questionCount || quizBank.questions.length} câu`;

  container.innerHTML = [
    createModuleButton({
      moduleId: "all",
      label: "Tất cả modules",
      countLabel: totalLabel,
      accent: "#ffffff",
      isActive: state.moduleId === "all",
    }),
    ...quizBank.modules.map((module) =>
      createModuleButton({
        moduleId: module.id,
        label: module.shortLabel,
        countLabel: `${module.questionCount} câu`,
        accent: module.accent,
        isActive: state.moduleId === module.id,
      }),
    ),
  ].join("");
}

function createModuleButton({ moduleId, label, countLabel, accent, isActive }) {
  return `
    <button
      class="module-button ${isActive ? "is-active" : ""}"
      data-module-id="${moduleId}"
      type="button"
      style="box-shadow: inset 4px 0 0 ${accent || "#ffffff"};"
    >
      <strong>${escapeHtml(label)}</strong>
      <span>${escapeHtml(countLabel)}</span>
    </button>
  `;
}

function renderStatusFilters() {
  document.querySelectorAll("#status-filters [data-filter]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.filter === state.filter);
  });
}

function renderSources() {
  const container = document.getElementById("source-links");
  container.innerHTML = quizBank.sources
    .map(
      (source) => `
        <a href="${source.url}" target="_blank" rel="noreferrer">
          ${escapeHtml(source.label)}
        </a>
      `,
    )
    .join("");
}

function renderStats() {
  const visibleQuestions = getVisibleQuestions();
  ensureCurrentQuestion();

  const answeredCount = visibleQuestions.filter((question) =>
    isQuestionAnswered(question, getDisplayRecord(question.id)),
  ).length;
  const checkedQuestions = visibleQuestions.filter((question) => getDisplayRecord(question.id).checked);
  const correctCount = checkedQuestions.filter((question) => getDisplayRecord(question.id).correct).length;
  const accuracy = checkedQuestions.length
    ? `${Math.round((correctCount / checkedQuestions.length) * 100)}%`
    : "0%";

  document.getElementById("stat-visible").textContent = String(visibleQuestions.length);
  document.getElementById("stat-answered").textContent = String(answeredCount);
  document.getElementById("stat-correct").textContent = String(correctCount);
  document.getElementById("stat-accuracy").textContent = accuracy;
}

function renderNavigator() {
  const visibleQuestions = getVisibleQuestions();
  ensureCurrentQuestion();
  const specialSessionActive = isSpecialSessionActive();

  document.getElementById("question-pills").innerHTML =
    visibleQuestions
      .map((question) => {
        const displayRecord = getDisplayRecord(question.id);
        const globalRecord = getGlobalRecord(question.id);
        const classes = ["question-pill"];

        if (question.id === state.currentQuestionId) {
          classes.push("is-current");
        } else if (displayRecord.checked && displayRecord.correct === true) {
          classes.push("is-correct");
        } else if (
          specialSessionActive
            ? displayRecord.checked && displayRecord.correct === false
            : globalRecord.needsRetry
        ) {
          classes.push("is-incorrect");
        }

        if (globalRecord.starred) {
          classes.push("is-starred");
        }

        return `
          <button
            class="${classes.join(" ")}"
            data-question-id="${question.id}"
            type="button"
            title="${escapeHtml(question.moduleLabel)} - Câu ${question.questionNumber}"
          >
            ${escapeHtml(getPillLabel(question))}
          </button>
        `;
      })
      .join("") || '<div class="empty-state">Không có câu hỏi nào khớp với bộ lọc hiện tại.</div>';
}

function getPillLabel(question) {
  if (isRetakeSessionActive()) {
    return `Thi lại ${question.questionNumber}`;
  }

  if (isCramSessionActive()) {
    if (state.cramSourceModuleId === "all") {
      return `${question.moduleShortLabel} · ${question.questionNumber}`;
    }
    return `Chặng ${state.cramBlockIndex + 1} · ${question.questionNumber}`;
  }

  if (state.moduleId === "all") {
    return `${question.moduleShortLabel.replace("Modules ", "M")} · ${question.questionNumber}`;
  }

  return `Câu ${question.questionNumber}`;
}

function renderQuestion() {
  const visibleQuestions = getVisibleQuestions();
  ensureCurrentQuestion();
  const question = getCurrentQuestion();

  if (!question) {
    renderEmptyQuestionState(visibleQuestions.length === 0);
    return;
  }

  const displayRecord = getDisplayRecord(question.id);
  const globalRecord = getGlobalRecord(question.id);
  const index = visibleQuestions.findIndex((item) => item.id === question.id);
  const total = visibleQuestions.length;
  const module = moduleMap.get(question.moduleId);
  const retakeActive = isRetakeSessionActive();
  const cramActive = isCramSessionActive();

  if (cramActive) {
    const summary = getCramSummary();
    const scopeLabel = getScopeLabel(state.cramSourceModuleId);
    document.getElementById("progress-label").textContent = `Cram 1 Day · Chặng ${
      summary.currentBlockIndex + 1
    }/${summary.totalBlocks} · ${index + 1}/${total}`;
    document.getElementById("question-path").textContent = `NWC / Cram 1 Day / ${scopeLabel}`;
    document.getElementById("hero-note").textContent = summary.finished
      ? `Bạn đã hoàn tất ${summary.totalQuestions} câu trong kế hoạch hôm nay. Đúng ${summary.correctTotal} câu trong phiên cram, có thể kết thúc session hoặc xem lại phần sai.`
      : `Ưu tiên câu sai rồi câu chưa làm. Đã xong ${summary.answeredTotal}/${summary.totalQuestions} câu, còn ${summary.remainingTotal} câu cho hôm nay.`;
  } else if (retakeActive) {
    const summary = getRetakeSessionSummary(visibleQuestions);
    document.getElementById("progress-label").textContent = `Phiên thi lại câu sai · ${index + 1}/${total}`;
    document.getElementById("question-path").textContent = "NWC / Thi lại câu sai";
    document.getElementById("hero-note").textContent = summary.finished
      ? `Bạn đã làm xong phiên thi lại. Đúng ${summary.correct}/${summary.total} câu, có thể thoát phiên để quay lại học tiếp.`
      : `Bộ đề này chỉ gồm các câu từng làm sai. Đã làm ${summary.answered}/${summary.total} câu, đúng ${summary.correct} câu.`;
  } else if (state.filter === "incorrect") {
    const retryCount = getRetryQuestions(state.moduleId !== "all" ? state.moduleId : null).length;
    document.getElementById("progress-label").textContent = `${index + 1}/${total} câu đang hiển thị`;
    document.getElementById("question-path").textContent = `NWC / ${question.moduleLabel}`;
    document.getElementById("hero-note").textContent = retryCount
      ? `Bạn đang ôn lại ${retryCount} câu sai còn lại. Làm đúng xong là câu sẽ tự rời khỏi hàng đợi.`
      : "Bạn đã hoàn thành hết các câu sai trong phạm vi đang xem.";
  } else {
    document.getElementById("progress-label").textContent = `${index + 1}/${total} câu đang hiển thị`;
    document.getElementById("question-path").textContent = `NWC / ${question.moduleLabel}`;
    document.getElementById("hero-note").textContent =
      "Làm bài theo nhịp riêng của bạn, nhấn kiểm tra khi đã chọn xong đáp án.";
  }

  document.getElementById("question-type-badge").textContent = getTypeLabel(question.type);
  document.getElementById("question-source-label").textContent = `Nguồn: ${
    module?.shortLabel || question.moduleShortLabel
  } · Câu ${question.questionNumber}`;

  const bookmarkButton = document.getElementById("bookmark-btn");
  bookmarkButton.classList.toggle("is-active", Boolean(globalRecord.starred));
  bookmarkButton.textContent = globalRecord.starred ? "Đã đánh dấu" : "Đánh dấu câu này";

  const content = document.getElementById("question-content");
  content.classList.remove("pulse-enter");
  void content.offsetWidth;
  content.classList.add("pulse-enter");
  content.innerHTML = question.promptHtml || '<div class="empty-state">Không có nội dung câu hỏi.</div>';

  document.getElementById("instruction-line").textContent = getInstruction(question, {
    retake: retakeActive,
    cram: cramActive,
  });

  const optionsList = document.getElementById("options-list");
  if (!question.options.length) {
    optionsList.innerHTML =
      '<div class="empty-state">Câu này là dạng matching/study. Nhấn "Xem lời giải" để ôn phần đáp án.</div>';
  } else {
    optionsList.innerHTML = question.options
      .map((option) => renderOption(question, option, displayRecord))
      .join("");
  }

  const checkButton = document.getElementById("check-btn");
  checkButton.disabled = !question.options.length || !displayRecord.selected.length;
  checkButton.textContent = question.type === "multiple" ? "Kiểm tra các đáp án đã chọn" : "Kiểm tra đáp án";
  document.getElementById("reveal-btn").textContent = question.options.length ? "Hiện đáp án" : "Xem lời giải";

  ["prev-btn-top", "prev-btn-bottom"].forEach((buttonId) => {
    document.getElementById(buttonId).disabled = index <= 0;
  });

  ["next-btn-top", "next-btn-bottom"].forEach((buttonId) => {
    document.getElementById(buttonId).disabled = index >= total - 1;
  });

  renderFeedback(question, displayRecord);
}

function renderOption(question, option, record) {
  const selected = record.selected.includes(option.id);
  const correctOptions = new Set(question.correctOptionIds);
  const classes = ["option-button"];

  if (selected) {
    classes.push("is-selected");
  }

  if (record.revealed || record.checked) {
    if (correctOptions.has(option.id)) {
      classes.push("is-correct");
    } else if (record.checked && selected) {
      classes.push("is-wrong");
    }

    if (record.checked && !selected && correctOptions.has(option.id)) {
      classes.push("is-missed");
    }
  }

  return `
    <button class="${classes.join(" ")}" data-option-id="${option.id}" type="button">
      <span class="option-badge">${escapeHtml(option.id)}</span>
      <span class="option-text">${escapeHtml(option.text)}</span>
    </button>
  `;
}

function renderFeedback(question, record) {
  const panel = document.getElementById("feedback-panel");
  if (!(record.revealed || record.checked)) {
    panel.hidden = true;
    panel.innerHTML = "";
    return;
  }

  const status = getFeedbackStatus(question, record);
  const correctOptions = question.options
    .filter((option) => question.correctOptionIds.includes(option.id))
    .map((option) => `${option.id}. ${option.text}`);
  const blocks = [];

  if (correctOptions.length) {
    blocks.push(`
      <section class="feedback-block">
        <p class="feedback-block-title">Đáp án đúng</p>
        <p>${escapeHtml(correctOptions.join(" | "))}</p>
      </section>
    `);
  }

  if (question.solutionHtml) {
    blocks.push(`
      <section class="feedback-block">
        <p class="feedback-block-title">Lời giải / Bảng đáp án</p>
        ${question.solutionHtml}
      </section>
    `);
  }

  if (question.explanationHtml) {
    blocks.push(`
      <section class="feedback-block">
        <p class="feedback-block-title">Giải thích</p>
        ${question.explanationHtml}
      </section>
    `);
  }

  if (!blocks.length) {
    blocks.push(`
      <section class="feedback-block">
        <p class="feedback-block-title">Ghi chú</p>
        <p>Chưa có phần giải thích chi tiết cho câu này trong nguồn dữ liệu.</p>
      </section>
    `);
  }

  panel.dataset.state = status.state;
  panel.hidden = false;
  panel.innerHTML = `
    <div class="feedback-title">
      <h4>${escapeHtml(status.title)}</h4>
      <span class="feedback-tag ${status.tagClass}">${escapeHtml(status.tagLabel)}</span>
    </div>
    ${blocks.join("")}
  `;
}

function getFeedbackStatus(question, record) {
  if (!question.options.length) {
    return {
      state: "revealed",
      title: "Lời giải đã được mở",
      tagLabel: "Study mode",
      tagClass: "is-revealed",
    };
  }

  if (record.checked && record.correct === true) {
    return {
      state: "correct",
      title: "Bạn trả lời chính xác",
      tagLabel: "Correct",
      tagClass: "is-correct",
    };
  }

  if (record.checked && record.correct === false) {
    return {
      state: "incorrect",
      title: "Đáp án chưa đúng, xem lại phần giải thích bên dưới",
      tagLabel: "Needs review",
      tagClass: "is-incorrect",
    };
  }

  return {
    state: "revealed",
    title: "Đáp án tham khảo đã được hiển thị",
    tagLabel: "Revealed",
    tagClass: "is-revealed",
  };
}

function renderEmptyQuestionState(noResult) {
  document.getElementById("progress-label").textContent = noResult
    ? "0 câu khớp bộ lọc"
    : "Chưa có dữ liệu";
  document.getElementById("question-path").textContent = "NWC Quiz Lab";
  document.getElementById("hero-note").textContent = noResult
    ? "Thử đổi module, bộ lọc hoặc từ khóa tìm kiếm."
    : "Chưa tìm thấy ngân hàng câu hỏi.";
  document.getElementById("question-type-badge").textContent = "No question";
  document.getElementById("question-source-label").textContent = "";
  document.getElementById("bookmark-btn").textContent = "Đánh dấu câu này";
  document.getElementById("question-content").innerHTML = `
    <div class="empty-state">
      ${noResult ? "Không có câu hỏi nào khớp với lựa chọn hiện tại." : "Dữ liệu câu hỏi chưa được tạo."}
    </div>
  `;
  document.getElementById("instruction-line").textContent = "";
  document.getElementById("options-list").innerHTML = "";
  document.getElementById("feedback-panel").hidden = true;
  document.getElementById("check-btn").disabled = true;

  ["prev-btn-top", "prev-btn-bottom", "next-btn-top", "next-btn-bottom"].forEach((buttonId) => {
    document.getElementById(buttonId).disabled = true;
  });
}

function moveQuestion(offset) {
  const visibleQuestions = getVisibleQuestions();
  const currentIndex = visibleQuestions.findIndex((question) => question.id === state.currentQuestionId);
  if (currentIndex === -1) {
    return;
  }

  const nextQuestion = visibleQuestions[currentIndex + offset];
  if (!nextQuestion) {
    return;
  }

  state.currentQuestionId = nextQuestion.id;
  renderApp();
}

function getTypeLabel(questionType) {
  if (questionType === "multiple") {
    return "Multi choice";
  }

  if (questionType === "study") {
    return "Study / matching";
  }

  return "Single choice";
}

function getInstruction(question, sessionFlags = {}) {
  if (question.type === "study") {
    return "Câu này không phải trắc nghiệm thuần. Dùng nút xem lời giải để ôn phần đáp án.";
  }

  const prefix = sessionFlags.cram ? "Chặng cram: " : sessionFlags.retake ? "Phiên thi lại: " : "";
  return question.type === "multiple"
    ? `${prefix}Chọn nhiều đáp án đúng rồi nhấn kiểm tra.`
    : `${prefix}Chọn 1 đáp án đúng.`;
}

function getScopeLabel(moduleId) {
  if (moduleId === "all") {
    return "tất cả modules";
  }

  return moduleMap.get(moduleId)?.shortLabel || "module đã chọn";
}

function isQuestionAnswered(question, record) {
  if (!record) {
    return false;
  }

  return question.options.length ? Boolean(record.checked || record.revealed) : Boolean(record.revealed);
}

function compareSelections(expectedIds, selectedIds) {
  return [...expectedIds].sort().join("|") === [...selectedIds].sort().join("|");
}

function toggleArrayValue(values, target) {
  return values.includes(target)
    ? values.filter((value) => value !== target)
    : [...values, target];
}

function shuffleArray(values) {
  const clone = [...values];
  for (let index = clone.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [clone[index], clone[swapIndex]] = [clone[swapIndex], clone[index]];
  }
  return clone;
}

function normalizeText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
