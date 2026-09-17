# Rà soát và tối ưu codebase — 2026-09-17

## Phạm vi

Đã đọc service worker, overlay, transcript, MAIN-world bridge, popup, manifest và tài liệu dự án.
Thay đổi tập trung vào độ đúng của luồng bất đồng bộ và giảm tác vụ trùng.
Không có build step trong dự án.
Không đổi provider dịch, permission hoặc cấu hình linter/formatter.

## Các thay đổi

| Khu vực | Trước | Sau | Bằng chứng |
| --- | --- | --- | --- |
| Rate limiter | Request hết slot chỉ chờ một lần rồi chạy cùng lúc; retry không tính slot | Mỗi lần gọi mạng phải lấy được slot, kể cả retry | Test 25 request đồng thời và retry |
| Cache | Chỉ lưu text, mất detectedLang khi cache hit | RAM/local lưu cả ngôn ngữ nguồn; đọc được cache cũ | Test cache qua service worker mới |
| Dedupe background | Một callback lỗi có thể làm các subscriber khác mất phản hồi | Tách lỗi từng callback | Test kênh đóng |
| Watchdog | Resend sau 12 giây nhưng không có deadline tiếp theo | Resend một lần, resolve null ở 24 giây nếu không có callback; bắt lỗi đồng bộ | Test cả overlay và transcript |
| Overlay lifecycle | Timer/debounce tồn tại sau khi dừng; request cũ xóa inflight mới | Hủy timer, reset poll budget, kiểm tra đúng Promise trước khi xóa | Test toggle và inflight |
| Transcript fetch | Chỉ kiểm tra sourceMode; kết quả video cũ có thể ghi đè video mới | Generation riêng, abort khi thay request/nav, timeout 8 giây | Test fetch cũ trả muộn và timeout |
| Resource observer | Mỗi lần scan tạo thêm observer; buffer chứa URL video cũ | Một observer; bỏ timedtext không thuộc video hiện tại | Test mở/đóng panel và nav |
| Translate All | Queue cũ và mới chia sẻ cờ cancel; đổi ngôn ngữ giữ bản dịch cũ | Queue có generation và language cố định; đổi ngôn ngữ xóa bản dịch cũ | Test đổi ngôn ngữ và video |
| Capture | Caption gốc và bản dịch cùng key bị coi là trùng | Cho phép cập nhật translated trên cùng segment | Test caption hai giai đoạn |
| Highlight | Render đánh dấu tất cả dòng trước thời điểm active | Chỉ đánh dấu dòng có timestamp active | Test render |
| Player bridge | Đọc captionTracks ở root; có thể replay video cũ | Đọc đường dẫn nested, kiểm tra videoId, chỉ giữ một poll timer | Test metadata và nav |

Debug mode nhận giá trị false đúng qua message popup.
Tham số targetLang được encode khi tạo URL dịch.

## Kiểm chứng

- `node --test tests/regression.test.cjs`: 17/17 PASS.
- `node --check`: PASS cho cả 5 file JavaScript production.
- `git diff --check`: PASS.
- Test dùng VM/Chrome/DOM stub và đồng hồ giả, không gọi Google hoặc YouTube thật.
- Chưa đo CPU/RAM hoặc độ trễ end-to-end; không suy diễn phần trăm tăng tốc từ unit test.
- Chưa kiểm tra extension đã load trong Chrome trên video thật.

Các quan sát nội bộ được tái hiện bằng code và test ở trên.
Theo thang bằng chứng của dự án, không gắn VERIFIED-HIGH cho toàn bộ tích hợp trình duyệt khi chưa có kiểm chứng thực tế.

## Cần kiểm tra trên Chrome

1. Reload extension và reload trang video đang mở.
2. Bật CC, kiểm tra bilingual / translated-only / original-only và Alt+T.
3. Đổi ngôn ngữ trong lúc Translate All chạy, kiểm tra chỉ bản dịch mới được giữ.
4. Chuyển video trong lúc transcript đang tải/dịch; kiểm tra title, track và text thuộc video mới.
5. Kiểm tra capture khi timedtext trả rỗng, transcript có bản dịch của caption đang phát.
6. Mở/đóng panel nhiều lần và thử export SRT/VTT.

