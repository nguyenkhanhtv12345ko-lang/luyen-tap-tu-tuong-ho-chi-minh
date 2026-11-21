export const letters = "ABCD";
export const modes = ["original", "questions", "options", "both"];
const filters = ["all", "pending", "wrong", "review", "marked"];

export function selectIds(catalog, set) {
  return catalog.groups.find(group => group.id === set)?.ids ?? [];
}

export function shuffle(list, random = Math.random) {
  const items = [...list];
  for (let end = items.length - 1; end > 0; end--) {
    const other = Math.floor(random() * (end + 1));
    [items[end], items[other]] = [items[other], items[end]];
  }
  return items;
}

export function createRun(catalog, set, mode, subset = null, random = Math.random) {
  const map = new Map(catalog.questions.map(q => [q.id, q]));
  const source = subset ?? selectIds(catalog, set);
  const ids = ["questions", "both"].includes(mode) ? shuffle(source, random) : [...source];
  const order = Object.fromEntries(ids.map(id => {
    const question = map.get(id);
    const options = question.options.map(option => option.id);
    const reorder = ["options", "both"].includes(mode) && !question.fixedOrder;
    return [id, reorder ? shuffle(options, random) : options];
  }));
  return { set, mode, ids, order, answers: {}, index: 0 };
}

export function displayOptions(question, order) {
  return order.map((id, index) => ({
    id,
    letter: letters[index],
    text: question.options.find(option => option.id === id).text,
  }));
}

export function outcome(question, answer) {
  if (!answer) return "pending";
  if (!question.correct.length) return "ungraded";
  return question.correct.includes(answer) ? "right" : "wrong";
}

export function submit(run, question, optionId) {
  if (run.answers[question.id] || !run.order[question.id]?.includes(optionId)) return false;
  run.answers[question.id] = optionId;
  return true;
}

export function stats(run, map) {
  const count = { right: 0, wrong: 0, pending: 0, ungraded: 0 };
  for (const id of run.ids) count[outcome(map.get(id), run.answers[id])]++;
  return { ...count, answered: run.ids.length - count.pending };
}

export function wrongQuestions(run, map) {
  return run.ids.filter(id => outcome(map.get(id), run.answers[id]) === "wrong");
}

export function restore(raw, catalog) {
  if (!raw || raw.version !== 1) return null;
  const map = new Map(catalog.questions.map(q => [q.id, q]));
  const validRun = (run, subset) => {
    if (!run || !modes.includes(run.mode)) return false;
    if (!Array.isArray(run.ids) || !run.ids.length || new Set(run.ids).size !== run.ids.length) return false;
    const allowed = new Set(selectIds(catalog, run.set));
    if (!subset && run.ids.length !== allowed.size) return false;
    if (!run.ids.every(id => allowed.has(id))) return false;
    if (!Number.isInteger(run.index) || !run.ids[run.index] || !run.order || !run.answers) return false;
    return run.ids.every(id => {
      const question = map.get(id);
      const options = question.options.map(option => option.id);
      const order = run.order[id];
      if (!Array.isArray(order) || order.length !== options.length || new Set(order).size !== order.length) return false;
      if (question.fixedOrder && order.some((key, i) => key !== options[i])) return false;
      return order.every(key => options.includes(key)) && (!run.answers[id] || order.includes(run.answers[id]));
    });
  };
  if (!validRun(raw.main, false)) return null;
  const retry = validRun(raw.retry, true) && raw.retry.set === raw.main.set ? raw.retry : null;
  const active = raw.active === "retry" && retry ? "retry" : "main";
  const marks = Array.isArray(raw.marks) ? [...new Set(raw.marks)].filter(id => map.has(id)) : [];
  const filter = filters.includes(raw.filter) ? raw.filter : "all";
  return { version: 1, main: raw.main, retry, active, marks, filter };
}
