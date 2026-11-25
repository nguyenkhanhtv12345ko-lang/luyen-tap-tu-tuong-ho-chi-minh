"""Create the public quiz data from the Word document, using only its question paragraphs."""
import argparse
import json
import re
import unicodedata
import xml.etree.ElementTree as ET
from collections import Counter
from pathlib import Path
from zipfile import ZipFile

NS = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}
W = "{" + NS["w"] + "}"
LETTERS = "ABCD"
EXPECTED_SECTIONS = [9, 10, 10, 10, 11, 7, 18, 20]

# IDs are positions in the original 95-question document.
# Keep the more complete wording when option counts match.
DUPLICATES = {
    2: 9, 7: 76, 8: 1, 15: 93, 18: 94, 20: 78,
    22: 80, 23: 81, 24: 82, 25: 83, 26: 80, 28: 85, 29: 84,
    30: 89, 31: 90, 32: 91, 40: 49, 77: 1, 79: 21,
}
# Letter IDs belong to the Word options, matched by content to the Wayground key.
OVERRIDES = {
    33: ["B"], 34: ["C"], 45: ["C"], 58: ["A"],
    63: ["A"], 71: ["C"], 80: ["D"], 90: ["B"],
}

def normalized(text):
    return "".join(c for c in unicodedata.normalize("NFC", text).casefold() if c.isalnum())

def paragraph_text(node):
    pieces = []
    for element in node.iter():
        if element.tag == W + "t":
            pieces.append(element.text or "")
        elif element.tag in {W + "tab", W + "br"}:
            pieces.append("\t" if element.tag.endswith("tab") else "\n")
    return "".join(pieces).strip()

def highlights(node):
    return any(x.get(W + "val") == "yellow" for x in node.findall(".//w:rPr/w:highlight", NS))

def read_source(path, stop_at=None):
    with ZipFile(path) as docx:
        root = ET.fromstring(docx.read("word/document.xml"))

    questions = []
    chapter, part, current = None, None, None
    for paragraph in root.findall("w:body/w:p", NS):
        text = paragraph_text(paragraph)
        if stop_at and text.startswith(stop_at):
            break
        if re.match(r"^Phần [123]\s+", text):
            part, chapter = int(text[5]), None
            continue
        if re.fullmatch(r"Chương [1-6]", text):
            chapter = int(text[-1])
            continue
        match = re.fullmatch(r"Câu\s+(\d+)\.\s*(.*)", text, re.S)
        if match:
            current = {
                "id": len(questions) + 1, "part": part, "chapter": chapter,
                "sourceNumber": int(match[1]), "text": match[2].strip(), "options": [], "highlighted": [],
            }
            questions.append(current)
            continue
        if current is None:
            continue
        option = re.fullmatch(r"([A-D])\.\s*(.*)", text, re.S)
        if option:
            option_id, wording = option[1], option[2].strip()
            current["options"].append({"id": option_id, "text": wording})
            if highlights(paragraph):
                current["highlighted"].append(option_id)
        elif re.match(r"^(Giải thích|Tham chiếu|Nguồn|Trang)\b", text, re.I):
            current["explanation"] = "\n".join(filter(None, [current.get("explanation"), text]))
    return questions

def source_label(question):
    chapter = f" · Chương {question['chapter']}" if question["chapter"] else ""
    return f"Phần {question['part']}{chapter} · Câu {question['sourceNumber']}"

def needs_fixed_options(question):
    if re.search(r"\b(?i:chọn|đáp án|phương án)\s+[A-D]\b", question["text"]):
        return True
    for opt in question["options"]:
        text = opt["text"]
        if re.search(r"\b(?:ở trên|ở dưới|nêu trên|kể trên|phía trên|phía dưới)\b", text, re.I):
            return True
        if re.search(r"\b(?i:cả|đáp án|phương án|ý|câu)\s+[A-D]\b", text):
            return True
        if re.search(r"\b[A-D]\s*(?i:,|và|hoặc|&|/)\s*[A-D]\b", text):
            return True
        if re.search(r"\b(?:tất cả|cả hai|cả ba|cả bốn|hai ý|ba ý)\b.*\b(?:trên|dưới|đúng|sai)\b", text, re.I):
            return True
    return False

