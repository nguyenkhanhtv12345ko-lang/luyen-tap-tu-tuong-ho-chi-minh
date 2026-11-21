import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRun, displayOptions, modes, outcome, restore, stats, submit, wrongQuestions } from "../quiz.mjs";

const catalog = JSON.parse(readFileSync(new URL("../questions.json", import.meta.url)));
const map = new Map(catalog.questions.map(question => [question.id, question]));
const sorted = values => [...values].sort((a, b) => a - b);

test("95 source entries reduce to 76 unique questions across all 10 groups", () => {
  assert.equal(catalog.sourceCount, 95);
  assert.equal(map.size, 76);
  assert.equal(catalog.groups.length, 10);
  assert.deepEqual(catalog.groups.map(group => group.ids.length), [76, 53, 18, 20, 7, 10, 9, 10, 10, 7]);
  assert.deepEqual(catalog.groups[0].ids, sorted(map.keys()));
  for (const group of catalog.groups) {
    assert.equal(new Set(group.ids).size, group.ids.length);
    assert.ok(group.ids.every(id => map.has(id)));
  }
  assert.deepEqual(catalog.questions.filter(q => !q.correct.length).map(q => q.id), [33, 34, 45, 58, 63, 80, 87, 90]);
  assert.deepEqual(map.get(71).correct, ["C"]);
});

for (const mode of modes) {
  test("grading uses stable option IDs in " + mode, () => {
    const run = createRun(catalog, "all", mode, null, () => 0);
    const originalIds = catalog.groups[0].ids;
    assert.deepEqual(sorted(run.ids), originalIds);
    if (mode === "questions" || mode === "both") assert.notDeepEqual(run.ids, originalIds);
    else assert.deepEqual(run.ids, originalIds);
    for (const id of run.ids) {
      const question = map.get(id);
      const shown = displayOptions(question, run.order[id]);
      const unshuffled = question.options.map(option => option.id);
      if (mode === "options" || mode === "both") {
        if (question.fixedOrder) assert.deepEqual(run.order[id], unshuffled);
        else assert.notDeepEqual(run.order[id], unshuffled);
      } else assert.deepEqual(run.order[id], unshuffled);
      const choice = shown.find(option => question.correct.includes(option.id)) ?? shown[0];
      assert.ok(submit(run, question, choice.id));
      assert.equal(outcome(question, run.answers[id]), question.correct.length ? "right" : "ungraded");
      assert.ok(!submit(run, question, choice.id));
    }
    assert.deepEqual(stats(run, map), { right: 68, wrong: 0, pending: 0, ungraded: 8, answered: 76 });
  });
}

test("keep the order of relative choices and grade by stable ID", () => {
  const question = { id: 1, correct: ["D"], fixedOrder: true,
    options: [
      { id: "A", text: "Ý thứ nhất" }, { id: "B", text: "Ý thứ hai" },
      { id: "C", text: "Ý thứ ba" }, { id: "D", text: "Cả A và C" },
    ] };
  const sample = { questions: [question], groups: [{ id: "all", ids: [1] }] };
  const run = createRun(sample, "all", "both", null, () => 0);
  assert.deepEqual(run.order[1], ["A", "B", "C", "D"]);
  assert.equal(displayOptions(question, run.order[1])[3].text, "Cả A và C");
});

test("saved order, position, retry, filters and marks survive serialization", () => {
  const main = createRun(catalog, "chapter-1", "both", null, () => 0);
  const question = map.get(1);
  submit(main, question, "B");
  main.index = 2;
  assert.deepEqual(wrongQuestions(main, map), [1]);
  const retry = createRun(catalog, "chapter-1", "both", [1], () => 0);
  const state = { version: 1, main, retry, active: "retry", marks: [1], filter: "marked" };
  assert.deepEqual(restore(JSON.parse(JSON.stringify(state)), catalog), state);
  assert.equal(restore({ ...state, main: { ...main, order: {} } }, catalog), null);
});
