# Luyện trắc nghiệm Tư tưởng Hồ Chí Minh

[Trang luyện tập](https://nguyenkhanhtv12345ko-lang.github.io/luyen-tap-tu-tuong-ho-chi-minh/)

Bộ luyện gồm đề tổng hợp 76 câu, 3 phần theo tài liệu và 6 chương trong Phần 1. Tài liệu Word có 95 câu. Khi các câu cùng kiểm tra một nội dung, bản có nhiều phương án hơn được ưu tiên. [Xem danh sách câu lặp và câu cần đối chiếu](DOI-CHIEU.md).

Trong mục **Chọn đề**, nhóm **Đề ôn tập riêng** có Đề 1 theo ảnh bài giảng (24 câu) và Đề 2 tham khảo VietJack (18 câu).

Chọn một phương án để chấm ngay. Dùng A–D hoặc ↑/↓ để chọn, Enter để trả lời và ←/→ để chuyển câu. Tiến độ, thứ tự đảo và dấu ôn tập được lưu trên trình duyệt đang sử dụng. Câu thiếu đáp án xác định được ghi nhận khi làm và bỏ qua ở thống kê đúng/sai.

## Chạy dự án

Trang dùng HTML, CSS và JavaScript tĩnh. GitHub Pages phục vụ thư mục gốc nhánh `main`.

```sh
python -m http.server 8000
node --test
```

Mở `http://localhost:8000/` để xem bản cục bộ. Để nhập lại đúng cấu trúc tài liệu Word này, chạy `python tools/import_questions.py "Trắc nghiệm Tư tưởng Hồ Chí Minh.docx" --exam-1 "Đề ôn tập Tư tưởng Hồ Chí Minh từ ảnh và internet.docx" --exam-2 "Đề 2 Tư tưởng Hồ Chí Minh tham khảo VietJack.docx"`. Trình nhập chỉ lấy câu hỏi, phương án, màu tô và giải thích hoặc tham chiếu nếu có.
