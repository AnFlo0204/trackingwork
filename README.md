# Household Chore Tracker (Quản Lý Việc Nhà)

Ứng dụng web thiết kế riêng cho điện thoại (`375px–430px`), theo dõi và xác thực hoàn thành việc nhà bằng ảnh chụp trực tiếp từ camera kèm dấu thời gian đồng bộ từ máy chủ Supabase (UTC+7).

## Tính năng chính

- **Xác thực chống gian lận:** Chụp trực tiếp từ camera sau (`capture="environment"` / WebRTC `facingMode: environment`), khóa chọn ảnh từ thư viện, đóng dấu thời gian máy chủ Việt Nam và nén WebP/JPEG `<= 180KB`.
- **Bảng việc nhà & "Làm gần nhất":** Hiển thị người làm gần nhất, ảnh đối chiếu và đồng hồ đếm ngược cooldown chống bấm trùng.
- **Bảng điều khiển Admin (`Admin`):** Bật/tắt 4 module tính năng theo thời gian thực, quản lý danh sách việc & cooldown, quản lý tối đa 10 thành viên (mã PIN 6 số), kiểm duyệt hủy lượt, sao lưu CSV và tự động dọn dẹp dữ liệu quá hạn (mặc định 90 ngày).
