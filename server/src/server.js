'use strict';

/* Điểm khởi động. Đọc cấu hình, dựng pool, mở cổng, và tắt gọn khi nhận tín hiệu. */

const { loadConfig } = require('./config');
const { createPool } = require('./db/pool');
const { createApp } = require('./http/app');

function main() {
  let config;
  try {
    config = loadConfig();
  } catch (err) {
    /* Thiếu cấu hình thì chết ngay lúc khởi động, không để service lên rồi mới vỡ
     * ở request đầu tiên. */
    console.error(`[boot] ${err.message}`);
    process.exit(1);
  }

  const pool = createPool(config);
  const app = createApp({ pool, config });

  const server = app.listen(config.port, () => {
    console.log(`[boot] nghe cổng ${config.port} (${config.env})`);
  });

  let shuttingDown = false;
  const shutdown = (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[shutdown] nhận ${signal}, đóng dần`);

    server.close(async () => {
      try {
        await pool.end();
      } catch (err) {
        console.error('[shutdown] lỗi khi đóng pool:', err.message);
      }
      process.exit(0);
    });

    /* Không chờ mãi các kết nối đang treo. */
    setTimeout(() => process.exit(1), 10_000).unref();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

if (require.main === module) main();

module.exports = { main };
