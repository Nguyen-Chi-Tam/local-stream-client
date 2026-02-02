const express = require('express');
const path = require('path');

const app = express();
const port = process.env.PORT || 3000;

const distPath = path.resolve(__dirname, '..', 'dist');

// Serve built static assets from Vite
app.use(express.static(distPath));

// SPA-style fallback: always serve index.html for unknown routes
app.get('*', (req, res) => {
  res.sendFile(path.join(distPath, 'index.html'));
});

app.listen(port, () => {
  console.log(`LocalStream client listening on http://localhost:${port}`);
});
