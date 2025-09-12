const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

const puzzleRoutes = require('./routes/puzzles');
const adminRoutes = require('./routes/admin');

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

// NUCLEAR: Completely rebuild admin user
app.post('/api/admin/nuclear-admin-reset', async (req, res) => {
  try {
    const bcrypt = require('bcryptjs');
    const sqlite3 = require('sqlite3').verbose();
    const path = require('path');
    
    const DB_PATH = path.join(__dirname, 'database.sqlite');
    const newPassword = process.env.DEFAULT_ADMIN_PASSWORD || 'admin123';
    
    console.log('💥 NUCLEAR: Completely rebuilding admin user...');
    
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    const db = new sqlite3.Database(DB_PATH);
    
    db.serialize(() => {
      // Delete ALL admin users
      db.run(`DELETE FROM users WHERE is_admin = 1`, function(err) {
        console.log(`Deleted ${this.changes} admin users`);
      });
      
      // Create fresh admin
      db.run(`INSERT INTO users (username, email, password_hash, is_admin, created_at) 
              VALUES (?, ?, ?, ?, datetime('now'))`,
        ['admin', 'admin@aftordle.com', hashedPassword, 1],
        function(err) {
          db.close();
          if (err) {
            console.error('❌ Failed:', err);
            res.status(500).json({ error: err.message });
          } else {
            console.log('✅ Nuclear reset complete - new admin created');
            res.json({ 
              success: true, 
              message: 'Admin completely rebuilt with secure password',
              newUserId: this.lastID 
            });
          }
        });
    });
    
  } catch (error) {
    console.error('❌ Nuclear error:', error);
    res.status(500).json({ error: error.message });
  }
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
