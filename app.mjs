import { createRun, displayOptions, outcome, submit, stats, wrongQuestions, restore } from "./quiz.mjs";

const byId = id => document.getElementById(id);
const storageKey = "tu-tuong-ho-chi-minh/v1";
const sourceName = run => `${groupMap.get(run.set).label} · ${run.ids.length} câu`;
const modeNames = { original: "Nguyên bản", questions: "Đảo câu hỏi", options: "Đảo phương án", both: "Đảo cả hai" };
const sourceQuestionLabel = question => "Câu gốc " + (question.sourceNumber ?? question.id);
const stateLabels = { right: "đúng", wrong: "sai", pending: "chưa làm", ungraded: "chưa có đáp án xác nhận" };
let catalog, groupMap, map, saved, pendingAction;
let selection = null;

const questionCard = byId("question");
const menu = byId("menu");
const confirm = byId("confirm");
const activeRun = () => saved[saved.active];
const activeQuestion = () => map.get(activeRun().ids[activeRun().index]);
const visibleOptions = () => displayOptions(activeQuestion(), activeRun().order[activeQuestion().id]);

function save() {
  try {
    localStorage.setItem(storageKey, JSON.stringify(saved));
    byId("storage-status").textContent = "Tự lưu";
  } catch {
    byId("storage-status").textContent = "Chỉ lưu trong phiên này";
  }
}

function restoreOrStart() {
  let restored;
  try { restored = restore(JSON.parse(localStorage.getItem(storageKey)), catalog); }
  catch { /* Start a new session if storage is unavailable or corrupt. */ }
  return restored ?? {
    version: 1, main: createRun(catalog, "all", "original"), retry: null, active: "main",
    marks: [], filter: "all",
  };
}

function textNode(tag, text, className) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  element.textContent = text;
  return element;
}

function renderQuestion() {
  const run = activeRun();
  const question = activeQuestion();
  const answer = run.answers[question.id];
  const result = outcome(question, answer);
  const options = visibleOptions();
  byId("active-title").textContent = saved.active === "retry"
    ? "Làm lại câu sai · " + sourceName(run)
    : sourceName(saved.main) + " · " + modeNames[run.mode];
  byId("question-count").textContent = "Câu " + (run.index + 1) + " / " + run.ids.length;
  byId("original-number").textContent = sourceQuestionLabel(question) + " · " + question.source;
  byId("question-text").textContent = question.text || "Tài liệu chưa có nội dung câu hỏi này.";

  const note = byId("source-note");
  note.hidden = !question.review?.length;
  note.textContent = question.review?.length ? "Cần đối chiếu · " + question.review.join(" ") : "";

  const marked = saved.marks.includes(question.id);
  byId("mark").setAttribute("aria-pressed", String(marked));
  byId("mark").querySelector("span").textContent = marked ? "Đã đánh dấu" : "Đánh dấu";
  byId("previous").disabled = run.index === 0;
  byId("next").disabled = run.index === run.ids.length - 1;

  const optionsElement = byId("options");
  optionsElement.replaceChildren();
  for (const option of options) {
    const button = textNode("button", "", "option");
    button.type = "button";
    button.dataset.option = option.id;
    const badge = textNode("span", option.letter, "option-letter");
    const symbol = textNode("span", "", "option-symbol");
    button.append(badge, textNode("span", option.text), symbol);
    const label = [option.letter + ".", option.text];
    if (answer) {
      button.setAttribute("aria-disabled", "true");
      if (question.correct.includes(option.id)) {
        button.dataset.result = "right";
        symbol.textContent = "✓";
        label.push("Đáp án đúng");
      } else if (answer === option.id && result === "wrong") {
        button.dataset.result = "wrong";
        symbol.textContent = "×";
        label.push("Đã chọn, sai");
      }
      if (answer === option.id) button.dataset.attempt = "true";
    }
    symbol.setAttribute("aria-hidden", "true");
    button.setAttribute("aria-label", label.join(" "));
    button.addEventListener("click", () => choose(option.id));
    optionsElement.append(button);
  }
  updateSelection(false);
  const feedback = byId("feedback");
  feedback.hidden = !answer;
  feedback.dataset.result = result;
  feedback.replaceChildren();
  if (answer) {
    const resultText = { right: "✓ Chính xác", wrong: "× Chưa chính xác", ungraded: "Cần đối chiếu" };
    feedback.append(textNode("strong", resultText[result]));
    const correct = options.filter(option => question.correct.includes(option.id));
    feedback.append(textNode("span", correct.length
      ? "Đáp án đúng là " + correct.map(option => option.letter + ". " + option.text).join(" / ")
      : "Đã ghi nhận lựa chọn. Câu này không tính điểm."));
    if (!correct.length && question.sourceKey?.length) {
      const original = question.sourceKey.map(id => question.options.find(option => option.id === id)?.text).filter(Boolean);
      if (original.length) feedback.append(textNode("span", "Phương án tô vàng trong Word: " + original.join(" / ")));
    }
  }
  byId("study-notes").hidden = !answer || !question.explanation;
  byId("explanation-text").textContent = question.explanation ?? "";
}

