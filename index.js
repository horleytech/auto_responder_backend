const app = require('./src/app');
const { PORT, IS_VERCEL } = require('./src/config/env');

if (!IS_VERCEL) {
  if (!app || typeof app.listen !== 'function') {
    throw new TypeError('Invalid app export from ./src/app: expected an Express app instance');
  }

  app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
  });
}

module.exports = app;
