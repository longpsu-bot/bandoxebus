# Route Storytelling V1 · Tuyến 61-2

Ứng dụng web tĩnh MapLibre để so sánh tuyến 61-2 hiện hữu và tuyến điều chỉnh, trình bày chênh lệch hình học, điểm dừng, POI và mô phỏng xe buýt.

## Chạy cục bộ

```powershell
cd E:\Project\QLDH\Maplibre\route61-2-storytelling-v1
npm test
npm run serve
```

Mở `http://localhost:8080`. Không mở trực tiếp bằng `file://`, vì trình duyệt cần tải `style.json` và các ES module qua HTTP.

## Kiến trúc

- `src/route-data.js`: dữ liệu tuyến, điểm dừng và POI được tách nguyên trạng từ package hiện tại.
- `src/comparison.js`: lớp biến đổi thuần dữ liệu, không phụ thuộc UI. Tuyến dùng ngưỡng hành lang 40 m để hấp thụ sai lệch lấy mẫu giữa hai KML; điểm dừng dùng ID ổn định trước, sau đó mới dùng ngưỡng 25 m.
- `src/road-labels.js`: lọc các đối tượng `transportation_name` chạy song song với tuyến; đường cắt ngang và đường ngoài hành lang bị loại. Phép lọc nặng chạy một lần trong Web Worker, chuẩn bị sẵn cache cho từng chế độ để đổi chế độ không khóa giao diện.
- `src/road-label-worker.js`: xử lý nhãn đường ngoài main thread và trả về cache hiện hữu / điều chỉnh / đối chiếu.
- `src/presentation.js`: hằng số layout, reducer trạng thái và cấu hình camera thuần cho trình chiếu.
- `src/presentation-content.js`: nội dung riêng của tuyến 61-2 gồm 7 slide, tách rõ `scene` và `content`.
- `src/presentation-metrics.js`: chuẩn bị chỉ số runtime từ kết quả so sánh hiện có, đồng thời định dạng và liên kết metric theo khóa ngữ nghĩa.
- `src/presentation-renderer.js`: renderer DOM an toàn cho một presentation shell dùng chung; không hiển thị `presenterNote`.
- `src/app.js`: MapLibre, thứ tự lớp, camera, điều khiển, POI và mô phỏng xe buýt.
- `src/basemap-style.js`: chọn nền sản xuất và tinh giản OpenFreeMap Dark; giữ các biến thể chuẩn hóa phục vụ kiểm chứng trực quan.
- `src/overture-buildings.js`: kiểm tra dữ liệu công trình Overture và định nghĩa lớp `fill-extrusion` MapLibre thuần dữ liệu.
- `scripts/prepare-overture-buildings.py`: tải và tiền xử lý offline dữ liệu `building` đúng AOI; giữ nguyên dấu chân nguồn, nhưng tính độ phủ bằng phần giao với AOI.
- `tests/`: unit tests cho so sánh tuyến, ghép điểm dừng và reducer trình chiếu.

Hai tập điểm dừng nguồn hiện tại giống nhau và không có mã trạm ổn định. Vì vậy kết quả thực tế là các điểm dừng được ghép bằng khoảng cách và phân loại là “giữ lại”; ứng dụng không tự tạo thay đổi trạm không có trong dữ liệu.

## Chế độ và trình chiếu

- `Chênh lệch` là mặc định: giữ lại / bổ sung / loại bỏ.
- `Hiện hữu` và `Điều chỉnh` hiển thị từng tuyến riêng.
- `Đối chiếu` dùng hai nét lệch nhẹ để xem đồng thời. True swipe được hoãn vì nền hiện tại chỉ có một MapLibre instance; thêm swipe sạch sẽ cần hai map được đồng bộ hoặc custom render pass.
- Presentation Content V2 có 7 slide và 4 layout: `hero`, `metrics`, `narrative`, `map-focus`. Mỗi slide tách nội dung trình bày khỏi scene bản đồ; nút trước/sau, thanh tiến độ, phím `←`, `→`, `Escape`, camera transitions và `prefers-reduced-motion` vẫn được giữ.
- Slide 05 dùng dữ liệu tĩnh Overture Buildings làm lớp `fill-extrusion`. Nếu tệp Overture thiếu hoặc không hợp lệ, Morphology V2 được dùng làm dự phòng; các slide khác không bật bối cảnh công nghiệp.
- Nền sản xuất là OpenFreeMap Dark được tinh giản tại runtime: bỏ lớp công trình nền, POI thương mại/tiện ích dư thừa, số nhà và lớp phủ dùng pattern. Tuyến, đường, nước, ranh và nhãn địa danh hữu ích vẫn được giữ.
- Mô phỏng xe buýt giữ thời gian chuyển động liên tục nhưng giới hạn cập nhật DOM ở 30 Hz để tránh tranh chấp main thread với MapLibre.
- Không có nút dựng hoặc xuất clip MP4 trong package này.
- Nhãn đường tự đổi theo chế độ: hiện hữu dùng tuyến hiện hữu, điều chỉnh/chênh lệch dùng tuyến điều chỉnh, đối chiếu dùng hợp của hai tuyến. Nhãn đường ngoài hành lang bị ẩn; nhãn hành chính vẫn giữ nguyên.