function updateSelection(focus) {
  byId("options").querySelectorAll("button").forEach((button, index) => {
    button.dataset.selected = String(index === selection);
    button.setAttribute("aria-pressed", String(index === selection || button.dataset.attempt === "true"));
    if (focus && index === selection) button.focus();
  });
}

function renderProgress() {
  const run = activeRun();
  const counts = stats(run, map);
  const total = run.ids.length;
  const percent = Math.round(counts.answered / total * 100);
  byId("answered-count").textContent = counts.answered + "/" + total + " đã làm" +
    (counts.ungraded ? " · " + counts.ungraded + " chờ xác nhận" : "");
  byId("percent").textContent = percent + "%";
  byId("progress-bar").max = total;
  byId("progress-bar").value = counts.answered;
  byId("right-count").textContent = counts.right;
  byId("wrong-count").textContent = counts.wrong;
  byId("pending-count").textContent = counts.pending;
  byId("filter").value = saved.filter;

  const grid = byId("question-grid");
  const gridScroll = grid.scrollTop;
  const frag = document.createDocumentFragment();
  run.ids.forEach((id, index) => {
    const result = outcome(map.get(id), run.answers[id]);
    const isMarked = saved.marks.includes(id);
    const needsReview = Boolean(map.get(id).review?.length);
    const filters = { all: true, wrong: result === "wrong", pending: result === "pending",
      marked: isMarked, review: needsReview };
    if (!filters[saved.filter]) return;
    const button = textNode("button", String(index + 1), "cell");
    button.type = "button";
    button.dataset.question = String(id);
    button.dataset.result = result;
    button.dataset.marked = String(isMarked);
    if (index === run.index) button.setAttribute("aria-current", "true");
    const resultSymbol = { right: "✓", wrong: "×", ungraded: "?" }[result];
    if (resultSymbol) {
      const icon = textNode("span", resultSymbol, "cell-status");
      icon.setAttribute("aria-hidden", "true");
      button.append(icon);
    }
    button.setAttribute("aria-label", "Câu " + (index + 1) + ", " + sourceQuestionLabel(map.get(id)) + ", " + stateLabels[result]
      + (isMarked ? ", đã đánh dấu" : "") + (needsReview ? ", cần đối chiếu" : ""));
    button.addEventListener("click", () => goTo(index));
    frag.append(button);
  });
  byId("grid-empty").hidden = Boolean(frag.childElementCount);
  grid.replaceChildren(frag);
  grid.scrollTop = gridScroll;

  const retry = byId("retry");
  retry.disabled = counts.wrong === 0;
  retry.textContent = counts.wrong ? "Làm lại câu sai (" + counts.wrong + ")" : "Làm lại câu sai";
  byId("back-main").hidden = saved.active !== "retry";

  const reviewCount = run.ids.filter(id => map.get(id).review?.length).length;
  const linkArea = byId("review-links");
  linkArea.hidden = !reviewCount;
  linkArea.replaceChildren();
  if (reviewCount) {
    const button = textNode("button", reviewCount + " câu cần đối chiếu tài liệu");
    button.type = "button";
    button.addEventListener("click", () => {
      saved.filter = saved.filter === "review" ? "all" : "review";
      renderProgress();
      byId("filter").focus();
      save();
    });
    linkArea.append(button);
  }
}

