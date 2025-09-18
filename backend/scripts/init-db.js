const pool = require('../db-connection');
const bcrypt = require('bcryptjs');

// Create and initialize database
async function initDatabase() {
  const client = await pool.connect();
  
  try {
    console.log('🔦 Connected to PostgreSQL database');

    // Create users table FIRST (other tables reference it)
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username TEXT UNIQUE NOT NULL,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        is_admin BOOLEAN DEFAULT false,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        last_login TIMESTAMP,
        total_games INTEGER DEFAULT 0,
        current_streak INTEGER DEFAULT 0,
        best_streak INTEGER DEFAULT 0,
        avg_score REAL DEFAULT 0,
        best_score INTEGER DEFAULT 0
      )
    `);
    console.log('✅ Users table ready');

    // Create daily_puzzles table (references users)
    await client.query(`
      CREATE TABLE IF NOT EXISTS daily_puzzles (
        id SERIAL PRIMARY KEY,
        date DATE UNIQUE NOT NULL,
        difficulty INTEGER DEFAULT 1,
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        created_by INTEGER,
        plays INTEGER DEFAULT 0,
        avg_score REAL DEFAULT 0,
        avg_time INTEGER DEFAULT 0,
        FOREIGN KEY (created_by) REFERENCES users (id)
      )
    `);
    console.log('✅ Daily puzzles table ready');

    // Create puzzle_clues table (references daily_puzzles)
    await client.query(`
      CREATE TABLE IF NOT EXISTS puzzle_clues (
        id SERIAL PRIMARY KEY,
        daily_puzzle_id INTEGER NOT NULL,
        clue_number INTEGER NOT NULL,
        clue TEXT NOT NULL,
        answer TEXT NOT NULL,
        linking_word TEXT NOT NULL,
        FOREIGN KEY (daily_puzzle_id) REFERENCES daily_puzzles (id) ON DELETE CASCADE,
        UNIQUE(daily_puzzle_id, clue_number)
      )
    `);
    console.log('✅ Puzzle clues table ready');

    // Create game_results table
    await client.query(`
      CREATE TABLE IF NOT EXISTS game_results (
        id SERIAL PRIMARY KEY,
        user_id INTEGER,
        daily_puzzle_id INTEGER,
        score INTEGER NOT NULL,
        completion_time INTEGER NOT NULL,
        hints_used INTEGER DEFAULT 0,
        wrong_answers INTEGER DEFAULT 0,
        hint_breakdown TEXT,
        clue_results TEXT,
        completed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users (id),
        FOREIGN KEY (daily_puzzle_id) REFERENCES daily_puzzles (id)
      )
    `);
    console.log('✅ Game results table ready');

    // Create admin_sessions table
    await client.query(`
      CREATE TABLE IF NOT EXISTS admin_sessions (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL,
        token TEXT UNIQUE NOT NULL,
        expires_at TIMESTAMP NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users (id)
      )
    `);
    console.log('✅ Admin sessions table ready');

    // Keep old puzzles table for potential migration (optional)
    await client.query(`
      CREATE TABLE IF NOT EXISTS puzzles (
        id SERIAL PRIMARY KEY,
        date DATE UNIQUE NOT NULL,
        clue TEXT NOT NULL,
        answer TEXT NOT NULL,
        linking_word TEXT NOT NULL,
        difficulty INTEGER DEFAULT 1,
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        created_by INTEGER,
        plays INTEGER DEFAULT 0,
        avg_score REAL DEFAULT 0,
        avg_time INTEGER DEFAULT 0,
        migrated BOOLEAN DEFAULT false
      )
    `);
    console.log('✅ Old puzzles table ready (for migration)');

    // Insert sample data
    await insertSampleData(client);

    console.log('🎉 Database initialization complete!');

  } catch (error) {
    console.error('❌ Database initialization failed:', error);
    throw error;
  } finally {
    client.release();
  }
}

async function insertSampleData(client) {
  try {
    // Create default admin user
    const adminPassword = await bcrypt.hash('admin123', 10);
    
    await client.query(`
      INSERT INTO users (username, email, password_hash, is_admin)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (username) DO NOTHING
    `, ['admin', 'admin@aftordle.com', adminPassword, true]);
    console.log('👤 Default admin user created (admin/admin123)');

    // Check if we already have today's puzzle
    const today = new Date().toISOString().split('T')[0];
    
    const existingPuzzleResult = await client.query(`
      SELECT COUNT(*) as count FROM daily_puzzles WHERE date = $1
    `, [today]);

    const existingCount = parseInt(existingPuzzleResult.rows[0].count);

    if (existingCount > 0) {
      console.log('📅 Today\'s sample daily puzzle already exists');
      return;
    }

    // Create sample daily puzzle for today
    const dailyPuzzleResult = await client.query(`
      INSERT INTO daily_puzzles (date, difficulty, created_by)
      VALUES ($1, $2, $3)
      RETURNING id
    `, [today, 1, 1]);

    const dailyPuzzleId = dailyPuzzleResult.rows[0].id;
    
    // Sample clues for today
    const sampleClues = [
      {
        clue: "Device for pointing and clicking + Device to catch rodents",
        answer: "COMPUTER MOUSE TRAP",
        linking_word: "MOUSE"
      },
      {
        clue: "Furniture for beverages + Book navigation aid",
        answer: "COFFEE TABLE OF CONTENTS",
        linking_word: "TABLE"
      },
      {
        clue: "Sequential art series + Piece of breakfast meat",
        answer: "COMIC STRIP OF BACON",
        linking_word: "STRIP"
      },
      {
        clue: "Former Secretary of State + Breakfast cereal treats",
        answer: "CONDOLEEZZA RICE KRISPIES TREATS",
        linking_word: "RICE"
      },
      {
        clue: "Feeling extremely pleased + Legendary rock band",
        answer: "TICKLED PINK FLOYD",
        linking_word: "PINK"
      }
    ];

    // Insert sample clues
    for (let i = 0; i < sampleClues.length; i++) {
      const clue = sampleClues[i];
      await client.query(`
        INSERT INTO puzzle_clues (daily_puzzle_id, clue_number, clue, answer, linking_word)
        VALUES ($1, $2, $3, $4, $5)
      `, [dailyPuzzleId, i + 1, clue.clue, clue.answer, clue.linking_word]);
      
      console.log(`🧩 Sample clue ${i + 1} added for ${today}`);
    }

  } catch (error) {
    console.error('Error inserting sample data:', error);
    throw error;
  }
}

// Run initialization if called directly
if (require.main === module) {
  initDatabase()
    .then(() => {
      console.log('🎉 Database initialization complete!');
      process.exit(0);
    })
    .catch((err) => {
      console.error('❌ Database initialization failed:', err);
      process.exit(1);
    });
}

module.exports = { initDatabase };
