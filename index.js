const app = require('./src/app');
const { PORT, IS_VERCEL } = require('./src/config/env');

if (!IS_VERCEL) {
  app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
  });
}

module.exports = app;