function focusQuestion() {
  questionCard.focus({ preventScroll: true });
  questionCard.scrollIntoView({ block: "start" });
}

function present({ focus = false } = {}) {
  selection = null;
  renderQuestion();
  renderProgress();
  save();
  if (focus) focusQuestion();
}

function goTo(index) {
  const run = activeRun();
  if (index < 0 || index >= run.ids.length || run.index === index) return;
  run.index = index;
  present({ focus: true });
}

function choose(id) {
  const question = activeQuestion();
  if (!submit(activeRun(), question, id)) return;
  const focusedOption = document.activeElement?.closest("#options button");
  present();
  if (focusedOption) {
    [...byId("options").children].find(button => button.dataset.option === id)?.focus({ preventScroll: true });
  }
}

function restart(set, mode) {
  saved.main = createRun(catalog, set, mode);
  saved.active = "main";
  saved.retry = null;
  saved.filter = "all";
  present({ focus: true });
}

function askRestart(description, action) {
  pendingAction = action;
  byId("confirm-text").textContent = description;
  confirm.returnValue = "";
  confirm.showModal();
}

function changeView(view) {
  saved.active = view;
  saved.filter = "all";
  if (menu.open) menu.close();
  present({ focus: true });
}

function openMenu() {
  byId("set").value = saved.main.set;
  byId("shuffle").value = saved.main.mode;
  menu.showModal();
}

function setupControls() {
  byId("mark").addEventListener("click", () => {
    const id = activeQuestion().id;
    saved.marks = saved.marks.includes(id) ? saved.marks.filter(mark => mark !== id) : [...saved.marks, id];
    renderQuestion();
    renderProgress();
    save();
  });
  byId("filter").addEventListener("change", event => {
    saved.filter = event.target.value;
    renderProgress();
    save();
  });
  byId("previous").addEventListener("click", () => goTo(activeRun().index - 1));
  byId("next").addEventListener("click", () => goTo(activeRun().index + 1));
  byId("open-menu").addEventListener("click", openMenu);
  menu.querySelector("[data-close]").addEventListener("click", () => menu.close());
  byId("menu-form").addEventListener("submit", event => {
    event.preventDefault();
    const set = byId("set").value;
    const mode = byId("shuffle").value;
    menu.close();
    if (set === saved.main.set && mode === saved.main.mode) {
      if (saved.active === "retry") changeView("main");
      return;
    }
    if (saved.main.index !== 0 || Object.keys(saved.main.answers).length || saved.retry) {
      askRestart("Áp dụng đề hoặc kiểu đảo mới sẽ đặt lại tiến độ hiện tại. Các câu đã đánh dấu vẫn được lưu.",
        () => restart(set, mode));
    } else restart(set, mode);
  });
  byId("new-run").addEventListener("click", () => {
    if (saved.active === "retry") {
      askRestart("Tiến độ ôn lại câu sai sẽ được đặt lại. Kết quả của lượt chính và các câu đã đánh dấu vẫn được lưu.", () => {
        saved.retry = createRun(catalog, saved.retry.set, saved.retry.mode, saved.retry.ids);
        saved.filter = "all";
        present({ focus: true });
      });
    } else {
      askRestart("Tiến độ của lượt hiện tại sẽ được đặt lại. Các câu đã đánh dấu vẫn được lưu.",
        () => restart(saved.main.set, saved.main.mode));
    }
  });
  confirm.querySelector("form").addEventListener("submit", event => {
    event.preventDefault();
    const action = event.submitter?.value === "confirm" ? pendingAction : undefined;
    pendingAction = undefined;
    confirm.close();
    action?.();
  });
  confirm.addEventListener("cancel", () => { pendingAction = undefined; });
  byId("retry").addEventListener("click", () => {
    const run = activeRun();
    const missed = new Set(wrongQuestions(run, map));
    if (!missed.size) return;
    const startRetry = () => {
      const ids = catalog.questions.map(question => question.id).filter(id => missed.has(id));
      saved.retry = createRun(catalog, run.set, run.mode, ids);
      changeView("retry");
    };
    if (saved.retry) askRestart("Thay lượt ôn câu sai hiện tại bằng các câu vừa trả lời sai?", startRetry);
    else startRetry();
  });
  byId("back-main").addEventListener("click", () => changeView("main"));
  document.addEventListener("keydown", onShortcut);
}