def transform(raw):
    by_id = {q["id"]: q for q in raw}
    bank = []
    for row in raw:
        qid = row["id"]
        if qid in DUPLICATES:
            retained = by_id[DUPLICATES[qid]]
            assert len(retained["options"]) >= len(row["options"]), (qid, retained["id"])
            continue

        notes = []
        kept = row["options"]
        valid = [option["id"] for option in kept if option["text"]]
        key = OVERRIDES.get(qid, row["highlighted"])
        correct = key.copy()
        if len(kept) < 3 or len(valid) != len(kept) or valid != list(LETTERS[:len(valid)]):
            notes.append("Thiếu nội dung hoặc thiếu phương án trong tài liệu.")
            correct = []
        if len({normalized(option["text"]) for option in kept}) < len(kept) and qid not in OVERRIDES:
            notes.append("Có phương án trùng nội dung.")
            correct = []
        if len(key) != 1 or any(option not in valid for option in key):
            notes.append("Tài liệu chưa xác định một đáp án tô vàng duy nhất.")
            correct = []
        if not row["text"]:
            notes.append("Thiếu nội dung câu hỏi.")
            correct = []

        q = {
            "id": qid, "source": source_label(row), "text": row["text"],
            "options": kept, "correct": correct,
        }
        if notes:
            q["review"] = notes
        if row.get("explanation"):
            q["explanation"] = row["explanation"]
        if needs_fixed_options(row):
            q["fixedOrder"] = True
        if not correct and key:
            q["sourceKey"] = key
        bank.append(q)
    return bank

def group_ids(rows):
    original_ids = {row["id"] for row in rows}
    result = []
    for row in rows:
        qid = row["id"]
        retained = DUPLICATES.get(qid, qid)
        if retained != qid and retained in original_ids:
            continue
        if retained not in result:
            result.append(retained)
    return result

def audit(raw, bank, groups, output):
    originals = {q["id"]: q for q in raw}
    lines = [
        "# Đối chiếu bộ câu hỏi",
        "",
        f"Tài liệu Word có {len(raw)} câu, {sum(len(q['options']) for q in raw)} phương án. "
        f"Đề tổng có {len(bank)} câu sau khi gộp {len(DUPLICATES)} mục lặp.",
        "",
        "Số câu gốc trên web là vị trí của câu trong toàn bộ tài liệu Word. "
        "Trong từng phần hoặc chương, bản đầy đủ của một câu có thể được dùng chung với nhóm khác.",
        "",
    ]
    review_questions = [q for q in bank if q.get("review")]
    if review_questions:
        lines += [
            "## Câu cần đối chiếu", "",
            "| Câu gốc | Vị trí trong Word | Nội dung cần kiểm tra | Tính điểm |",
            "| --- | --- | --- | --- |",
        ]
        for q in review_questions:
            grade = "Có" if q["correct"] else "Bỏ qua"
            lines.append(f"| {q['id']} | {q['source']} | {' '.join(q['review'])} | {grade} |")
    lines += [
        "", "## Đáp án đối chiếu Wayground", "",
        "| Câu gốc | Đáp án trên trang luyện | Đề Wayground |",
        "| --- | --- | --- |",
        "| 33, 34 | B, C | [Chương 4, câu 4 và 5](https://wayground.com/print/quiz/660b6bca455cc1746bdb9feb) |",
        "| 45 | C | [Chương 5, câu 6](https://wayground.com/print/quiz/6641c59074c28f267309c838) |",
        "| 58, 63, 71 | A, A, C | [Nguyễn Ái Quốc, câu 1, 6 và 14](https://wayground.com/print/quiz/652ffd223c7f9b188518b201). Câu 71 có hai phương án nhiễu trùng chữ. |",
        "| 80 | D | [Chương 3, câu 3 và 7](https://wayground.com/print/quiz/65f8f1efe38a0b4907d1d1a8). Wayground chọn C và A ở hai bản tương ứng về điều kiện, tiền đề tiến lên chủ nghĩa xã hội. |",
        "| 90 | B | [Chương 4, câu 2](https://wayground.com/print/quiz/660b6bca455cc1746bdb9feb). Wayground chọn A, tương ứng phương án B trong bản MHT. |",
        "", "## Đề Giữa kỳ", "",
        "Cả 20 đáp án được chấm theo phương án đã chọn trong bản lưu MHT, theo xác nhận của người học. "
        "Các câu dùng chung với nhóm khác được đối chiếu theo nội dung phương án. "
        "Câu gốc 87 (câu 12 của Đề Giữa kỳ) chấm phương án A.",
        "", "## Câu đã gộp", "", "| Bản lặp | Bản giữ |", "| --- | --- |",
    ]
    for duplicate, retained in sorted(DUPLICATES.items()):
        lines.append(f"| {duplicate} · {source_label(originals[duplicate])} | {retained} · {source_label(originals[retained])} |")
    lines += ["", "## Số câu theo bộ luyện", ""]
    lines += [f"- {group['label']}: {len(group['ids'])} câu" for group in groups]
    output.write_text("\n".join(lines) + "\n", encoding="utf-8")

