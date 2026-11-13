import 'dotenv/config';
import express from 'express';
import http from 'http';
import { Server as SocketIOServer } from 'socket.io';
import cors from 'cors';
import helmet from 'helmet';
import path from 'path';
import { fileURLToPath } from 'url';

import { initDatabase } from './db/index.js';
import { setSocketIO } from './utils/socket.js';
import apiRouter from './routes/api.js';
import { runSeed } from '../seed.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const clientDistDir = path.resolve(__dirname, '../../client/dist');

// Inisialisasi DB & Auto-seed jika belum ada
initDatabase();
runSeed().catch(err => console.error('Seed check error:', err));

const app = express();
const server = http.createServer(app);

const clientOrigin = process.env.CLIENT_ORIGIN || 'http://localhost:5173';
const io = new SocketIOServer(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});
setSocketIO(io);

io.on('connection', (socket) => {
  // Realtime updates channel
  socket.on('disconnect', () => {});
});

// Middleware
app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" }
}));
app.use(cors({
  origin: '*',
  credentials: true
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Static uploads folder
const uploadDir = path.resolve(__dirname, '../uploads');
app.use('/uploads', express.static(uploadDir));

// API Routes
app.use('/api', apiRouter);

// Serve the checked-in frontend build from the same origin as the API.
app.use(express.static(clientDistDir));
app.get('*', (req, res, next) => {
  if (req.path === '/api' || req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(clientDistDir, 'index.html'));
});

// Central Error Handler
app.use((err, req, res, next) => {
  console.error('Unhandled Server Error:', err);
  const status = err.status || 500;
  res.status(status).json({
    success: false,
    message: err.message || 'Terjadi kesalahan internal pada server'
  });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`🚀 Server E-Voting OSIS aktif di http://localhost:${PORT}`);
});
