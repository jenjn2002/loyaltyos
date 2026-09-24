UPDATE "NotificationTemplate"
SET "subject" = 'Bạn đã nhận được lời ghi nhận',
    "bodyText" = '{{message}} Bạn đã nhận được {{amount}} {{pointType.name}}.'
WHERE "name" = 'credit-received'
  AND "locale" = 'vi-VN';

UPDATE "NotificationTemplate"
SET "subject" = 'Điểm của bạn sắp hết hạn',
    "bodyText" = '{{amount}} {{pointType.name}} sẽ hết hạn sau {{days}} ngày.'
WHERE "name" = 'credit-expiring'
  AND "locale" = 'vi-VN';

UPDATE "NotificationTemplate"
SET "subject" = 'Yêu cầu đổi credit của bạn đã được gửi',
    "bodyText" = 'Yêu cầu đổi {{amount}} credit của bạn đang ở trạng thái {{status}}.'
WHERE "name" = 'credit-exchange'
  AND "locale" = 'vi-VN';

UPDATE "NotificationTemplate"
SET "subject" = 'Yêu cầu đổi thưởng của bạn đã được ghi nhận',
    "bodyText" = 'Yêu cầu đổi thưởng của bạn đã được ghi nhận.'
WHERE "name" = 'credit-redeemed'
  AND "locale" = 'vi-VN';