## Giới hạn và việc tiếp theo

- Manifest chỉ inject ở watch/shorts/embed; đi từ trang chủ YouTube sang watch bằng SPA có thể chưa có content script.
- Persistent cache chỉ prune khi service worker khởi động, nên 2.000 entry chưa phải giới hạn cứng trong phiên worker dài.
- Popup ghi storage.sync theo từng input slider; cần gom ghi hoặc lưu khi kết thúc thao tác để giảm áp lực quota.
- Transcript đang có interval chờ video không giới hạn và chưa rebind listener khi YouTube thay video element.
- Watchdog 24 giây có thể kết thúc sớm hơn chuỗi retry nền tối đa khoảng 39 giây, chưa kể chờ rate limiter.
  Request nền vẫn có thể hoàn tất và lưu cache sau khi UI ngừng đợi.
- Metadata YouTube là giao diện nội bộ có thể thay đổi; test fixture chưa chứng minh mọi dạng player response đang được hỗ trợ.

## Bài học đã lưu

1. Sau khi chờ rate limiter phải kiểm tra và giữ slot lại trong cùng lượt thực thi trước khi fetch.
2. Retry cần đi qua cùng rate limiter với lần gọi đầu.
3. Response cache phải giữ metadata mà UI dùng, không chỉ text.
4. Cờ boolean không đủ xác định quyền ghi kết quả sau navigation; mỗi tác vụ cần generation riêng.
5. Mỗi lần resend cần deadline mới và Promise phải có đường kết thúc hữu hạn.
6. Deduplicate caption theo identity không được loại bỏ cập nhật bản dịch của chính caption đó.
7. Observer nên có owner và vòng đời rõ ràng; scan tài nguyên không đồng nghĩa tạo observer mới.
8. Kiểm thử bằng đồng hồ giả giúp tái hiện timeout và concurrency mà không chờ mạng thật.

## Quy trình push qua no-mistakes

Anh yêu cầu dùng no-mistakes để gate và push các thay đổi của đợt rà soát này.
Đích cấu hình đã kiểm tra là `https://github.com/ngoviet/yt-sub`, nhánh hiện tại `no-mistakes/harden-fix`.
Cấu hình pipeline tại thời điểm kiểm tra dùng Claude CLI với model `deepseek-flash[1m]`.
Chỉ commit code, test và docs thuộc task; giữ `AGENTS.md` có sẵn và artifact `.lavish/` ngoài commit.
Pipeline review/test/document/lint phải hoàn tất trước bước push; không dùng push trực tiếp để vượt gate.
Lần chạy cũ có lỗi provider `API Error: 400 Content Exists Risk` trong log review, nên dòng `unrecognized_model` ở status chưa đủ để kết luận lỗi tên model.
Bài học: đọc full log của step, kiểm tra branch_sync và bảo toàn custody trước khi commit hoặc chạy lại.

## Nguồn tham chiếu

- [VERIFIED-MEDIUM] [Chrome service worker lifecycle](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle): không dựa vào RAM để lưu cache bền vững qua worker restart.
- [VERIFIED-MEDIUM] [MDN AbortController.abort](https://developer.mozilla.org/en-US/docs/Web/API/AbortController/abort): hủy fetch và việc đọc response body.
- [VERIFIED-MEDIUM] [Chrome storage](https://developer.chrome.com/docs/extensions/reference/api/storage): quota ghi storage.sync giải thích hạng mục popup còn lại.
- [VERIFIED-HIGH] Cấu trúc captions nested được đối chiếu với [kkdai/youtube](https://github.com/kkdai/youtube/blob/master/response_data.go), [youtube-transcript](https://github.com/Kakulukian/youtube-transcript/blob/master/src/index.ts) và code bridge/test trong repo.
  Nhãn này chỉ áp dụng cấu trúc dữ liệu đã đối chiếu, không áp dụng E2E YouTube hiện tại.
