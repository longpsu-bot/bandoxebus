// Route 61-2-specific presentation definition. This intentionally remains a
// focused content boundary rather than a generic MapIllustration project schema.
export const PRESENTATION_SLIDES = Object.freeze([
  {
    id: 'intro', step: '01',
    scene: { mode: 'difference', target: 'overview', emphasizePois: false, revealProposed: false, urbanContext: 'off', camera: { pitch: 42, bearing: -18, maxZoom: 12.5 } },
    content: {
      layout: 'hero', eyebrow: 'Giới thiệu', title: 'Tuyến 61-2', subtitle: 'Thủ Dầu Một ↔ Bến Cát', status: 'Phương án điều chỉnh lộ trình',
      narrative: 'So sánh trực quan tuyến hiện hữu và tuyến điều chỉnh, các đoạn giữ lại, bổ sung và loại bỏ.',
      presenterNote: 'Mở đầu bằng toàn cảnh chênh lệch để định vị hành lang tuyến.'
    }
  },
  {
    id: 'existing', step: '02',
    scene: { mode: 'existing', target: 'existing', emphasizePois: false, revealProposed: false, urbanContext: 'off' },
    content: {
      layout: 'metrics', eyebrow: 'Hiện trạng', title: 'Tuyến hiện hữu — đường cơ sở so sánh',
      narrative: 'Hình học và hệ thống điểm dừng hiện hữu được dùng làm đường cơ sở để nhận diện các thay đổi trong phương án điều chỉnh.',
      metrics: [
        { label: 'Cự ly hiện hữu', metric: 'existingLengthMeters', format: 'distance', tone: 'existing' },
        { label: 'Điểm dừng hiện hữu', metric: 'existingStopCount', format: 'integer', tone: 'existing' }
      ],
      sourceNote: 'Cự ly được tính trực tiếp từ hình học tuyến trong ứng dụng.'
    }
  },
  {
    id: 'adjustment-context', step: '03',
    scene: { mode: 'difference', target: 'overview', emphasizePois: false, revealProposed: false, urbanContext: 'off', camera: { pitch: 44, bearing: -16 } },
    content: {
      layout: 'narrative', eyebrow: 'Bối cảnh điều chỉnh', title: 'Cách đọc phương án trên bản đồ',
      narrative: 'Tuyến hiện hữu là đường cơ sở. Hình học đề xuất được đối chiếu theo ba nhóm: đoạn giữ lại, đoạn bổ sung và đoạn loại bỏ.\n\nCác điểm kết nối chính cung cấp thêm ngữ cảnh không gian cho hành lang tuyến.',
      callouts: [
        { label: 'Giữ lại', text: 'Phần hành lang tương đồng giữa hai phương án.', tone: 'retained' },
        { label: 'Thay đổi', text: 'Phần hình học được bổ sung hoặc không còn trong đề xuất.', tone: 'changed' }
      ]
    }
  },
  {
    id: 'route-changes', step: '04',
    scene: { mode: 'difference', target: 'changes', emphasizePois: false, revealProposed: false, urbanContext: 'off', camera: { pitch: 50, bearing: -18, maxZoom: 12.8 } },
    content: {
      layout: 'metrics', eyebrow: 'Phương án điều chỉnh', title: 'Các thay đổi chính trên lộ trình',
      narrative: 'Các giá trị dưới đây được lấy từ cùng kết quả so sánh hình học đang điều khiển các lớp chênh lệch trên bản đồ.',
      metrics: [
        { label: 'Giữ lại', metric: 'retainedLengthMeters', format: 'distance', tone: 'retained' },
        { label: 'Bổ sung', metric: 'addedLengthMeters', format: 'signed-distance', tone: 'added' },
        { label: 'Loại bỏ', metric: 'removedLengthMeters', format: 'distance', tone: 'removed' },
        { label: 'Cự ly điều chỉnh', metric: 'proposedLengthMeters', format: 'distance', tone: 'proposed' }
      ],
      sourceNote: 'Phân loại hình học dùng ngưỡng hành lang tuyến hiện có của ứng dụng.'
    }
  },
  {
    id: 'service-area', step: '05',
    scene: { mode: 'proposed', target: 'service-area', emphasizePois: false, revealProposed: false, urbanContext: 'industrial-context', camera: { pitch: 52, bearing: -10, maxZoom: 13.6 } },
    content: {
      layout: 'map-focus', eyebrow: 'Không gian phục vụ', title: 'Bối cảnh công nghiệp gần tuyến',
      narrative: 'Khu công nghiệp Mỹ Phước 1 được dùng như hình học sử dụng đất theo ngữ cảnh, có nguồn gốc OSM, để đặt các khối công trình gần hành lang tuyến điều chỉnh.',
      sourceNote: 'Dấu chân công trình Overture là dữ liệu tổng quát hóa từ nhiều nguồn; chiều cao thiếu dữ liệu được suy diễn minh họa và không phải khảo sát hiện trạng. Nếu dữ liệu này không tải được, ứng dụng dùng lại khối tích tổng hợp minh họa. Ranh khu công nghiệp là hình học sử dụng đất theo ngữ cảnh có nguồn gốc OSM, không phải ranh quy hoạch chính thức.',
      presenterNote: 'Ranh vùng là hình học sử dụng đất theo ngữ cảnh có nguồn gốc OSM, không phải ranh quy hoạch công nghiệp chính thức.'
    }
  },
  {
    id: 'connections', step: '06',
    scene: { mode: 'proposed', target: 'connections', emphasizePois: true, revealProposed: false, urbanContext: 'off', camera: { pitch: 48, bearing: -8, maxZoom: 12.2 } },
    content: {
      layout: 'map-focus', eyebrow: 'Điểm kết nối', title: 'Ba mốc không gian chính', narrative: 'Tuyến điều chỉnh được đặt trong quan hệ với các địa điểm đã có trong dữ liệu.',
      callouts: [
        { text: 'Trường Đại học Thủ Dầu Một cơ sở 2 (Thới Hòa)' },
        { text: 'Trường Đại học Thủ Dầu Một (Phú Lợi)' },
        { text: 'Bến xe khách tỉnh Bình Dương' }
      ]
    }
  },
  {
    id: 'final-proposal', step: '07',
    scene: { mode: 'proposed', target: 'proposed', emphasizePois: false, revealProposed: true, urbanContext: 'off', camera: { pitch: 44, bearing: -16, maxZoom: 12.5 } },
    content: {
      layout: 'hero', eyebrow: 'Phương án hoàn chỉnh', title: 'Toàn tuyến 61-2 điều chỉnh', subtitle: 'Thủ Dầu Một ↔ Bến Cát',
      narrative: 'Khép lại bằng toàn bộ hướng tuyến đề xuất như kết luận trực quan của phần trình bày.'
    }
  }
]);
