# NWC Quiz Lab

## Chạy local

1. Cập nhật lại ngân hàng câu hỏi khi cần:
   `python quiz_web/scripts/import_itexam.py`
2. Mở `quiz_web/index.html` trong trình duyệt để học và luyện đề.
3. Toàn bộ tiến độ làm bài được lưu bằng `localStorage` trên máy.

## Deploy lên Netlify

Repo đã có sẵn `netlify.toml`, nên khi connect lên Netlify nó sẽ tự publish thư mục `quiz_web/`.
Netlify cũng sẽ tự chạy:
`python quiz_web/scripts/import_itexam.py`
trước khi publish để tạo lại ngân hàng câu hỏi và exhibit.

Các bước nhanh:

1. Đưa project này lên GitHub.
2. Vào Netlify > `Add new site` > `Import an existing project`.
3. Chọn repo GitHub chứa project.
4. Netlify sẽ đọc `netlify.toml` và publish từ `quiz_web/`.
5. Sau khi deploy xong, mở domain Netlify trên điện thoại là dùng được ngay.

Lưu ý:

- Tiến độ làm bài lưu bằng `localStorage`, nên điện thoại và máy tính sẽ có tiến độ riêng.
- Nếu cập nhật ngân hàng câu hỏi, nhớ chạy lại:
  `python quiz_web/scripts/import_itexam.py`
  rồi push code mới lên GitHub để Netlify redeploy.