## Cloudflare Pages

Đây là website tĩnh, không cần build command. Chọn thư mục output là `route61-2-storytelling-v1` (hoặc upload nội dung trong thư mục này). MapLibre và OpenFreeMap cần kết nối Internet ở phía người xem.

## Tái tạo dữ liệu Overture sản xuất

Dữ liệu hiện tại được khóa ở Overture release `2026-08-19.0` và `overturemaps==0.20.0`. Polygon `data/industrial-zone-poc.geojson` là nguồn AOI có thẩm quyền; bbox chỉ được script suy ra và đối chiếu với bbox đã chứng nhận. Tên tệp AOI lịch sử được giữ để bảo toàn nguồn gốc POC đã được chứng nhận.

```powershell
python -m pip install -r scripts/requirements-overture.txt
npm run prepare:overture
```

Script gọi API Python chính thức với release đã khóa vì bộ kiểm tra release trong CLI 0.20.0 không đọc đúng các liên kết tuyệt đối của STAC catalog hiện hành. Tệp runtime `data/context/my-phuoc-1-buildings.geojson` không cần kết nối tới Overture. Metadata tái lập, fingerprint và thống kê nguồn nằm cạnh dữ liệu tại `data/context/my-phuoc-1-buildings.meta.json`.

Kết quả benchmark và ảnh đối chiếu của Visual Stack Hardening V1 nằm trong `review/visual-stack-hardening-v1/`. Render-envelope đã bị loại khỏi runtime vì camera Slide 05 cần toàn bộ 1.299 công trình; chế độ buffered không giảm feature nào, còn chế độ tight chỉ tạo cải thiện bằng cách xóa ngữ cảnh nhìn thấy.

## Kiểm tra thủ công

- [ ] 1. Ứng dụng mở không có lỗi JavaScript nghiêm trọng.
- [ ] 2. Nền Dark Liberty và đường chính hiển thị.
- [ ] 3. Chỉ nhãn đường chạy dọc tuyến đang xem xuất hiện; đường cắt ngang và đường ngoài hành lang không có nhãn.
- [ ] 4. Nhãn POI/địa danh cục bộ không cần thiết đã được giảm hoặc ẩn.
- [ ] 5. Chế độ mặc định là `Chênh lệch`.
- [ ] 6. Đoạn giữ lại có màu xanh xám và độ ưu tiên trung bình.
- [ ] 7. Đoạn bổ sung là nét cyan liền, sáng nhất và có halo nhẹ.
- [ ] 8. Đoạn loại bỏ là nét đứt màu hổ phách.
- [ ] 9. Chuyển qua `Hiện hữu` chỉ còn tuyến hiện hữu.
- [ ] 10. Chuyển qua `Điều chỉnh` chỉ còn tuyến điều chỉnh.
- [ ] 11. `Đối chiếu` hiển thị hai tuyến lệch nhẹ và dễ phân biệt.
- [ ] 12. Nút lớp điểm dừng, POI và mũi tên hoạt động độc lập.
- [ ] 13. Điểm dừng không có nhãn mã thường trực.
- [ ] 14. POI màu vàng, nhãn rõ và popup mở được liên kết tham chiếu.
- [ ] 15. Xe hiện hữu tắt mặc định; xe điều chỉnh bật mặc định.
- [ ] 16. Hai thanh tốc độ mặc định là `0.75×` và vẫn điều chỉnh được.
- [ ] 17. Điểm dừng chỉ đổi hổ phách một lần mỗi vòng xe, trong bán kính 55 m.
- [ ] 18. Trình chiếu đi đủ 7 slide bằng nút, thanh tiến độ và phím mũi tên; `Escape` thoát.
- [ ] 19. Reveal tuyến điều chỉnh kéo dài khoảng 2,2 giây; reduced motion chuyển ngay.
- [ ] 20. Bảng điều khiển không che vùng tuyến chính ở 1366×768 và 1920×1080.

## Phạm vi hoãn

- True swipe comparison.
- Mọi mở rộng ngoài một vùng công nghiệp đã chứng nhận, gồm hybrid filling và Urban Context Engine tổng quát.
- Heatmap, catchment, dân số, timetable, travel-time, backend và các chỉ số không có nguồn.
- Xuất PDF/PowerPoint/MP4 trực tiếp từ giao diện.
