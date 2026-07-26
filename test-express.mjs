import express from 'express';
const app = express();
try {
  app.get('/{*path}', (req, res) => res.send('ok'));
  console.log('path works');
} catch (e) {
  console.log('path failed:', e.message);
}
