const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

const puzzleRoutes = require('./routes/puzzles');
const adminRoutes = require('./routes/admin');

const clueLibraryRoutes = require('./routes/clue-library');
const aiClueRoutes = require('./routes/ai-clue-generator');

const app = express();
const PORT = process.env.PORT || 3001;

// Security middleware
app.use(helmet());
  app.use(cors({
    origin: process.env.CORS_ORIGIN || ['http://localhost:3000', 'http://localhost:8000', 'http://127.0.0.1:8000'],
    credentials: true
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP, please try again later.'
});
app.use(limiter);

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Static files (for serving the frontend if needed)
app.use(express.static('public'));

// API Routes
app.use('/api/puzzles', puzzleRoutes);
app.use('/api/admin', adminRoutes);

app.use('/api/clue-library', clueLibraryRoutes);
app.use('/api/ai-clue-generator', aiClueRoutes);

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    version: '1.0.0'
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ 
    error: 'Something went wrong!',
    message: process.env.NODE_ENV === 'development' ? err.message : 'Internal server error'
  });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

app.listen(PORT, () => {
  console.log(`🚀 Before and Aftordle API running on port ${PORT}`);
  console.log(`📊 Health check: http://localhost:${PORT}/api/health`);
  console.log(`🎮 Game API: http://localhost:${PORT}/api/puzzles`);
  console.log(`⚙️  Admin API: http://localhost:${PORT}/api/admin`);
});