function onShortcut(event) {
  if (event.defaultPrevented || event.ctrlKey || event.altKey || event.metaKey ||
    event.isComposing || menu.open || confirm.open ||
    event.target.closest?.("select,input,textarea,[contenteditable],summary")) return;
  const key = event.key.toLowerCase();
  const run = activeRun();
  const answered = run.answers[activeQuestion().id];
  const buttons = [...byId("options").children];
  const focusIndex = buttons.indexOf(document.activeElement);
  if (key === "arrowleft" || key === "arrowright") {
    event.preventDefault();
    goTo(run.index + (key === "arrowleft" ? -1 : 1));
  } else if (!answered && /^[a-d]$/.test(key)) {
    const index = key.charCodeAt(0) - 97;
    if (!buttons[index]) return;
    event.preventDefault();
    selection = index;
    updateSelection(true);
  } else if (!answered && buttons.length && ["arrowup", "arrowdown"].includes(key)) {
    event.preventDefault();
    const step = key === "arrowup" ? -1 : 1;
    const from = selection ?? (focusIndex === -1 ? (step > 0 ? -1 : 0) : focusIndex);
    selection = (from + step + buttons.length) % buttons.length;
    updateSelection(true);
  } else if (!answered && key === "enter" && (focusIndex !== -1 || selection !== null &&
    !event.target.closest?.("button,a"))) {
    const index = focusIndex !== -1 ? focusIndex : selection;
    event.preventDefault();
    choose(buttons[index].dataset.option);
  }
}

function renderGroups() {
  const select = byId("set");
  const parts = document.createElement("optgroup");
  parts.label = "Theo phần";
  const chapters = document.createElement("optgroup");
  chapters.label = "Theo chương";
  const exams = document.createElement("optgroup");
  exams.label = "Đề ôn tập riêng";
  const sections = { part: parts, chapter: chapters, exam: exams };
  for (const group of catalog.groups) {
    const option = textNode("option", group.label + " (" + group.ids.length + " câu)");
    option.value = group.id;
    const parent = sections[group.id.split("-")[0]] ?? select;
    parent.append(option);
  }
  select.append(parts, chapters, exams);
}

async function boot() {
  try {
    const response = await fetch(new URL("./questions.json?v=6", import.meta.url));
    if (!response.ok) throw new Error("Không tải được dữ liệu câu hỏi.");
    catalog = await response.json();
    map = new Map(catalog.questions.map(question => [question.id, question]));
    groupMap = new Map(catalog.groups.map(group => [group.id, group]));
    if (!groupMap.get("all")?.ids.length || catalog.groups.some(group => group.ids.some(id => !map.has(id)))) {
      throw new Error("Thiếu dữ liệu câu hỏi.");
    }
    renderGroups();
    saved = restoreOrStart();
    if (!catalog.questions.some(question => question.review?.length)) {
      byId("filter").querySelector('option[value="review"]').remove();
      if (saved.filter === "review") saved.filter = "all";
    }
    setupControls();
    present();
    for (const id of ["open-menu", "new-run", "mark"]) byId(id).disabled = false;
  } catch (error) {
    byId("question-text").textContent = "Không tải được câu hỏi. Hãy tải lại trang.";
    console.error(error);
  }
}

boot();