def import_exam(path, label, first_id, expected_count, stop_at=None):
    rows = read_source(path, stop_at)
    if [row["sourceNumber"] for row in rows] != list(range(1, expected_count + 1)):
        raise ValueError(f"Unexpected question numbering in {path.name}")
    questions = []
    for index, row in enumerate(rows, 1):
        options = row["options"]
        ids = [option["id"] for option in options]
        if (not row["text"] or ids != list(LETTERS) or not all(option["text"] for option in options)
                or len(row["highlighted"]) != 1 or row["highlighted"][0] not in ids):
            raise ValueError(f"Invalid question {index} in {path.name}")
        question = {
            "id": first_id + index - 1, "source": label, "sourceNumber": index,
            "text": row["text"], "options": options, "correct": row["highlighted"],
        }
        if needs_fixed_options(row):
            question["fixedOrder"] = True
        if row.get("explanation"):
            question["explanation"] = row["explanation"]
        questions.append(question)
    return questions

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("word_file", type=Path)
    parser.add_argument("--exam-1", type=Path, required=True, help="Word document with the 24-question exam")
    parser.add_argument("--exam-2", type=Path, required=True, help="Word document with the 18-question exam")
    parser.add_argument("--output", type=Path, default=Path(__file__).resolve().parents[1])
    args = parser.parse_args()
    raw = read_source(args.word_file)
    source_counts = Counter((q["part"], q["chapter"]) for q in raw)
    assert [source_counts[(1, c)] for c in range(1, 7)] + [source_counts[(2, None)], source_counts[(3, None)]] == EXPECTED_SECTIONS
    assert len(raw) == 95 and sum(len(q["options"]) for q in raw) == 325
    assert sum(len(q["highlighted"]) for q in raw) == 95

    bank = transform(raw)
    groups = [{"id": "all", "label": "Toàn bộ câu hỏi", "ids": [q["id"] for q in bank]}]
    part_labels = ["Phần 1 · Chương 1 đến 6", "Phần 2 · Nguyễn Ái Quốc", "Đề Giữa kỳ"]
    for part, label in enumerate(part_labels, 1):
        groups.append({"id": f"part-{part}", "label": label, "ids": group_ids([q for q in raw if q["part"] == part])})
    for chapter in range(1, 7):
        groups.append({"id": f"chapter-{chapter}", "label": f"Chương {chapter}", "ids": group_ids([q for q in raw if q["chapter"] == chapter])})
    assert all(len(group["ids"]) == len(set(group["ids"])) and set(group["ids"]) <= set(groups[0]["ids"]) for group in groups)
    exam_groups = [
        ("exam-1", "Đề 1 · Ôn tập theo ảnh bài giảng", import_exam(args.exam_1, "Đề 1", 101, 24, "Phần 2")),
        ("exam-2", "Đề 2 · Tham khảo VietJack", import_exam(args.exam_2, "Đề 2", 201, 18)),
    ]
    exam_questions = []
    for group_id, label, questions in exam_groups:
        groups.append({"id": group_id, "label": label, "ids": [question["id"] for question in questions]})
        exam_questions.extend(questions)
    data = {"sourceCount": len(raw), "groups": groups, "questions": bank + exam_questions}
    (args.output / "questions.json").write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    audit(raw, bank, groups, args.output / "DOI-CHIEU.md")
    print(json.dumps({"source_count": len(raw), "unique_count": len(bank),
                      "ungraded_count": sum(not q["correct"] for q in bank)}))

if __name__ == "__main__":
    main()
